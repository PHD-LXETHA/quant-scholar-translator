import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFESSIONAL_GLOSSARY_PRESET,
  migrateProfessionalGlossary,
  formatGlossaryPrompt,
  glossaryToCsv,
  glossaryToJson,
  normalizeGlossaryTerms,
  selectGlossaryTerms,
  parseGlossaryText
} from "../glossary.mjs";

test("normalizes and de-duplicates glossary terms case-insensitively", () => {
  assert.deepEqual(normalizeGlossaryTerms([
    { source: " oxygen redox ", target: " 氧氧化还原 " },
    { source: "OXYGEN REDOX", target: "重复" },
    { source: "", target: "无效" }
  ]), [{ source: "oxygen redox", target: "氧氧化还原" }]);
});

test("round-trips glossary JSON and quoted CSV", () => {
  const terms = [{ source: "Na, Li", target: "钠、锂" }, { source: 'term "A"', target: "译法" }];
  assert.deepEqual(parseGlossaryText(glossaryToJson(terms), ".json"), terms);
  assert.deepEqual(parseGlossaryText(glossaryToCsv(terms), ".csv"), terms);
});

test("formats glossary as an explicit high-priority prompt section", () => {
  const prompt = formatGlossaryPrompt([{ source: "unbiased estimator", target: "无偏估计量" }]);
  assert.match(prompt, /用户术语表/);
  assert.match(prompt, /unbiased estimator => 无偏估计量/);
  assert.ok(PROFESSIONAL_GLOSSARY_PRESET.length >= 900);
  assert.equal(PROFESSIONAL_GLOSSARY_PRESET.some(item => item.source === "layered oxide" || item.source === "oxygen redox"), false);
});

test("retired defaults are removed from saved terms without losing custom entries or edits", async () => {
  const custom = { source: "user term", target: "自定义术语", note: "keep metadata" };
  const edited = { source: "oxygen redox", target: "用户修改的译法" };
  const saved = { glossaryTerms: [...PROFESSIONAL_GLOSSARY_PRESET, { source: "layered oxide", target: "层状氧化物" }, [" SEI ", "SEI（保留缩写）"], custom, edited] };
  const storage = { get: async () => saved, set: async update => Object.assign(saved, update) };
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.glossaryTerms.length, PROFESSIONAL_GLOSSARY_PRESET.length + 2);
  assert.ok(saved.glossaryTerms.includes(custom));
  assert.ok(saved.glossaryTerms.includes(edited));
  assert.equal(saved.glossaryTerms.some(item => item.source === "layered oxide"), false);
  const cleaned = saved.glossaryTerms;
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.glossaryTerms, cleaned, "Migration must run only once");
});

test("migration respects an empty user glossary and leaves new-install defaults to initialization", async () => {
  for (const saved of [{}, { glossaryTerms: [] }]) {
    const storage = { get: async () => saved, set: async update => Object.assign(saved, update) };
    await migrateProfessionalGlossary(storage);
    assert.equal(saved.glossaryTerms?.length ?? 0, 0);
  }
});

test('context, aliases and domain survive JSON/CSV round trips without merging distinct senses', () => {
  const terms = [
    { source: 'power', target: '检验功效', domain: 'statistics', note: '检验，不是幂', aliases: ['statistical power'], requiresContext: true },
    { source: 'power', target: '幂', domain: 'mathematics', note: '指数运算' },
  ];
  for (const text of [glossaryToCsv(terms), glossaryToJson(terms)]) assert.deepEqual(parseGlossaryText(text), terms);
  assert.deepEqual(parseGlossaryText('source,target,tgt_lng\npower,功效,zh'), [{ source: 'power', target: '功效' }]);
});

test('CQF aliases, accented names and hyphens retrieve late glossary entries with their context', () => {
  const prompt = formatGlossaryPrompt(PROFESSIONAL_GLOSSARY_PRESET, "Ito’s lemma uses quadratic variation under a risk neutral measure. Estimate VaR and ES, not EL.");
  for (const term of ['伊藤引理', '二次变差', '风险中性测度', '风险价值', '预期信用损失']) assert.ok(prompt.includes(term), term);
  assert.match(prompt, /不等同于信用风险/);
  assert.doesNotMatch(prompt, /垃圾回收/);
});

