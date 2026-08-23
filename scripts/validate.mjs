import { readFile } from 'node:fs/promises';

export const projectionKeys = ['course', 'ontomathpro', 'msc2020', 'arxiv', 'lean-mathlib'];

export function validateManifest(manifest) {
  const errors = [];
  if (manifest.schema_version !== 'p5-content-manifest/v1') errors.push('unknown schema version');
  if (manifest.canonical_host !== 'https://formal-math-curriculum.github.io') errors.push('canonical host mismatch');

  const routeKeys = new Set();
  const contentIds = new Set();
  for (const entity of manifest.content ?? []) {
    if (contentIds.has(entity.content_id)) errors.push(`duplicate content_id: ${entity.content_id}`);
    if (routeKeys.has(entity.route_key)) errors.push(`duplicate route_key: ${entity.route_key}`);
    contentIds.add(entity.content_id);
    routeKeys.add(entity.route_key);
    if (!/^[a-z0-9]{10,20}$/.test(entity.route_key ?? '')) errors.push(`invalid route_key: ${entity.route_key}`);
  }

  const actualProjectionKeys = (manifest.projections ?? []).map(({ key }) => key);
  if (JSON.stringify(actualProjectionKeys) !== JSON.stringify(projectionKeys)) errors.push('projection set/order must be exactly the five adopted projections');
  if ((manifest.projections ?? []).filter(({ default: isDefault }) => isDefault).map(({ key }) => key).join() !== 'course') errors.push('Course must be the sole default projection');

  const paths = new Set();
  for (const route of manifest.routes ?? []) {
    if (!contentIds.has(route.content_id)) errors.push(`dangling route: ${route.content_id}`);
    if (paths.has(route.path)) errors.push(`duplicate route path: ${route.path}`);
    paths.add(route.path);
    if (route.translation_state === 'stale' && route.hreflang_eligible !== false) errors.push('stale locale must be excluded from hreflang');
    if (route.translation_state === 'current_reviewed' && route.hreflang_eligible !== true) errors.push('current reviewed locale must be hreflang eligible');
  }

  for (const redirect of manifest.redirects ?? []) {
    if (!Number.isInteger(redirect.raw_edge_count) || redirect.raw_edge_count < 1 || redirect.raw_edge_count > 8) errors.push('redirect raw_edge_count must be 1..8');
    if (redirect.source === redirect.target) errors.push('self redirect');
  }

  if ((manifest.external_payloads ?? []).some(({ license_state }) => license_state !== 'qualified')) errors.push('unqualified external payload must not be vendored');
  return errors;
}

export async function loadAndValidate(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  return validateManifest(manifest);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/'))) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: node scripts/validate.mjs <manifest.json>');
  const errors = await loadAndValidate(path);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`validated ${path}`);
  }
}

