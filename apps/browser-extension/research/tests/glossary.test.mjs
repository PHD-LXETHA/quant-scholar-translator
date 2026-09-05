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
