import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateSnapshotCases, validateSnapshotPolicy } from '../scripts/validate-m5-8-snapshots.mjs';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [policy, matrix, schema] = await Promise.all([
  json('source/m5-8/external-snapshot-policy.json'),
  json('fixtures/m5-8/snapshot-cases.json'),
  json('schemas/m5-8-external-snapshot-manifest.schema.json')
]);

test('M5.8 external snapshot policy fails closed without public coverage', () => {
  assert.deepEqual(validateSnapshotPolicy(policy), []);
  assert.equal(schema.properties.deployment_authorized.const, false);
  assert.ok(policy.systems.every((entry) => entry.public_projection_eligible === false));
  assert.equal(policy.authority.runtime_fetch_allowed, false);
});

test('snapshot case matrix covers valid, invalid, missing, stale and incompatible behavior', () => {
  assert.deepEqual(validateSnapshotCases(policy, matrix), []);
  assert.equal(matrix.cases.length, 10);
  assert.deepEqual(matrix.cases.map(({ id }) => id), [
    'S01-current-observed-policy',
    'S02-current-without-durable-raw',
    'S03-msc-current-without-digest',
    'S04-malformed-observed-digest',
    'S05-synthetic-public-coverage',
    'S06-runtime-taxonomy-fetch',
    'S07-incompatible-schema',
    'S08-missing-attribution',
    'S09-upstream-change-not-stale',
    'S10-openstax-ingestion'
  ]);
});

test('exact observed upstream evidence is retained without an ingestion claim', () => {
  const onto = policy.systems.find(({ system }) => system === 'ontomathpro');
  const msc = policy.systems.find(({ system }) => system === 'msc2020');
  const arxiv = policy.systems.find(({ system }) => system === 'arxiv');
  assert.equal(onto.upstream.sha256, 'd8ceab757419a6ff07230342c47f4d49f8542ef998e0b052b31cde8fa5ab1c7f');
  assert.equal(onto.snapshot_state, 'unavailable');
  assert.equal(msc.upstream.retrieval_result, 'http_502');
  assert.equal(msc.snapshot_state, 'license_needs_review');
  assert.equal(arxiv.upstream.sha256, 'b68362abee9154e329c56febfc6838748b128c3aebf5fc392849b2411301a931');
  assert.equal(arxiv.raw_preservation, 'hash_observed_only');
});
