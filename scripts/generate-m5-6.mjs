import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_PATH = resolve(ROOT, 'source/m5-6/slice.json');
const FORMAL_PATH = resolve(ROOT, 'source/m5-6/formal-authority.json');
const VALIDATION_FIXTURE_PATH = resolve(ROOT, 'fixtures/m5-6/validation/all-projections.json');
const OUTPUT_DIR = resolve(ROOT, 'generated/m5-6');

export const EXPECTED_SELECTOR_SHA256 = '280ad055d9235077b398d26dd6abb40c9d13ae089ad6d5a8fd0b11baed805aaf';
export const EXPECTED_DEPENDENCY_SHA256 = 'f8c79c8d196952e4827c72d394039862935689b2e100f821697c41bad8cb1438';

const CONTENT_KINDS = new Set([
  'definition', 'theorem', 'example', 'exercise', 'application', 'editorial_unit',
  'learning_path', 'module', 'unit', 'curriculum_reference'
]);
const EXTERNAL_SYSTEMS = ['ontomathpro', 'msc2020', 'arxiv'];
const SHA40 = /^[0-9a-f]{40}$/;
const ROUTE_KEY = /^[a-z0-9]{10,20}$/;

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
    );
  }
  return value;
}

export function compactStableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256(value) {
  const input = typeof value === 'string' ? value : compactStableJson(value);
  return createHash('sha256').update(input).digest('hex');
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function routeFor(entity) {
  return `/content/${entity.route_key}/${entity.slug}/`;
}

function formalById(authority, key) {
  return new Map(authority[key].map((row) => [row.id, row]));
}

function selectorFromSource(source) {
  return {
    schemaVersion: 'p5-m56-slice-freeze/v1',
    bases: {
      site: source.bases.site,
      content: source.bases.content,
      lean: source.bases.lean,
      leanCore: source.bases.lean_core,
      mathlib: source.bases.mathlib
    },
    content: source.content.map((entity) => [
      entity.content_id,
      entity.route_key,
      entity.kind,
      entity.slug,
      entity.curriculum_candidate_id ?? null
    ]),
    course: source.course.references.map((reference) => [
      reference.reference_id,
      reference.parent_content_id,
      reference.content_id,
      reference.order,
      reference.role
    ]),
    readiness: source.readiness.map((edge) => [
      edge.id,
      edge.from_candidate_id,
      edge.to_candidate_id,
      edge.relation,
      edge.confidence
    ]),
    formal: source.formal_bindings.map((binding) => [
      binding.content_id,
      binding.fart_id,
      binding.floc_id,
      binding.flink_id,
      binding.disclosure
    ]),
    externalActual: {
      subject: source.external_alignments[0].content_id,
      ontomathpro: [source.external_alignments[0].coverage_state, source.external_alignments[0].snapshot_state],
      msc2020: [source.external_alignments[1].coverage_state, source.external_alignments[1].snapshot_state],
      arxiv: [source.external_alignments[2].coverage_state, source.external_alignments[2].snapshot_state]
    },
    validation: source.validation_selector
  };
}

function dependencyTuple(source, authority) {
  const selected = source.generated_dependency;
  return {
    schemaVersion: selected.schema_version,
    generator: selected.generator,
    subjectContentId: selected.content_id,
    projectRevision: source.bases.lean,
    dependencyRevision: source.bases.mathlib,
    artifactId: selected.fart_id,
    locatorId: selected.floc_id,
    linkId: selected.flink_id,
    module: selected.module,
    declarations: selected.declarations,
    registryBlobs: authority.registry_blobs
  };
}

function dependencyHash(source, authority) {
  return sha256(`${compactStableJson(dependencyTuple(source, authority))}\n`);
}

function findCycle(root, children, visiting = new Set(), visited = new Set()) {
  if (visiting.has(root)) return true;
  if (visited.has(root)) return false;
  visiting.add(root);
  for (const child of children.get(root) ?? []) {
    if (findCycle(child, children, visiting, visited)) return true;
  }
  visiting.delete(root);
  visited.add(root);
  return false;
}

export function validateSource(source, authority, validationFixture) {
  const errors = [];
  if (source.schema_version !== 'p5-m56-source/v1') errors.push('unknown M5.6 source schema');
  if (source.freeze?.selector_sha256 !== EXPECTED_SELECTOR_SHA256) errors.push('freeze selector hash mismatch');
  if (source.freeze?.decision_id !== 'P5-M5.6-SLICE-FREEZE-v1') errors.push('freeze decision mismatch');
  for (const [key, value] of Object.entries(source.bases ?? {})) {
    if (!SHA40.test(value)) errors.push(`invalid base revision: ${key}`);
  }

  const ids = new Set();
  const routeKeys = new Set();
  const routes = new Set();
  if (source.content?.length !== 15) errors.push('frozen corpus must contain exactly 15 entities');
  for (const entity of source.content ?? []) {
    if (ids.has(entity.content_id)) errors.push(`duplicate content_id: ${entity.content_id}`);
    if (routeKeys.has(entity.route_key)) errors.push(`route_key_collision: ${entity.route_key}`);
    ids.add(entity.content_id);
    routeKeys.add(entity.route_key);
    if (!ROUTE_KEY.test(entity.route_key ?? '')) errors.push(`invalid route key: ${entity.route_key}`);
    if (!CONTENT_KINDS.has(entity.kind)) errors.push(`invalid content kind: ${entity.kind}`);
    const route = routeFor(entity);
    if (routes.has(route)) errors.push(`duplicate canonical route: ${route}`);
    routes.add(route);
    if (!entity.title || !entity.summary || !Array.isArray(entity.objectives) || entity.objectives.length === 0) {
      errors.push(`missing editorial provenance: ${entity.content_id}`);
    }
    if (!Array.isArray(entity.source_refs) || entity.source_refs.length === 0) {
      errors.push(`missing source refs: ${entity.content_id}`);
    }
    const en = entity.locales?.find((locale) => locale.locale === 'en');
    const pt = entity.locales?.find((locale) => locale.locale === 'pt');
    if (entity.locales?.length !== 2 || en?.translation_state !== 'current_reviewed' || pt?.translation_state !== 'unavailable') {
      errors.push(`locale contract mismatch: ${entity.content_id}`);
    }
    if (en?.slug !== entity.slug || pt?.slug !== entity.slug) errors.push(`locale slug mismatch: ${entity.content_id}`);
  }

  const references = source.course?.references ?? [];
  if (references.length !== 15) errors.push('Course must contain exactly 15 frozen references');
  const referenceIds = new Set();
  const siblingOrders = new Set();
  const children = new Map();
  for (const reference of references) {
    if (referenceIds.has(reference.reference_id)) errors.push(`duplicate reference: ${reference.reference_id}`);
    referenceIds.add(reference.reference_id);
    if (!ids.has(reference.content_id) || !ids.has(reference.parent_content_id)) {
      errors.push(`dangling_reference: ${reference.reference_id}`);
    }
    const orderKey = `${reference.parent_content_id}:${reference.order}`;
    if (siblingOrders.has(orderKey)) errors.push(`unstable sibling order: ${orderKey}`);
    siblingOrders.add(orderKey);
    const list = children.get(reference.parent_content_id) ?? [];
    list.push(reference.content_id);
    children.set(reference.parent_content_id, list);
  }
  for (const id of ids) {
    if (findCycle(id, children)) {
      errors.push(`Course cycle at ${id}`);
      break;
    }
  }
  const repeated = references.filter((row) => row.content_id === 'cnt:p5m56:000006');
  if (repeated.length !== 2 || !repeated.some((row) => row.reference_id === 'm56cr0013' && row.role === 'review')) {
    errors.push('frozen repeated reference is missing');
  }

  const expectedReadiness = [
    ['READY-P1-000001', 'CAND-P1-000003', 'CAND-P1-000004'],
    ['READY-P1-000006', 'CAND-P1-000004', 'CAND-P1-000009']
  ];
  if (JSON.stringify((source.readiness ?? []).map((edge) => [edge.id, edge.from_candidate_id, edge.to_candidate_id])) !== JSON.stringify(expectedReadiness)) {
    errors.push('readiness chain differs from the freeze');
  }

  const farts = formalById(authority, 'artifacts');
  const flocs = formalById(authority, 'locators');
  const flinks = formalById(authority, 'links');
  if (source.formal_bindings?.length !== 10) errors.push('frozen corpus must contain exactly 10 formal bindings');
  for (const binding of source.formal_bindings ?? []) {
    const fart = farts.get(binding.fart_id);
    const floc = flocs.get(binding.floc_id);
    const flink = flinks.get(binding.flink_id);
    if (!fart || !floc || !flink) errors.push(`missing formal authority: ${binding.fart_id}/${binding.floc_id}/${binding.flink_id}`);
    if (floc?.locator_status !== 'current' || floc?.formal_artifact_ref !== binding.fart_id) errors.push(`non-current locator: ${binding.floc_id}`);
    if (flink?.formal_artifact_ref !== binding.fart_id || flink?.candidate_ref_current_resolved !== binding.curriculum_candidate_id) {
      errors.push(`formal curriculum mismatch: ${binding.flink_id}`);
    }
    if (!ids.has(binding.content_id)) errors.push(`formal binding has unknown content: ${binding.content_id}`);
  }

  if (source.external_payloads?.length !== 0) errors.push('external payloads must remain absent');
  if (source.external_alignments?.length !== 3) errors.push('exactly three missing-state external alignments are required');
  for (const [index, system] of EXTERNAL_SYSTEMS.entries()) {
    const alignment = source.external_alignments?.[index];
    if (alignment?.system !== system || alignment?.external_id !== undefined) {
      errors.push(`external alignment order/identity mismatch: ${system}`);
    }
  }

  const selectorHash = sha256(JSON.stringify(selectorFromSource(source)));
  if (selectorHash !== EXPECTED_SELECTOR_SHA256) errors.push(`freeze selector content mismatch: ${selectorHash}`);
  const observedDependencyHash = dependencyHash(source, authority);
  if (observedDependencyHash !== EXPECTED_DEPENDENCY_SHA256) errors.push(`stale_dependency_revision: ${observedDependencyHash}`);

  const validationString = JSON.stringify(validationFixture ?? {});
  if (validationFixture?.schema_version !== 'p5-m56-validation-fixture/v1'
      || validationFixture?.route !== '/validation/m5-6/'
      || validationFixture?.robots !== 'noindex'
      || validationFixture?.sitemap !== false
      || validationFixture?.global_search !== false) {
    errors.push('validation fixture isolation policy mismatch');
  }
  for (const reserved of [
    'urn:fmc:validation:m5-6:onto:parent-a',
    'urn:fmc:validation:m5-6:onto:parent-b',
    'FMC-M56-A', 'FMC-M56-B', 'fmc.m56'
  ]) {
    if (!validationString.includes(reserved)) errors.push(`validation fixture missing reserved identifier: ${reserved}`);
  }
  return errors;
}

function contentManifest(source) {
  return {
    schema_version: 'p5-content-manifest/v1',
    canonical_host: source.canonical_host,
    source_identity: source.source_identity,
    freeze_selector_sha256: source.freeze.selector_sha256,
    content: source.content.map((entity) => ({
      content_id: entity.content_id,
      route_key: entity.route_key,
      kind: entity.kind,
      maturity: entity.maturity,
      locales: entity.locales
    })),
    routes: source.content.map((entity) => ({
      content_id: entity.content_id,
      route_key: entity.route_key,
      locale: 'en',
      path: routeFor(entity),
      translation_state: 'current_reviewed',
      hreflang_eligible: true
    })),
    redirects: [],
    projections: [
      { key: 'course', state: 'current', default: true },
      { key: 'ontomathpro', state: 'unavailable', default: false },
      { key: 'msc2020', state: 'license_needs_review', default: false },
      { key: 'arxiv', state: 'unavailable', default: false },
      { key: 'lean-mathlib', state: 'current', default: false }
    ],
    external_payloads: []
  };
}

const universalFilterSchema = [
  { id: 'coverage', label: 'Mapping state', mode: 'multi', options: [
    { id: 'mapped', label: 'Mapped' }, { id: 'partial', label: 'Partially mapped' },
    { id: 'review', label: 'Needs review' }, { id: 'unmapped', label: 'Unmapped' }
  ] },
  { id: 'content-kind', label: 'Content kind', mode: 'multi', options: [
    { id: 'definition', label: 'Definition' }, { id: 'theorem', label: 'Theorem' },
    { id: 'example', label: 'Example' }, { id: 'exercise', label: 'Exercise' },
    { id: 'editorial-unit', label: 'Editorial unit' }, { id: 'structure', label: 'Course structure' }
  ] },
  { id: 'formalization', label: 'Formalization', mode: 'multi', options: [
    { id: 'current', label: 'Current' }, { id: 'unavailable', label: 'Unavailable' }
  ] },
  { id: 'correspondence', label: 'Correspondence', mode: 'multi', options: [
    { id: 'exact', label: 'Exact' }, { id: 'scoped', label: 'Scoped' }, { id: 'unavailable', label: 'Unavailable' }
  ] },
  { id: 'translation', label: 'Translation', mode: 'multi', options: [
    { id: 'current', label: 'English current' }, { id: 'unavailable', label: 'Portuguese unavailable' }
  ] }
];

function contentKindToken(kind) {
  if (kind === 'editorial_unit') return 'editorial-unit';
  if (['learning_path', 'module', 'unit'].includes(kind)) return 'structure';
  return kind;
}

function outlineManifest(source, authority) {
  const entities = new Map(source.content.map((entity) => [entity.content_id, entity]));
  const formalFor = new Map();
  for (const binding of source.formal_bindings) {
    const list = formalFor.get(binding.content_id) ?? [];
    list.push(binding);
    formalFor.set(binding.content_id, list);
  }
  const primaryReference = new Map([['cnt:p5m56:000001', 'm56root0001']]);
  for (const reference of source.course.references) {
    if (!primaryReference.has(reference.content_id) && reference.role === 'primary') primaryReference.set(reference.content_id, reference.reference_id);
  }

  function courseContext(reference) {
    const result = {};
    let current = reference.content_id;
    let parent = reference.parent_content_id;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const entity = entities.get(current);
      if (entity?.kind === 'module') result.module = entity.slug;
      if (entity?.kind === 'unit') result.unit = entity.slug;
      current = parent;
      const parentRef = source.course.references.find((row) => row.content_id === current && row.role === 'primary');
      parent = parentRef?.parent_content_id ?? null;
    }
    return result;
  }

  function universalTokens(entity) {
    const bindings = formalFor.get(entity.content_id) ?? [];
    const exact = bindings.some((binding) => binding.disclosure === 'exact');
    return {
      coverage: ['mapped'],
      'content-kind': [contentKindToken(entity.kind)],
      formalization: [bindings.length ? 'current' : 'unavailable'],
      correspondence: [bindings.length ? (exact ? 'exact' : 'scoped') : 'unavailable'],
      translation: ['current', 'unavailable']
    };
  }

  const root = entities.get('cnt:p5m56:000001');
  const coursePlacements = [{
    referenceId: 'm56root0001', parentReferenceId: null, kind: 'group', label: root.title,
    order: 0, state: 'mapped', contentId: root.content_id, canonicalRoute: routeFor(root),
    aliases: [root.slug], universalTokens: universalTokens(root), structuralTokens: {}
  }];
  for (const reference of source.course.references) {
    const entity = entities.get(reference.content_id);
    const context = courseContext(reference);
    const kind = entity.kind === 'module' ? 'group' : entity.kind === 'unit' ? 'presentation-heading' : 'reference';
    coursePlacements.push({
      referenceId: reference.reference_id,
      parentReferenceId: primaryReference.get(reference.parent_content_id),
      kind,
      label: reference.role === 'review' ? `${entity.title} (review)` : entity.title,
      order: reference.order,
      state: 'mapped',
      contentId: entity.content_id,
      canonicalRoute: routeFor(entity),
      aliases: [entity.slug, entity.curriculum_candidate_id, ...(entity.search_terms ?? []), ...((formalFor.get(entity.content_id) ?? []).map((row) => row.fart_id))].filter(Boolean),
      universalTokens: universalTokens(entity),
      structuralTokens: {
        ...(context.module ? { module: [context.module] } : {}),
        ...(context.unit ? { unit: [context.unit] } : {})
      }
    });
  }

  const farts = formalById(authority, 'artifacts');
  const flocs = formalById(authority, 'locators');
  const current = entities.get('cnt:p5m56:000004');
  const leanPlacements = [{
    referenceId: 'm56leanroot', parentReferenceId: null, kind: 'group', label: current.title,
    order: 0, state: 'mapped', contentId: current.content_id, canonicalRoute: routeFor(current),
    aliases: [current.slug, current.curriculum_candidate_id], universalTokens: universalTokens(current), structuralTokens: {}
  }];
  for (const [artifactOrder, binding] of (formalFor.get(current.content_id) ?? []).entries()) {
    const artifact = farts.get(binding.fart_id);
    const locator = flocs.get(binding.floc_id);
    const artifactRef = `m56leanartifact${String(artifactOrder + 1).padStart(2, '0')}`;
    const moduleRef = `m56leanmodule${String(artifactOrder + 1).padStart(2, '0')}`;
    leanPlacements.push({
      referenceId: artifactRef, parentReferenceId: 'm56leanroot', kind: 'artifact', label: `${binding.fart_id} — ${artifact.title_or_summary}`,
      order: artifactOrder, state: 'mapped', contentId: `formal:${binding.fart_id}`, canonicalRoute: `/formal/${binding.fart_id.toLowerCase()}/`,
      aliases: [binding.fart_id, binding.flink_id], universalTokens: universalTokens(current), structuralTokens: { 'lean-level': ['artifact'], 'lean-source': [locator.source_kind === 'dependency_repository' ? 'dependency' : 'project'] }
    });
    leanPlacements.push({
      referenceId: moduleRef, parentReferenceId: artifactRef, kind: 'module', label: locator.module_name,
      order: 0, state: 'mapped', contentId: `formal:module:${locator.module_name}`, canonicalRoute: `/formal/module/${locator.module_name.replaceAll('.', '/').toLowerCase()}/`,
      aliases: [locator.file_path], universalTokens: universalTokens(current), structuralTokens: { 'lean-level': ['module'], 'lean-source': [locator.source_kind === 'dependency_repository' ? 'dependency' : 'project'] }
    });
    for (const [declarationOrder, declaration] of locator.declaration_names.entries()) {
      leanPlacements.push({
        referenceId: `m56leandecl${String(artifactOrder + 1).padStart(2, '0')}${String(declarationOrder + 1).padStart(2, '0')}`,
        parentReferenceId: moduleRef,
        kind: 'declaration', label: declaration, order: declarationOrder, state: 'mapped',
        contentId: current.content_id, canonicalRoute: routeFor(current), aliases: [binding.floc_id, declaration],
        universalTokens: universalTokens(current), structuralTokens: { 'lean-level': ['declaration'], 'lean-source': [locator.source_kind === 'dependency_repository' ? 'dependency' : 'project'] }
      });
    }
  }

  const projection = (id, label, kind, state, rootMode, structuralFilterSchema, placements, activeReferenceId) => ({
    id, label, kind, state,
    fingerprint: `sha256:${sha256(placements)}`,
    landingRoute: `/outline/${id}/`, rootMode, activeReferenceId, structuralFilterSchema, placements
  });
  const unavailableSchema = (id, label) => [{ id, label, mode: 'multi', options: [{ id: 'unavailable', label: 'Unavailable' }] }];
  return {
    schemaVersion: 'p5-outline-manifest/v1',
    locale: 'en',
    currentContent: { contentId: current.content_id, canonicalRoute: routeFor(current) },
    universalFilterSchema,
    projections: [
      projection('course', 'Course', 'course-pedagogy', 'current', 'pedagogical', [
        { id: 'module', label: 'Module', mode: 'multi', options: source.content.filter((row) => row.kind === 'module').map((row) => ({ id: row.slug, label: row.title })) },
        { id: 'unit', label: 'Unit', mode: 'multi', options: source.content.filter((row) => row.kind === 'unit').map((row) => ({ id: row.slug, label: row.title })) }
      ], coursePlacements, 'm56cr0003'),
      projection('ontomathpro', 'OntoMathPRO', 'ontomathpro-polyhierarchy', 'unavailable', 'multiple-parents', unavailableSchema('onto-snapshot', 'OntoMathPRO snapshot'), [], null),
      projection('msc2020', 'MSC 2020', 'msc2020-classification', 'license-needs-review', 'classification-codes', unavailableSchema('msc-snapshot', 'MSC snapshot'), [], null),
      projection('arxiv', 'arXiv', 'arxiv-shallow-category', 'unavailable', 'shallow-categories', unavailableSchema('arxiv-snapshot', 'arXiv snapshot'), [], null),
      projection('lean-mathlib', 'Lean / mathlib', 'lean-content-drilldown', 'current', 'content-centered', [
        { id: 'lean-level', label: 'Lean drilldown level', mode: 'multi', options: [
          { id: 'artifact', label: 'Artifact' }, { id: 'module', label: 'Module' }, { id: 'declaration', label: 'Declaration' }
        ] },
        { id: 'lean-source', label: 'Formal source', mode: 'multi', options: [
          { id: 'project', label: 'Project' }, { id: 'dependency', label: 'Dependency' }
        ] }
      ], leanPlacements, 'm56leandecl0201')
    ]
  };
}

