# M5.8 editorial, semantic-review and translation workflow

This is the executable content-authority implementation of
`P5-M5.8-OPERATIONS-FREEZE-v1` for MAT-366. It does not authorize a release or
deployment.

## Adopted implementation decisions

The workflow uses a versioned JSON policy plus change packets checked in CI. This
was selected over prose-only review because state, role, provenance and authority
violations must fail deterministically. A GitHub-only approval rule was rejected as
insufficient: one person may hold several roles, so the exercised actor/role and the
distinct-review decision belong in durable evidence. A database-backed editorial
service was rejected because the adopted product is static and has no backend.

Canonical-source freshness uses a SHA-256 digest of the reviewed English source,
not a mutable branch name or a guessed future merge commit. Exact repository base
commits are recorded separately. Publication may advance only to
`candidate_not_deployed` here; release approval, publication, supersession and
rollback remain the separate MAT-367/Linear authority.

## Fresh-contributor path

1. Open or retrieve the Linear issue and identify the exact content, Lean, site and
   mathlib base commits. Do not begin from branch names alone.
2. Choose the authoritative repository. Editorial text, LaTeX, pedagogy,
   translations and curated classification alignments belong here. Lean source and
   FART/FLOC/FLINK remain in `formal-math-curriculum/lean`; site adapters remain in
   `formal-math-curriculum/formal-math-curriculum.github.io`.
3. Create a dedicated branch and complete the pull-request template. Record each
   actor, the role they exercise, source attribution and contributor attribution.
4. Edit source records. Regenerate disposable outputs; never hand-edit generated
   mirrors.
5. Run `pnpm generate`, `pnpm validate`, `pnpm test` and
   `pnpm check:generated` from a clean checkout.
6. Request the required review. An author cannot satisfy a required independent
   mathematical, semantic, translation or classification review on the same change.
7. Merge only after the exact review and CI subject are recorded. A dependent site
   change pins the resulting content commit rather than copying source truth.

## States and reviewers

Canonical English follows `draft → in_review → current_reviewed`. Material changes
return reviewed content to `in_review`; stale, deprecated and withdrawn states retain
identity and lineage. A material change records every dependent translation or
semantic correspondence requiring revalidation. Deprecation records reason,
replacement/recovery and exact effective revision; withdrawal records reason, owner
and exact effective revision.

Formal correspondence uses `exact`, `scoped`, `related`, `unreviewed`,
`unavailable`, `stale` and `incompatible`. A compiling nearby declaration is not a
semantic review. A reviewed result identifies the exact FART/FLOC/FLINK records,
Lean commit and mathlib commit.

Translations record the exact canonical-English source revision. Matching source
plus approved independent review produces `current_reviewed`. A mismatched source
is `stale` and must be excluded from hreflang equivalence. `draft` and `unavailable`
produce no canonical localized route or sitemap entry. A stale translation may keep
its localized route only with visible freshness disclosure; it remains outside
hreflang. English is the explicit fallback and remains canonical at root paths;
automatic locale negotiation stays disabled.

Classification alignments retain explicit `mapped`, `partially_mapped`, `unmapped`,
`not_applicable` or `needs_review` coverage. Mapped claims require a current,
license-qualified, hashed snapshot and independent classification review. Synthetic
fixtures can test mechanics but never establish public coverage.

## Change packet

`scripts/validate-m5-8-workflow.mjs` validates a
`p5-m58-change-packet/v1` against the versioned policy in
`source/m5-8/editorial-workflow-policy.json`; its portable envelope is documented by
`schemas/m5-8-change-packet.schema.json`. The packet records:

- Linear issue and change identity;
- exact content, Lean, site and mathlib bases;
- actor IDs and exercised roles;
- source references and contributor attribution;
- authoritative fact-family mutations;
- editorial, semantic, translation and alignment transitions;
- canonical-English, rendered-math and LaTeX SHA-256 fingerprints;
- generated-output source and generator provenance;
- candidate-only publication transitions;
- an explicit false deployment authorization.

The matrix in `fixtures/m5-8/workflow-cases.json` exercises valid reviewed work,
automatic translation staleness, unavailable-route suppression, deprecation lineage,
self-review, stale-source overclaim, missing formal traceability, synthetic-mapping
overclaim, wrong-repository authority, hand-edited generated output, missing exact
bases, incompatible schema and missing dependent revalidation.

## Accessibility and review ergonomics

Review evidence is text-first, ordered and usable without a graphical diff. Every
state has a visible name rather than color-only meaning. Error output names the
affected content/block/locale/system. Future contributor UI must preserve keyboard
operation, visible focus, status announcements and the same complete text
alternative.

## Revalidation and stop conditions

Revalidate after any workflow-policy/schema, actor requirement, canonical identity,
translation, formal locator, snapshot, authority boundary or generated-output rule
changes. Stop on ambiguous authority, unknown schema/state, missing exact commits,
unreviewed mathematics or semantic correspondence, stale translation labeled
current, unlicensed snapshot, synthetic coverage claim, hand-edited generated file,
or any attempt to authorize deployment through this workflow.
