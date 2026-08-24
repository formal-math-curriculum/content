import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  deriveTranslationState,
  validateCaseMatrix,
  validateChangePacket,
  validateWorkflowPolicy
} from '../scripts/validate-m5-8-workflow.mjs';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const [policy, matrix, packetSchema] = await Promise.all([
  json('source/m5-8/editorial-workflow-policy.json'),
  json('fixtures/m5-8/workflow-cases.json'),
  json('schemas/m5-8-change-packet.schema.json')
]);

test('M5.8 policy preserves authority, state and deployment boundaries', () => {
  assert.deepEqual(validateWorkflowPolicy(policy), []);
  assert.equal(policy.roles.length, 10);
  assert.equal(policy.authority.generated_outputs_are_authority, false);
  assert.equal(policy.authority.translations_are_independent_authority, false);
  assert.equal(policy.deployment_authorized, false);
  assert.equal(packetSchema.properties.deployment_authorized.const, false);
  assert.ok(packetSchema.required.includes('attribution'));
});

test('complete workflow case matrix meets every expected result', () => {
  assert.deepEqual(validateCaseMatrix(policy, matrix), []);
  assert.deepEqual(matrix.cases.map(({ id }) => id), [
    'W01-valid-reviewed-change',
    'W02-valid-stale-translation',
    'W03-self-review',
    'W04-stale-source-marked-current',
    'W05-nearby-lean-without-traceability',
    'W06-synthetic-mapping-claim',
    'W07-wrong-authority-repository',
    'W08-hand-edited-generated-output',
    'W09-missing-exact-base',
    'W10-incompatible-packet-schema',
    'W11-valid-unavailable-translation',
    'W12-valid-deprecation-with-lineage',
    'W13-material-change-without-revalidation'
  ]);
});

test('translation freshness is derived from exact canonical revision and review', () => {
  assert.equal(deriveTranslationState({ canonical_source_revision: 'a', translation_source_revision: null, review_decision: 'pending' }), 'unavailable');
  assert.equal(deriveTranslationState({ canonical_source_revision: 'a', translation_source_revision: 'b', review_decision: 'approved' }), 'stale');
  assert.equal(deriveTranslationState({ canonical_source_revision: 'a', translation_source_revision: 'a', review_decision: 'pending' }), 'draft');
  assert.equal(deriveTranslationState({ canonical_source_revision: 'a', translation_source_revision: 'a', review_decision: 'approved' }), 'current_reviewed');
});

test('a packet cannot authorize deployment through an editorial workflow', () => {
  const valid = structuredClone(matrix.cases[0].packet);
  valid.deployment_authorized = true;
  assert.match(validateChangePacket(policy, valid).join('\n'), /cannot authorize deployment/u);
});

test('release approval and publication remain outside MAT-366 authority', () => {
  const valid = structuredClone(matrix.cases[0].packet);
  valid.publication_changes[0] = {
    candidate_id: 'P5-M5.8-CANDIDATE-v1',
    from: 'candidate_not_deployed',
    to: 'release_approved',
    coordinator_id: 'release-coordinator'
  };
  assert.match(validateChangePacket(policy, valid).join('\n'), /separate release\/rollback authority/u);
});

test('stale public translation is disclosed while unavailable translation emits no route', () => {
  const stale = matrix.cases.find(({ id }) => id === 'W02-valid-stale-translation').packet.translation_changes[0];
  const unavailable = matrix.cases.find(({ id }) => id === 'W11-valid-unavailable-translation').packet.translation_changes[0];
  assert.equal(stale.hreflang_eligible, false);
  assert.ok(stale.freshness_disclosure);
  assert.equal(unavailable.localized_route_eligible, false);
  assert.equal(unavailable.sitemap_eligible, false);
});

test('fresh-contributor documentation and PR gate expose the frozen review controls', async () => {
  const [guide, template] = await Promise.all([
    readFile('docs/m5-8-editorial-contribution-workflow.md', 'utf8'),
    readFile('.github/PULL_REQUEST_TEMPLATE.md', 'utf8')
  ]);
  for (const term of ['P5-M5.8-OPERATIONS-FREEZE-v1', 'current_reviewed', 'FART/FLOC/FLINK', 'attribution', 'fallback', 'stale', 'generated']) assert.match(guide, new RegExp(term.replaceAll('/', '\\/'), 'iu'));
  for (const term of ['exact base commits', 'Author role', 'Reviewer role', 'Attribution', 'Deployment remains unauthorized']) assert.match(template, new RegExp(term, 'iu'));
});