test('whole-word selection does not match beta inside alphabetagamma or class inside classification', () => {
  assert.equal(selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'alphabetagamma classification').length, 0);
  assert.equal(formatGlossaryPrompt(PROFESSIONAL_GLOSSARY_PRESET, 'unrelated text'), '');
});

test('matched user wording wins over built-in domain variants', () => {
  const values = [{ source: 'power', target: '用户指定译法' }, ...PROFESSIONAL_GLOSSARY_PRESET];
  const power = selectGlossaryTerms(values, 'The power of the test.').filter(t => t.source === 'power');
  assert.deepEqual(power, [{ source: 'power', target: '用户指定译法' }]);
});

test('cross-domain homonyms use surrounding evidence and omit unsafe ties', () => {
  const programming = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'The function return value has a type annotation.');
  const finance = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'Expected return and portfolio volatility.');
  const statistics = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'The statistical power of the hypothesis test.');
  const mathematics = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'The matrix power follows from the eigenvalue.');
  const bare = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'return');
  const bareCi = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'CI');
  const bareGenerator = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'generator');
  const pairs = rows => new Set(rows.map(row => `${row.source}\0${row.target}`));

  assert.ok(pairs(programming).has('return\0返回'));
  assert.ok(!pairs(programming).has('return\0收益率'));
  assert.ok(pairs(finance).has('return\0收益率'));
  assert.ok(pairs(statistics).has('power\0检验功效'));
  assert.ok(pairs(mathematics).has('power\0幂'));
  assert.equal(bare.some(row => row.source.toLowerCase() === 'return'), false);
  assert.equal(bareCi.some(row => ['confidence interval', 'continuous integration'].includes(row.source)), false);
  assert.equal(bareGenerator.some(row => ['infinitesimal generator', 'generator'].includes(row.source)), false);
});

test('conflicting aliases are resolved by nearby domain terms', () => {
  const programming = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'CI pipeline and package manager');
  const statistics = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, '95% CI for an unbiased estimator');
  const mathematics = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'infinitesimal generator of a Markov process');
  assert.ok(programming.some(row => row.target === '持续集成'));
  assert.equal(programming.some(row => row.target === '置信区间'), false);
  assert.ok(statistics.some(row => row.target === '置信区间'));
  assert.equal(statistics.some(row => row.target === '持续集成'), false);
  assert.ok(mathematics.some(row => row.target === '无穷小生成元'));
  assert.equal(mathematics.some(row => row.target === '生成器'), false);
});

test('generic professional senses require independent domain context', () => {
  const ordinary = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'The video duration is ten minutes.');
  const finance = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, 'Bond duration and convexity measure rate sensitivity.');
  assert.equal(ordinary.some(row => row.source === 'duration'), false);
  assert.ok(finance.some(row => row.target === '久期'));
});

test('older nonempty library gains missing defaults without replacing customized translations or metadata', async () => {
  const custom = { source: 'duration', target: '我的久期译法', note: '私有定义', owner: 'user' };
  const saved = { quantScholarMaterialTermsRemovedV1: true, glossaryTerms: [custom] };
  const storage = { get: async () => saved, set: async value => Object.assign(saved, value) };
  await migrateProfessionalGlossary(storage);
  assert.ok(saved.glossaryTerms.includes(custom));
  assert.ok(saved.glossaryTerms.some(t => t.source === 'risk-neutral measure'));
  assert.equal(saved.glossaryTerms.filter(t => t.source === 'duration').length, 1);
  const previous = saved.glossaryTerms;
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.glossaryTerms, previous);
});

test('V5 migration upgrades users who already completed V4 and keeps both qualified senses', async () => {
  const existing = PROFESSIONAL_GLOSSARY_PRESET.find(t => t.source === 'duration');
  const saved = {
    quantScholarMaterialTermsRemovedV1: true,
    quantScholarContextualGlossaryV2: true,
    quantScholarContextualGlossaryV3: true,
    quantScholarContextualGlossaryV4: true,
    glossaryTerms: [existing]
  };
  const storage = { get: async () => saved, set: async value => Object.assign(saved, value) };
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.quantScholarContextualGlossaryV5, true);
  assert.ok(saved.glossaryTerms.some(t => t.source === 'cross-currency basis'));
  const power = saved.glossaryTerms.filter(t => t.source === 'power');
  assert.deepEqual(new Set(power.map(t => t.domain)), new Set(['mathematics', 'statistics']));
});

