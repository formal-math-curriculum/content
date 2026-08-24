import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/u;
const SHA64 = /^[0-9a-f]{64}$/u;
const ID_PATTERNS = {
  fart_id: /^FART-P2-[0-9]{6}$/u,
  floc_id: /^FLOC-P2-[0-9]{6}$/u,
  flink_id: /^FLINK-P2-[0-9]{6}$/u
};

function pairKey(from, to) {
  return `${from}->${to}`;
}

function actorRoles(packet) {
  return new Map((packet.actors ?? []).map((actor) => [actor.actor_id, new Set(actor.roles ?? [])]));
}

function requireRole(errors, roles, actorId, role, context) {
  if (!actorId || !roles.get(actorId)?.has(role)) errors.push(`${context} requires ${role}`);
}

function requireDistinct(errors, authorId, reviewerId, context) {
  if (authorId && reviewerId && authorId === reviewerId) errors.push(`${context} requires a distinct reviewer`);
}

function allowedTransition(machine, from, to) {
  return new Set((machine?.transitions ?? []).map(([left, right]) => pairKey(left, right))).has(pairKey(from, to));
}

export function deriveTranslationState({ canonical_source_revision, translation_source_revision, review_decision }) {
  if (!translation_source_revision) return 'unavailable';
  if (canonical_source_revision !== translation_source_revision) return 'stale';
  return review_decision === 'approved' ? 'current_reviewed' : 'draft';
}

export function validateWorkflowPolicy(policy) {
  const errors = [];
  if (policy.schema_version !== 'p5-m58-editorial-workflow-policy/v1') errors.push('unknown workflow policy schema');
  if (policy.decision_id !== 'P5-M5.8-OPERATIONS-FREEZE-v1' || policy.issue !== 'MAT-366') errors.push('workflow policy decision/issue mismatch');
  if (policy.authority?.canonical_editorial_repository !== 'formal-math-curriculum/content') errors.push('canonical editorial authority mismatch');
  if (policy.authority?.formal_repository !== 'formal-math-curriculum/lean') errors.push('formal authority mismatch');
  if (policy.authority?.website_repository !== 'formal-math-curriculum/formal-math-curriculum.github.io') errors.push('website authority mismatch');
  if (policy.authority?.generated_outputs_are_authority !== false || policy.authority?.translations_are_independent_authority !== false) errors.push('derived authority boundary mismatch');
  if (policy.deployment_authorized !== false || policy.state_machines?.publication?.deployment_authorized !== false) errors.push('M5.8 workflow cannot authorize deployment');

  const roles = new Set(policy.roles ?? []);
  for (const required of [
    'canonical_english_author', 'mathematical_editorial_reviewer', 'semantic_correspondence_reviewer',
    'translation_author', 'translation_reviewer', 'classification_alignment_reviewer',
    'snapshot_licensing_steward', 'website_implementer', 'release_coordinator', 'release_approver'
  ]) if (!roles.has(required)) errors.push(`missing workflow role: ${required}`);

  const machines = policy.state_machines ?? {};
  for (const [name, required] of Object.entries({
    editorial: ['draft', 'in_review', 'current_reviewed', 'stale', 'deprecated', 'withdrawn'],
    formal_correspondence: ['exact', 'scoped', 'related', 'unreviewed', 'unavailable', 'stale', 'incompatible'],
    translation: ['draft', 'current_reviewed', 'stale', 'unavailable'],
    publication: ['draft', 'candidate_not_deployed', 'release_approved', 'published', 'superseded', 'rolled_back']
  })) {
    const states = new Set(machines[name]?.states ?? []);
    for (const state of required) if (!states.has(state)) errors.push(`${name} missing state ${state}`);
  }
  for (const state of ['mapped', 'partially_mapped', 'unmapped', 'not_applicable', 'needs_review']) {
    if (!machines.alignment?.coverage_states?.includes(state)) errors.push(`alignment missing coverage state ${state}`);
  }
  for (const state of ['current', 'stale', 'unavailable', 'license_needs_review', 'incompatible']) {
    if (!machines.alignment?.snapshot_states?.includes(state)) errors.push(`alignment missing snapshot state ${state}`);
  }
  for (const system of ['ontomathpro', 'msc2020', 'arxiv']) {
    if (!machines.alignment?.systems?.includes(system)) errors.push(`alignment missing system ${system}`);
  }
  if (machines.translation?.canonical_locale !== 'en' || machines.translation?.fallback_locale !== 'en') errors.push('English root/fallback policy mismatch');
  if (machines.translation?.automatic_locale_negotiation !== false || machines.translation?.stale_hreflang_eligible !== false) errors.push('translation negotiation/hreflang policy mismatch');
  if (policy.attribution?.required !== true || policy.attribution?.canonical_source_revision_format !== 'sha256') errors.push('attribution/source revision policy mismatch');
  return errors;
}