function searchIndex(source, authority) {
  const flocs = formalById(authority, 'locators');
  const formalFor = new Map();
  for (const binding of source.formal_bindings) {
    const list = formalFor.get(binding.content_id) ?? [];
    list.push(binding);
    formalFor.set(binding.content_id, list);
  }
  return {
    schema_version: 'p5-search-index/v1',
    locale: 'en',
    fixture_policy: 'production-only',
    documents: source.content.map((entity) => {
      const bindings = formalFor.get(entity.content_id) ?? [];
      return {
        content_id: entity.content_id,
        canonical_route: routeFor(entity),
        kind: entity.kind,
        title: entity.title,
        summary: entity.summary,
        objectives: entity.objectives,
        search_terms: entity.search_terms ?? [],
        curriculum_candidate_id: entity.curriculum_candidate_id ?? null,
        formal_ids: bindings.flatMap((binding) => [binding.fart_id, binding.floc_id, binding.flink_id]),
        declarations: bindings.flatMap((binding) => flocs.get(binding.floc_id)?.declaration_names ?? []),
        source_refs: entity.source_refs
      };
    })
  };
}

export function buildOutputs(source, authority) {
  const manifest = contentManifest(source);
  const outline = outlineManifest(source, authority);
  const search = searchIndex(source, authority);
  const publication = {
    schema_version: 'p5-m56-publication/v1',
    source_identity: source.source_identity,
    canonical_host: source.canonical_host,
    freeze: source.freeze,
    bases: source.bases,
    sources: source.sources,
    content: source.content,
    course: source.course,
    readiness: source.readiness,
    formal_bindings: source.formal_bindings,
    generated_dependency: {
      ...source.generated_dependency,
      canonical_sha256: dependencyHash(source, authority)
    },
    external_alignments: source.external_alignments,
    external_payloads: []
  };
  const primary = {
    'content-manifest.json': manifest,
    'outline-manifest.json': outline,
    'search-index.json': search,
    'publication.json': publication
  };
  const provenance = {
    schema_version: 'p5-m56-provenance/v1',
    generator: 'p5-m56-generator/v1',
    source_identity: source.source_identity,
    freeze_selector_sha256: source.freeze.selector_sha256,
    input_sha256: {
      source: sha256(source),
      formal_authority: sha256(authority)
    },
    output_sha256: Object.fromEntries(Object.entries(primary).map(([name, value]) => [name, sha256(value)])),
    exact_revisions: source.bases,
    external_payload_count: 0,
    fixture_scope: 'excluded-from-production-outputs'
  };
  return { ...primary, 'provenance.json': provenance };
}