test('V6 migration adds CFA and FRM terms without replacing an existing custom term', async () => {
  const custom = { source: 'risk appetite', target: '我的风险偏好译法' };
  const saved = {
    quantScholarMaterialTermsRemovedV1: true,
    quantScholarContextualGlossaryV2: true,
    quantScholarContextualGlossaryV3: true,
    quantScholarContextualGlossaryV4: true,
    quantScholarContextualGlossaryV5: true,
    glossaryTerms: [custom]
  };
  const storage = { get: async () => saved, set: async value => Object.assign(saved, value) };
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.quantScholarContextualGlossaryV6, true);
  assert.equal(saved.glossaryTerms.filter(t => t.source === 'risk appetite').length, 1);
  assert.equal(saved.glossaryTerms.find(t => t.source === 'risk appetite').target, '我的风险偏好译法');
  assert.ok(saved.glossaryTerms.some(t => t.source === 'material nonpublic information'));
  assert.ok(saved.glossaryTerms.some(t => t.source === 'liquidity coverage ratio'));
});

test('V7 migration adds CQF curriculum terms without replacing an existing custom term', async () => {
  const custom = { source: 'model calibration', target: '我的模型校准译法' };
  const saved = {
    quantScholarMaterialTermsRemovedV1: true,
    quantScholarContextualGlossaryV2: true,
    quantScholarContextualGlossaryV3: true,
    quantScholarContextualGlossaryV4: true,
    quantScholarContextualGlossaryV5: true,
    quantScholarContextualGlossaryV6: true,
    glossaryTerms: [custom]
  };
  const storage = { get: async () => saved, set: async value => Object.assign(saved, value) };
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.quantScholarContextualGlossaryV7, true);
  assert.equal(saved.glossaryTerms.filter(t => t.source === 'model calibration').length, 1);
  assert.equal(saved.glossaryTerms.find(t => t.source === 'model calibration').target, '我的模型校准译法');
  assert.ok(saved.glossaryTerms.some(t => t.source === 'Black-Scholes PDE'));
  assert.ok(saved.glossaryTerms.some(t => t.source === 'nested clustered optimization'));
  assert.ok(saved.glossaryTerms.some(t => t.source === 'temporal-difference learning'));
});

test('V9 upgrades V8 libraries without overwriting custom terms or restoring an empty library', async () => {
  for (const empty of [false, true]) {
    const saved = {quantScholarMaterialTermsRemovedV1: true};
    for (let version = 2; version <= 8; version++) saved[`quantScholarContextualGlossaryV${version}`] = true;
    const custom = {source: 'amortised cost', target: '我的摊余成本', domain: 'finance', note: '保留'};
    saved.glossaryTerms = empty ? [] : [custom];
    const storage = {get: async () => saved, set: async value => Object.assign(saved, value)};
    await migrateProfessionalGlossary(storage);
    assert.equal(saved.quantScholarContextualGlossaryV9, true);
    if (empty) assert.deepEqual(saved.glossaryTerms, []);
    else {
      assert.deepEqual(saved.glossaryTerms.filter(t => t.source === 'amortised cost'), [custom]);
      for (const source of ['forward error', 'Holm correction', 'risk factor eligibility test', 'effective interest method', 'Lucas critique', 'hashability', 'replicability']) {
        assert.ok(saved.glossaryTerms.some(t => t.source === source), source);
      }
    }
    const before = JSON.stringify(saved);
    await migrateProfessionalGlossary(storage);
    assert.equal(JSON.stringify(saved), before);
  }
});