export function validateChangePacket(policy, packet) {
  const errors = [...validateWorkflowPolicy(policy)];
  if (packet.schema_version !== 'p5-m58-change-packet/v1') errors.push('unknown change packet schema');
  if (!/^MAT-[0-9]+$/u.test(packet.issue ?? '')) errors.push('missing Linear issue identifier');
  if (!packet.change_id) errors.push('missing change_id');
  if (packet.deployment_authorized !== false) errors.push('change packet cannot authorize deployment');

  for (const key of policy.required_exact_bases ?? []) {
    if (!SHA40.test(packet.exact_bases?.[key] ?? '')) errors.push(`missing or invalid exact base: ${key}`);
  }

  const roles = actorRoles(packet);
  const validRoles = new Set(policy.roles ?? []);
  for (const actor of packet.actors ?? []) {
    if (!actor.actor_id) errors.push('actor missing actor_id');
    for (const role of actor.roles ?? []) if (!validRoles.has(role)) errors.push(`unknown actor role: ${role}`);
  }
  if (!roles.size) errors.push('change packet has no actors');

  const attribution = packet.attribution ?? {};
  if (!(attribution.source_references ?? []).length) errors.push('change packet requires source attribution');
  if (!(attribution.contributor_actor_ids ?? []).length) errors.push('change packet requires contributor attribution');
  for (const actorId of attribution.contributor_actor_ids ?? []) {
    if (!roles.has(actorId)) errors.push(`attribution references unknown actor: ${actorId}`);
  }

  const validFamilies = new Set(policy.change_families ?? []);
  if (!(packet.change_families ?? []).length) errors.push('change packet has no change families');
  for (const family of packet.change_families ?? []) if (!validFamilies.has(family)) errors.push(`unknown change family: ${family}`);
  for (const [section, family] of Object.entries({
    editorial_changes: 'editorial',
    semantic_reviews: 'semantic_correspondence',
    translation_changes: 'translation',
    alignment_changes: 'classification_alignment',
    generated_outputs: 'generated_mirror',
    publication_changes: 'publication_candidate'
  })) {
    if ((packet[section] ?? []).length && !packet.change_families?.includes(family)) errors.push(`${section} requires change family ${family}`);
  }

  for (const mutation of packet.authority_mutations ?? []) {
    const expected = policy.fact_family_repositories?.[mutation.fact_family];
    if (!expected) errors.push(`unknown fact family: ${mutation.fact_family}`);
    else if (mutation.repository !== expected) errors.push(`wrong authority repository for ${mutation.fact_family}`);
  }

  const editorial = policy.state_machines?.editorial;
  for (const change of packet.editorial_changes ?? []) {
    const context = `editorial ${change.content_id ?? 'unknown'}`;
    if (!allowedTransition(editorial, change.from, change.to)) errors.push(`${context} has invalid transition ${change.from}->${change.to}`);
    requireRole(errors, roles, change.author_id, 'canonical_english_author', context);
    if (!attribution.contributor_actor_ids?.includes(change.author_id)) errors.push(`${context} author is absent from attribution`);
    if (change.to === 'current_reviewed') {
      requireRole(errors, roles, change.reviewer_id, 'mathematical_editorial_reviewer', context);
      requireDistinct(errors, change.author_id, change.reviewer_id, context);
      if (change.review_decision !== 'approved') errors.push(`${context} requires approved review`);
      if (!(change.source_refs ?? []).length) errors.push(`${context} requires source references`);
      for (const sourceRef of change.source_refs ?? []) if (!attribution.source_references?.includes(sourceRef)) errors.push(`${context} source reference is absent from attribution: ${sourceRef}`);
      if (!SHA64.test(change.result_source_sha256 ?? '')) errors.push(`${context} requires exact canonical source digest`);
    }
    if (change.from === 'current_reviewed' && change.to === 'in_review' && (change.material_change !== true || !(change.invalidates ?? []).length)) errors.push(`${context} material change requires dependent revalidation records`);
    if (change.to === 'deprecated' && (!change.reason || !change.replacement_or_recovery || !SHA40.test(change.effective_revision ?? ''))) errors.push(`${context} deprecation requires reason, replacement/recovery and exact revision`);
    if (change.to === 'withdrawn' && (!change.reason || !roles.has(change.owner_id) || !SHA40.test(change.effective_revision ?? ''))) errors.push(`${context} withdrawal requires reason, owner and exact revision`);
  }

  const correspondence = policy.state_machines?.formal_correspondence;
  const reviewedCorrespondence = new Set(correspondence?.reviewed_states ?? []);
  for (const review of packet.semantic_reviews ?? []) {
    const context = `semantic review ${review.content_id ?? 'unknown'}/${review.block_id ?? 'unknown'}`;
    if (!allowedTransition(correspondence, review.from, review.to)) errors.push(`${context} has invalid transition ${review.from}->${review.to}`);
    if (reviewedCorrespondence.has(review.to)) {
      requireRole(errors, roles, review.author_id, 'canonical_english_author', context);
      requireRole(errors, roles, review.reviewer_id, 'semantic_correspondence_reviewer', context);
      requireDistinct(errors, review.author_id, review.reviewer_id, context);
      if (review.review_decision !== 'approved') errors.push(`${context} requires approved semantic review`);
      for (const [key, pattern] of Object.entries(ID_PATTERNS)) if (!pattern.test(review[key] ?? '')) errors.push(`${context} missing exact ${key}`);
      if (review.project_revision !== packet.exact_bases?.lean) errors.push(`${context} Lean revision does not match exact base`);
      if (review.dependency_revision !== packet.exact_bases?.mathlib) errors.push(`${context} mathlib revision does not match exact base`);
      if (!SHA64.test(review.rendered_sha256 ?? '') || !SHA64.test(review.latex_sha256 ?? '')) errors.push(`${context} requires exact rendered and LaTeX digests`);
      if (review.compilation_only === true) errors.push(`${context} cannot use compilation as semantic review`);
    }
  }

  const translation = policy.state_machines?.translation;
  for (const change of packet.translation_changes ?? []) {
    const context = `translation ${change.content_id ?? 'unknown'}/${change.locale ?? 'unknown'}`;
    if (!allowedTransition(translation, change.from, change.to)) errors.push(`${context} has invalid transition ${change.from}->${change.to}`);
    if (change.locale === translation?.canonical_locale) errors.push(`${context} cannot redefine canonical English as a translation`);
    const derived = deriveTranslationState(change);
    if (change.to !== derived) errors.push(`${context} state must be ${derived} for the recorded source/review`);
    if (!SHA64.test(change.canonical_source_revision ?? '')) errors.push(`${context} canonical source revision must be a SHA-256 digest`);
    if (change.translation_source_revision && !SHA64.test(change.translation_source_revision)) errors.push(`${context} translation source revision must be a SHA-256 digest`);
    if (change.to === 'current_reviewed') {
      requireRole(errors, roles, change.author_id, 'translation_author', context);
      requireRole(errors, roles, change.reviewer_id, 'translation_reviewer', context);
      requireDistinct(errors, change.author_id, change.reviewer_id, context);
      if (change.hreflang_eligible !== true) errors.push(`${context} current reviewed translation must be hreflang eligible`);
      if (change.localized_route_eligible !== true || change.sitemap_eligible !== true) errors.push(`${context} current reviewed translation must emit a canonical localized route and sitemap entry`);
    }
    if (['current_reviewed', 'stale'].includes(change.to)) {
      if (change.fallback_locale !== translation?.fallback_locale || change.automatic_locale_negotiation !== false) errors.push(`${context} must preserve English fallback without automatic negotiation`);
    }
    if (change.to === 'stale') {
      if (change.hreflang_eligible !== false) errors.push(`${context} stale translation must be excluded from hreflang`);
      if (change.localized_route_eligible === true && !change.freshness_disclosure) errors.push(`${context} public stale translation requires visible freshness disclosure`);
      if (change.sitemap_eligible !== change.localized_route_eligible) errors.push(`${context} stale sitemap eligibility must match localized route eligibility`);
    }
    if (['draft', 'unavailable'].includes(change.to) && [change.hreflang_eligible, change.localized_route_eligible, change.sitemap_eligible].some((value) => value !== false)) errors.push(`${context} draft/unavailable translation cannot emit locale routes, sitemap or hreflang`);
  }

  const alignment = policy.state_machines?.alignment;
  for (const change of packet.alignment_changes ?? []) {
    const context = `alignment ${change.content_id ?? 'unknown'}/${change.system ?? 'unknown'}`;
    if (!alignment?.systems?.includes(change.system)) errors.push(`${context} has unknown classification system`);
    if (!alignment?.coverage_states?.includes(change.coverage_state)) errors.push(`${context} has invalid coverage state`);
    if (!alignment?.snapshot_states?.includes(change.snapshot_state)) errors.push(`${context} has invalid snapshot state`);
    if (change.synthetic_fixture === true && ['mapped', 'partially_mapped'].includes(change.coverage_state)) errors.push(`${context} synthetic fixture cannot establish coverage`);
    if (['mapped', 'partially_mapped'].includes(change.coverage_state)) {
      requireRole(errors, roles, change.author_id, 'canonical_english_author', context);
      requireRole(errors, roles, change.reviewer_id, 'classification_alignment_reviewer', context);
      requireDistinct(errors, change.author_id, change.reviewer_id, context);
      if (change.snapshot_state !== 'current' || change.license_qualified !== true) errors.push(`${context} mapped coverage requires a current license-qualified snapshot`);
      if (!alignment?.relations?.includes(change.relation) || !change.external_id || !SHA64.test(change.snapshot_sha256 ?? '')) errors.push(`${context} mapped coverage requires relation, external ID and snapshot digest`);
      if (change.review_decision !== 'approved') errors.push(`${context} requires approved classification review`);
    }
  }

  for (const output of packet.generated_outputs ?? []) {
    const context = `generated output ${output.path ?? 'unknown'}`;
    if (output.hand_edited === true) errors.push(`${context} cannot be hand edited`);
    if (!(output.source_paths ?? []).length || !output.generator_path || !SHA64.test(output.generator_sha256 ?? '')) errors.push(`${context} requires source and exact generator provenance`);
  }

  const publication = policy.state_machines?.publication;
  for (const change of packet.publication_changes ?? []) {
    const context = `publication ${change.candidate_id ?? 'unknown'}`;
    if (!allowedTransition(publication, change.from, change.to)) errors.push(`${context} has invalid transition ${change.from}->${change.to}`);
    requireRole(errors, roles, change.coordinator_id, 'release_coordinator', context);
    if (change.to === 'candidate_not_deployed') {
      if (!change.candidate_selector || change.preview_only !== true) errors.push(`${context} candidate requires selector and preview-only evidence`);
    }
    if (['release_approved', 'published', 'superseded', 'rolled_back'].includes(change.to)) errors.push(`${context} transition belongs to the separate release/rollback authority`);
  }

  return [...new Set(errors)];
}

export function validateCaseMatrix(policy, matrix) {
  const errors = [];
  if (matrix.schema_version !== 'p5-m58-workflow-cases/v1') return ['unknown workflow case matrix schema'];
  for (const entry of matrix.cases ?? []) {
    const observed = validateChangePacket(policy, entry.packet);
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
  if (!policyPath || !matrixPath) throw new Error('usage: node scripts/validate-m5-8-workflow.mjs <policy.json> <cases.json>');
  const [policy, matrix] = await Promise.all([json(policyPath), json(matrixPath)]);
  const errors = validateCaseMatrix(policy, matrix);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`validated ${matrix.cases.length} M5.8 editorial workflow cases`);
  }
}
