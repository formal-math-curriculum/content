import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const SYSTEMS = ['ontomathpro', 'msc2020', 'arxiv'];
const SNAPSHOT_STATES = ['current', 'stale', 'unavailable', 'license_needs_review', 'incompatible'];
const DURABLE_RAW = ['content_repository', 'immutable_release_asset'];

export function validateSnapshotPolicy(policy) {
  const errors = [];
  if (policy.schema_version !== 'p5-m58-external-snapshot-policy/v1') errors.push('unknown external snapshot policy schema');
  if (policy.issue !== 'MAT-367' || policy.decision_id !== 'P5-M5.8-OPERATIONS-FREEZE-v1') errors.push('snapshot decision/issue mismatch');
  if (!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/u.test(policy.observed_on ?? '')) errors.push('missing observation date');
  for (const key of ['content', 'site', 'lean', 'mathlib']) if (!SHA40.test(policy.exact_bases?.[key] ?? '')) errors.push(`missing exact base: ${key}`);
  if (policy.authority?.manifest_repository !== 'formal-math-curriculum/content') errors.push('snapshot manifest authority mismatch');
  if (policy.authority?.site_is_consumer !== true || policy.authority?.external_taxonomy_is_curriculum_authority !== false) errors.push('snapshot consumer/authority boundary mismatch');
  if (policy.authority?.runtime_fetch_allowed !== false) errors.push('runtime taxonomy fetch is forbidden');
  if (policy.authority?.synthetic_fixture_may_establish_coverage !== false) errors.push('synthetic coverage policy mismatch');
  if (policy.deployment_authorized !== false) errors.push('snapshot policy cannot authorize deployment');

  const systems = new Map((policy.systems ?? []).map((entry) => [entry.system, entry]));
  if (systems.size !== SYSTEMS.length || SYSTEMS.some((system) => !systems.has(system))) errors.push('external snapshot system set mismatch');
  for (const entry of policy.systems ?? []) {
    const context = `snapshot ${entry.system ?? 'unknown'}`;
    if (!SNAPSHOT_STATES.includes(entry.snapshot_state)) errors.push(`${context} has unknown snapshot state`);
    if (!entry.upstream?.url || !entry.license?.spdx || !entry.license?.url || !entry.license?.attribution) errors.push(`${context} requires license and attribution`);
    if (entry.upstream?.sha256 !== null && entry.upstream?.sha256 !== undefined && !SHA64.test(entry.upstream.sha256)) errors.push(`${context} observed payload digest is invalid`);
    if (entry.upstream?.bytes !== null && entry.upstream?.bytes !== undefined && (!Number.isInteger(entry.upstream.bytes) || entry.upstream.bytes <= 0)) errors.push(`${context} observed payload byte count is invalid`);
    if (entry.snapshot_state === 'current') {
      if (!SHA64.test(entry.upstream?.sha256 ?? '') || !Number.isInteger(entry.upstream?.bytes)) errors.push(`${context} current snapshot requires exact raw bytes and SHA-256`);
      if (!DURABLE_RAW.includes(entry.raw_preservation)) errors.push(`${context} current snapshot requires durable raw preservation`);
      if (entry.observed_upstream_revision && entry.observed_upstream_revision !== entry.upstream?.revision) errors.push(`${context} changed upstream must be stale`);
    }
    if (entry.public_projection_eligible === true && entry.snapshot_state !== 'current') errors.push(`${context} public coverage requires a current snapshot`);
    if (entry.synthetic_fixture === true && entry.public_projection_eligible === true) errors.push(`${context} synthetic fixture cannot establish public coverage`);
  }

  const onto = systems.get('ontomathpro');
  if (onto?.upstream?.revision !== 'ebb4083adec275e079bb6210df24cfcd11d2767c' || onto?.upstream?.git_blob !== 'e29f9ca0e765449d1df3a597ea3421e992f52e30') errors.push('OntoMathPRO exact source drift');
  if (onto?.license?.spdx !== 'Apache-2.0' || !SHA64.test(onto?.license?.sha256 ?? '')) errors.push('OntoMathPRO license evidence drift');

  const msc = systems.get('msc2020');
  if (msc?.snapshot_state !== 'license_needs_review' || msc?.license?.spdx !== 'CC-BY-NC-SA-4.0' || msc?.public_projection_eligible !== false) errors.push('MSC2020 must remain license-needs-review and non-public');

  const arxiv = systems.get('arxiv');
  if (arxiv?.license?.spdx !== 'CC0-1.0' || arxiv?.license?.classification_terms_are_descriptive_metadata !== true || arxiv?.public_projection_eligible !== false) errors.push('arXiv metadata boundary drift');

  const openstax = (policy.linked_sources ?? []).find((source) => source.id === 'openstax-prealgebra-2e');
  if (!openstax || openstax.disposition !== 'link_and_original_project_paraphrase_only' || openstax.ingestion_allowed !== false) errors.push('OpenStax remains link/paraphrase only');
  return [...new Set(errors)];
}

function mutate(target, mutation) {
  const segments = mutation.path.split('.');
  const last = segments.pop();
  let cursor = target;
  for (const segment of segments) cursor = cursor[Number.isInteger(Number(segment)) ? Number(segment) : segment];
  const key = Number.isInteger(Number(last)) ? Number(last) : last;
  if (mutation.delete === true) delete cursor[key];
  else cursor[key] = mutation.value;
}

export function validateSnapshotCases(policy, matrix) {
  if (matrix.schema_version !== 'p5-m58-snapshot-cases/v1') return ['unknown snapshot case matrix schema'];
  const errors = [];
  for (const entry of matrix.cases ?? []) {
    const candidate = structuredClone(policy);
    for (const mutation of entry.mutations ?? []) mutate(candidate, mutation);
    const observed = validateSnapshotPolicy(candidate);
    if (entry.expected === 'pass' && observed.length) errors.push(`${entry.id} expected pass: ${observed.join('; ')}`);
    if (entry.expected === 'fail') {
      if (!observed.length) errors.push(`${entry.id} expected failure`);
      if (entry.error_includes && !observed.join('\n').includes(entry.error_includes)) errors.push(`${entry.id} missing expected error: ${entry.error_includes}`);
    }
  }
  return errors;
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [policyPath, matrixPath] = process.argv.slice(2);
  if (!policyPath || !matrixPath) throw new Error('usage: node scripts/validate-m5-8-snapshots.mjs <policy.json> <cases.json>');
  const [policy, matrix] = await Promise.all([json(policyPath), json(matrixPath)]);
  const errors = validateSnapshotCases(policy, matrix);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`validated ${matrix.cases.length} M5.8 snapshot/licensing cases`);
  }
}
