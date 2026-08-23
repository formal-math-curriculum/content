import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAndValidate, validateManifest } from '../scripts/validate.mjs';

test('bounded minimal manifest is valid', async () => {
  assert.deepEqual(await loadAndValidate('fixtures/minimal/manifest.json'), []);
});

test('duplicate route key is rejected', async () => {
  assert.match((await loadAndValidate('fixtures/invalid/duplicate-route-key.json')).join('\n'), /duplicate route_key/);
});

test('sixth public projection is rejected', async () => {
  assert.match((await loadAndValidate('fixtures/invalid/sixth-projection.json')).join('\n'), /exactly the five/);
});

test('missing required manifest metadata is rejected', () => {
  const manifest = { content: [], routes: [], redirects: [], projections: [], external_payloads: [] };
  assert.match(validateManifest(manifest).join('\n'), /unknown schema version/);
  assert.match(validateManifest(manifest).join('\n'), /canonical host mismatch/);
});

test('incompatible or unqualified external payload is rejected', () => {
  const manifest = {
    schema_version: 'p5-content-manifest/v1', canonical_host: 'https://formal-math-curriculum.github.io',
    content: [], routes: [], redirects: [],
    projections: [
      { key: 'course', default: true }, { key: 'ontomathpro' }, { key: 'msc2020' }, { key: 'arxiv' }, { key: 'lean-mathlib' }
    ],
    external_payloads: [{ system: 'msc2020', license_state: 'incompatible' }]
  };
  assert.match(validateManifest(manifest).join('\n'), /unqualified external payload/);
});

test('stale translation cannot enter hreflang alternates', () => {
  const manifest = {
    schema_version: 'p5-content-manifest/v1',
    canonical_host: 'https://formal-math-curriculum.github.io',
    content: [{ content_id: 'cnt:a', route_key: 'routekey001', kind: 'definition', locales: [], maturity: {} }],
    routes: [{ content_id: 'cnt:a', route_key: 'routekey001', path: '/pt/content/routekey001/a/', translation_state: 'stale', hreflang_eligible: true }],
    redirects: [], external_payloads: [],
    projections: [
      { key: 'course', default: true }, { key: 'ontomathpro' }, { key: 'msc2020' }, { key: 'arxiv' }, { key: 'lean-mathlib' }
    ]
  };
  assert.match(validateManifest(manifest).join('\n'), /stale locale/);
});

test('redirect lineage beyond eight edges is rejected', () => {
  const manifest = {
    schema_version: 'p5-content-manifest/v1', canonical_host: 'https://formal-math-curriculum.github.io',
    content: [], routes: [], external_payloads: [],
    redirects: [{ source: '/old/', target: '/new/', raw_edge_count: 9 }],
    projections: [
      { key: 'course', default: true }, { key: 'ontomathpro' }, { key: 'msc2020' }, { key: 'arxiv' }, { key: 'lean-mathlib' }
    ]
  };
  assert.match(validateManifest(manifest).join('\n'), /1\.\.8/);
});
