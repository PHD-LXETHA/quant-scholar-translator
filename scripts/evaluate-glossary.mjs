import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROFESSIONAL_GLOSSARY_PRESET, selectGlossaryTerms } from '../apps/browser-extension/research/glossary.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadGlossaryEvaluation() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'tests', 'glossary-evaluation.json'), 'utf8'));
}

export function evaluateGlossary(spec = loadGlossaryEvaluation(), terms = PROFESSIONAL_GLOSSARY_PRESET) {
  const failures = [];
  const byDomain = new Map();
  let aliases = 0;
  const domainSourceKeys = new Set();
  const aliasDomainKeys = new Map();

  for (const term of terms) {
    const required = ['source', 'target', 'note', 'domain'].filter(key => !String(term[key] || '').trim());
    if (required.length) failures.push(`schema:${term.source || '<blank>'}:${required.join(',')}`);
    if (term.aliases && (!Array.isArray(term.aliases) || term.aliases.some(alias => !String(alias).trim()))) failures.push(`aliases:${term.source}`);
    aliases += term.aliases?.length || 0;
    byDomain.set(term.domain, (byDomain.get(term.domain) || 0) + 1);
    const sourceKey = `${term.domain}\0${term.source.toLowerCase()}`;
    if (domainSourceKeys.has(sourceKey)) failures.push(`duplicate-source:${sourceKey}`);
    domainSourceKeys.add(sourceKey);
    for (const alias of [term.source, ...(term.aliases || [])]) {
      const aliasKey = `${term.domain}\0${alias.toLowerCase()}`;
      if (!aliasDomainKeys.has(aliasKey)) aliasDomainKeys.set(aliasKey, new Set());
      aliasDomainKeys.get(aliasKey).add(term.target);
    }
  }

  if (terms.length < spec.minimums.totalTerms) failures.push(`minimum-total:${terms.length}/${spec.minimums.totalTerms}`);
  if (aliases < spec.minimums.totalAliases) failures.push(`minimum-aliases:${aliases}/${spec.minimums.totalAliases}`);
  for (const [domain, minimum] of Object.entries(spec.minimums.perDomain)) {
    const actual = byDomain.get(domain) || 0;
    if (actual < minimum) failures.push(`minimum-domain:${domain}:${actual}/${minimum}`);
  }
  for (const [key, targets] of aliasDomainKeys) {
    if (targets.size > 1) failures.push(`same-domain-alias-conflict:${key}:${[...targets].join('|')}`);
  }

  const evaluateCase = (item, kind) => {
    const selected = selectGlossaryTerms(terms, item.text, 80);
    const targets = new Set(selected.map(term => term.target));
    const sources = new Set(selected.map(term => term.source));
    for (const target of item.expectedTargets || []) if (!targets.has(target)) failures.push(`${kind}:missing:${target}:${item.text}`);
    for (const target of item.forbiddenTargets || []) if (targets.has(target)) failures.push(`${kind}:forbidden-target:${target}:${item.text}`);
    for (const source of item.forbiddenSources || []) if (sources.has(source)) failures.push(`${kind}:forbidden-source:${source}:${item.text}`);
  };
  spec.coverage.forEach(item => evaluateCase(item, 'coverage'));
  spec.ambiguity.forEach(item => evaluateCase(item, 'ambiguity'));
  spec.negative.forEach(item => evaluateCase(item, 'negative'));

  const checks = spec.coverage.length + spec.ambiguity.length + spec.negative.length;
  return {
    standard: spec.standard,
    passed: failures.length === 0,
    score: failures.length ? Math.max(0, Math.round(100 * (checks - failures.length) / checks)) : 100,
    terms: terms.length,
    aliases,
    domains: Object.fromEntries([...byDomain].sort()),
    evaluationCases: checks,
    failures
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = evaluateGlossary();
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