test('V10 upgrades V9 libraries once and exposes applied-reading terminology', async () => {
  const saved = {quantScholarMaterialTermsRemovedV1: true};
  for (let version = 2; version <= 9; version++) saved[`quantScholarContextualGlossaryV${version}`] = true;
  const custom = {source: 'conformal prediction', target: '我的保形预测', domain: 'statistics', note: '保留'};
  saved.glossaryTerms = [custom];
  const storage = {get: async () => saved, set: async value => Object.assign(saved, value)};
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.quantScholarContextualGlossaryV10, true);
  assert.deepEqual(saved.glossaryTerms.filter(t => t.source === 'conformal prediction'), [custom]);
  for (const source of ['Lévy characterization theorem', 'marginal coverage', 'SVI parameterization', 'business model test', 'Beveridge curve', 'activation checkpointing', 'multiverse analysis']) {
    assert.ok(saved.glossaryTerms.some(t => t.source === source), source);
  }
  const before = JSON.stringify(saved);
  await migrateProfessionalGlossary(storage);
  assert.equal(JSON.stringify(saved), before);
});

test('V11 upgrades V10 libraries once and exposes professional-gate terminology', async () => {
  const saved = {quantScholarMaterialTermsRemovedV1: true};
  for (let version = 2; version <= 10; version++) saved[`quantScholarContextualGlossaryV${version}`] = true;
  const custom = {source: 'almost sure convergence', target: '我的自定义译法', domain: 'mathematics', note: '保留'};
  saved.glossaryTerms = [custom];
  const storage = {get: async () => saved, set: async value => Object.assign(saved, value)};
  await migrateProfessionalGlossary(storage);
  assert.equal(saved.quantScholarContextualGlossaryV11, true);
  assert.deepEqual(saved.glossaryTerms.filter(t => t.source === 'almost sure convergence'), [custom]);
  for (const source of ['finite-sample bias', 'operational measure', 'vector autoregression', 'reinvestment risk', 'exception handling']) {
    assert.ok(saved.glossaryTerms.some(t => t.source === source), source);
  }
  const before = JSON.stringify(saved);
  await migrateProfessionalGlossary(storage);
  assert.equal(JSON.stringify(saved), before);
});

test('normalization retains accepted target variants used by the professional gate', () => {
  const [entry] = normalizeGlossaryTerms([{source: 'inflation', target: '通货膨胀', targetVariants: ['通胀', '通胀', '']}]);
  assert.deepEqual(entry.targetVariants, ['通胀']);
});

test('library is domain-qualified, documented and free of conflicting duplicates within each domain', () => {
  const keys = new Set();
  for (const entry of PROFESSIONAL_GLOSSARY_PRESET) {
    const key = `${entry.domain}:${entry.source.toLowerCase()}`;
    assert.ok(entry.note && entry.domain && entry.target);
    assert.ok(!keys.has(key), key); keys.add(key);
  }
  const matched = selectGlossaryTerms(PROFESSIONAL_GLOSSARY_PRESET, PROFESSIONAL_GLOSSARY_PRESET.map(t => t.source).join(' '), 40);
  assert.equal(matched.length, 40);
});

test('V8 upgrades V7 libraries once, preserves user edits and respects an empty library', async () => {
  for (const empty of [false, true]) {
    const saved = {quantScholarMaterialTermsRemovedV1: true};
    for (let version = 2; version <= 7; version++) saved[`quantScholarContextualGlossaryV${version}`] = true;
    const custom = {source: 'cross-fitting', target: '我的交叉拟合', note: '保留个人注释'};
    saved.glossaryTerms = empty ? [] : [custom];
    const storage = {get: async () => saved, set: async value => Object.assign(saved, value)};
    await migrateProfessionalGlossary(storage);
    assert.equal(saved.quantScholarContextualGlossaryV8, true);
    if (empty) assert.deepEqual(saved.glossaryTerms, []);
    else {
      assert.deepEqual(saved.glossaryTerms.filter(t => t.source === 'cross-fitting'), [custom]);
      for (const source of ['uniform integrability', 'missing not at random', 'deflated Sharpe ratio', 'other comprehensive income', 'local projection', 'gradient clipping', 'replication package']) {
        assert.ok(saved.glossaryTerms.some(t => t.source === source), source);
      }
    }
    const before = JSON.stringify(saved);
    await migrateProfessionalGlossary(storage);
    assert.equal(JSON.stringify(saved), before);
  }
});