function pretty(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function loadInputs() {
  const [source, authority, validationFixture] = await Promise.all([
    readJson(SOURCE_PATH), readJson(FORMAL_PATH), readJson(VALIDATION_FIXTURE_PATH)
  ]);
  return { source, authority, validationFixture };
}

export async function generate({ check = false } = {}) {
  const { source, authority, validationFixture } = await loadInputs();
  const errors = validateSource(source, authority, validationFixture);
  if (errors.length) return { ok: false, errors, outputs: null };
  const outputs = buildOutputs(source, authority);
  const productionText = JSON.stringify(outputs);
  for (const reserved of ['urn:fmc:validation:m5-6', 'FMC-M56-A', 'FMC-M56-B', 'fmc.m56']) {
    if (productionText.includes(reserved)) errors.push(`fixture_scope_violation: ${reserved}`);
  }
  if (errors.length) return { ok: false, errors, outputs: null };
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [name, value] of Object.entries(outputs)) {
    const path = resolve(OUTPUT_DIR, name);
    const expected = pretty(value);
    if (check) {
      let actual = '';
      try { actual = await readFile(path, 'utf8'); } catch { /* reported below */ }
      if (actual !== expected) errors.push(`generated output differs: ${name}`);
    } else {
      await writeFile(path, expected);
    }
  }
  return { ok: errors.length === 0, errors, outputs };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const result = await generate({ check: process.argv.includes('--check') });
  if (!result.ok) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(process.argv.includes('--check') ? 'M5.6 generated outputs are current' : 'generated M5.6 governed outputs');
  }
}
