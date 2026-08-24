import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  EXPECTED_DEPENDENCY_SHA256,
  EXPECTED_SELECTOR_SHA256,
  buildOutputs,
  generate,
  loadInputs,
  validateSource
} from '../scripts/generate-m5-6.mjs';

const inputs = await loadInputs();
const { source, authority, validationFixture } = inputs;
const outputs = buildOutputs(source, authority);

function clone(value) {
  return structuredClone(value);
}

function setPath(target, path, value) {
  const segments = path.split('.');
  const last = segments.pop();
  let cursor = target;
  for (const segment of segments) cursor = cursor[Number.isInteger(Number(segment)) ? Number(segment) : segment];
  cursor[Number.isInteger(Number(last)) ? Number(last) : last] = value;
}

async function fixture(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function query(index, text) {
  const normalized = text.toLowerCase();
  return index.documents
    .filter((document) => JSON.stringify(document).toLowerCase().includes(normalized))
    .map((document) => document.content_id);
}

test('M5.6 source validates against the frozen authority', () => {
  assert.deepEqual(validateSource(source, authority, validationFixture), []);
  assert.equal(source.freeze.selector_sha256, EXPECTED_SELECTOR_SHA256);
  assert.equal(source.generated_dependency.expected_sha256, EXPECTED_DEPENDENCY_SHA256);
});

test('generated files are deterministic and checked in', async () => {
  const result = await generate({ check: true });
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('publication corpus has exact identities, routes and English-only published locales', () => {
  const manifest = outputs['content-manifest.json'];
  assert.equal(manifest.content.length, 15);
  assert.equal(manifest.routes.length, 15);
  assert.equal(new Set(manifest.content.map((entity) => entity.content_id)).size, 15);
  assert.equal(new Set(manifest.content.map((entity) => entity.route_key)).size, 15);
  assert.ok(manifest.routes.every((route) => route.locale === 'en' && route.hreflang_eligible));
  assert.ok(manifest.content.every((entity) => entity.locales.find((locale) => locale.locale === 'pt')?.translation_state === 'unavailable'));
  assert.doesNotMatch(JSON.stringify(manifest.routes), /\/pt\//);
});

test('Course contains the deep branches and one repeated canonical reference', () => {
  assert.equal(source.course.root_content_id, 'cnt:p5m56:000001');
  assert.equal(source.course.references.length, 15);
  const repeated = source.course.references.filter((row) => row.content_id === 'cnt:p5m56:000006');
  assert.deepEqual(repeated.map((row) => row.reference_id), ['m56cr0005', 'm56cr0013']);
  const manifest = outputs['outline-manifest.json'];
  const course = manifest.projections[0];
  const placements = course.placements.filter((row) => row.contentId === 'cnt:p5m56:000006');
  assert.equal(placements.length, 2);
  assert.equal(new Set(placements.map((row) => row.canonicalRoute)).size, 1);
  assert.deepEqual(placements.find((row) => row.referenceId === 'm56cr0013').structuralTokens, {
    module: ['signed-number-operations'],
    unit: ['integer-sign-laws']
  });
  assert.ok(course.structuralFilterSchema.find((group) => group.id === 'module').options.length >= 3);
  assert.ok(course.structuralFilterSchema.find((group) => group.id === 'unit').options.length >= 3);
});

test('learner readiness remains distinct from Course order and formal dependencies', () => {
  assert.deepEqual(source.readiness.map((edge) => edge.id), ['READY-P1-000001', 'READY-P1-000006']);
  assert.deepEqual(source.readiness.map((edge) => edge.to_candidate_id), ['CAND-P1-000004', 'CAND-P1-000009']);
  const topModules = source.course.references
    .filter((row) => row.parent_content_id === source.course.root_content_id)
    .map((row) => row.content_id);
  assert.deepEqual(topModules, ['cnt:p5m56:000002', 'cnt:p5m56:000011', 'cnt:p5m56:000007']);
  assert.ok(!JSON.stringify(source.readiness).includes('FART-P2'));
});

test('all ten formal bindings appear in governed representation blocks', () => {
  const blocks = source.content.flatMap((entity) => entity.blocks ?? []).filter((block) => block.formal_binding);
  assert.equal(blocks.length, 10);
  const tuples = new Set(blocks.map((block) => [
    block.formal_binding.fart_id,
    block.formal_binding.floc_id,
    block.formal_binding.flink_id
  ].join('/')));
  for (const binding of source.formal_bindings) {
    assert.ok(tuples.has([binding.fart_id, binding.floc_id, binding.flink_id].join('/')));
  }
  assert.equal(outputs['publication.json'].generated_dependency.canonical_sha256, EXPECTED_DEPENDENCY_SHA256);
});

test('current locator is used and historical factored-example locator remains disclosure only', () => {
  const example = source.formal_bindings.find((binding) => binding.fart_id === 'FART-P2-000003');
  assert.equal(example.floc_id, 'FLOC-P2-000004');
  const historical = authority.locators.find((locator) => locator.id === 'FLOC-P2-000003');
  assert.equal(historical.locator_status, 'historical');
  assert.deepEqual(historical.superseded_by_locator_refs, ['FLOC-P2-000004']);
});

test('exercise is typed, closed initially and preserves all formal checkpoints', () => {
  const exercise = source.content.find((entity) => entity.content_id === 'cnt:p5m56:000006');
  assert.equal(exercise.kind, 'exercise');
  assert.equal(exercise.exercise.solution_initially_open, false);
  assert.deepEqual(exercise.exercise.checkpoints, ['7(4+3)=n', '7·4+7·3=n', 'n=49']);
  assert.match(exercise.blocks[0].lean.source, /distribute_first_addend_only_is_wrong/);
});

test('global search probes return the frozen production entities only', () => {
  const index = outputs['search-index.json'];
  for (const id of ['cnt:p5m56:000004', 'cnt:p5m56:000006']) assert.ok(query(index, 'distributive').includes(id));
  assert.ok(query(index, 'FART-P2-000010').includes('cnt:p5m56:000006'));
  assert.ok(query(index, 'Nat.instDistrib').includes('cnt:p5m56:000004'));
  for (const id of ['cnt:p5m56:000004', 'cnt:p5m56:000005', 'cnt:p5m56:000006']) assert.ok(query(index, 'CAND-P1-000004').includes(id));
  assert.doesNotMatch(JSON.stringify(index), /FMC-M56-A|fmc\.m56|urn:fmc:validation/);
});

test('external projections fail closed while Course and Lean remain usable', () => {
  const outline = outputs['outline-manifest.json'];
  assert.deepEqual(outline.projections.map((projection) => projection.id), ['course', 'ontomathpro', 'msc2020', 'arxiv', 'lean-mathlib']);
  assert.equal(outline.projections[0].state, 'current');
  assert.equal(outline.projections[4].state, 'current');
  for (const projection of outline.projections.slice(1, 4)) assert.equal(projection.placements.length, 0);
  assert.match(JSON.stringify(outline.projections[4]), /Nat\.instDistrib/);
});

test('reserved all-projection fixture is isolated from every production output', async () => {
  const text = JSON.stringify(outputs);
  const leakage = await fixture('fixtures/m5-6/invalid/fixture-leakage.json');
  for (const reserved of leakage.reserved_values) assert.ok(!text.includes(reserved), reserved);
  assert.equal(validationFixture.robots, 'noindex');
  assert.equal(validationFixture.sitemap, false);
  assert.equal(validationFixture.global_search, false);
});

for (const path of [
  'fixtures/m5-6/stale/formal-dependency.json',
  'fixtures/m5-6/invalid/duplicate-route-key.json',
  'fixtures/m5-6/invalid/dangling-reference.json'
]) {
  test('mutation fixture fails closed: ' + path, async () => {
    const mutation = await fixture(path);
    const changed = clone(source);
    setPath(changed, mutation.path, mutation.value);
    assert.match(validateSource(changed, authority, validationFixture).join('\n'), new RegExp(mutation.expected_error));
  });
}

test('missing snapshots are a valid governed input with explicit unavailable states', async () => {
  const missing = await fixture('fixtures/m5-6/missing/external-snapshots.json');
  assert.deepEqual(source.external_payloads, missing.external_payloads);
  assert.deepEqual(
    Object.fromEntries(outputs['content-manifest.json'].projections.slice(1, 4).map((projection) => [projection.key, projection.state])),
    missing.expected_states
  );
  assert.equal(missing.expected_effective_projection, 'course');
});
