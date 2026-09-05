import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGlossary } from '../scripts/evaluate-glossary.mjs';

test('professional glossary passes the project evaluation gate', () => {
  const result = evaluateGlossary();
  assert.equal(result.passed, true, result.failures.join('\n'));
  assert.equal(result.score, 100);
  assert.ok(result.terms >= 1424);
  assert.ok(result.aliases >= 703);
  assert.ok(result.evaluationCases >= 192);
});

test('evaluation catches accent, apostrophe and dash conflicts seen by retrieval', () => {
  const spec = { minimums: {totalTerms: 0, totalAliases: 0, perDomain: {}}, coverage: [], ambiguity: [], negative: [] };
  const terms = [
    {source: "Itô's term", target: '甲', domain: 'mathematics', note: 'a', aliases: ['risk–neutral']},
    {source: "Ito’s term", target: '乙', domain: 'mathematics', note: 'b', aliases: ['risk-neutral']},
  ];
  const result = evaluateGlossary(spec, terms);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(failure => failure.startsWith('duplicate-source:')));
  assert.ok(result.failures.some(failure => failure.includes('same-domain-alias-conflict:') && failure.includes('risk neutral')));
});

test('evaluation rejects a missing conceptual boundary even with a correct target', () => {
  const spec = {
    minimums: {totalTerms: 0, totalAliases: 0, perDomain: {}}, coverage: [], ambiguity: [], negative: [],
    conceptChecks: [{domain: 'statistics', source: 'test method', noteIncludes: ['适用条件']}]
  };
  const result = evaluateGlossary(spec, [{source: 'test method', target: '检验方法', domain: 'statistics', note: '只有译法'}]);
  assert.equal(result.passed, false);
  assert.ok(result.failures.some(failure => failure.startsWith('concept:missing-boundary:')));
});
