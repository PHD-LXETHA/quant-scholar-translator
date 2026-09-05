import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGlossary } from '../scripts/evaluate-glossary.mjs';

test('professional glossary passes the project evaluation gate', () => {
  const result = evaluateGlossary();
  assert.equal(result.passed, true, result.failures.join('\n'));
  assert.equal(result.score, 100);
  assert.ok(result.terms >= 900);
  assert.ok(result.aliases >= 280);
  assert.ok(result.evaluationCases >= 40);
});
