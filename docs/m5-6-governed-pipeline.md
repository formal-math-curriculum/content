# M5.6 governed content and provenance pipeline

## Decision and ownership

`P5-M5.6-CONTENT-v1` materializes the exact selector frozen by MAT-346. The
selector SHA-256 is
`280ad055d9235077b398d26dd6abb40c9d13ae089ad6d5a8fd0b11baed805aaf`.

The `source/m5-6/` records own editorial copy, stable content/route identities,
Course references, locale state, source citations, readiness references and exact
formal bindings. They do not own Project-1 identities/readiness or Lean declarations.
`source/m5-6/formal-authority.json` is a reviewed exact-revision extraction from the
P4 release registry, not a replacement registry.

`generated/m5-6/` is disposable. The generator owns publication, route, outline,
search and provenance outputs. A site consumer must pin an exact qualified content
commit and must not hand-edit a generated mirror.

## Deterministic boundary

Run:

```sh
pnpm generate
pnpm validate
pnpm test
pnpm check:generated
```

Validation checks the exact 15-entity selector, 15 Course references, one repeated
canonical reference, the two adopted learner-readiness edges, 10 current
FART/FLOC/FLINK bindings, exact repository/dependency revisions and the generated
mathlib dependency fingerprint
`f8c79c8d196952e4827c72d394039862935689b2e100f821697c41bad8cb1438`.

The generator rejects duplicate identities/routes, dangling or cyclic Course edges,
unstable sibling order, non-current locators, formal/curriculum mismatches, stale
dependency revisions, external payloads and synthetic fixture leakage.

## Projection and locale truth

Course and Lean/mathlib are usable in the production outline output. OntoMathPRO and
arXiv are unavailable. MSC2020 is license-needs-review. Their production placement
arrays are empty. The validation fixture under `/validation/m5-6/` uses reserved
synthetic identifiers solely to test mechanics and is excluded from every production
output.

English is the only generated route locale. Every entity has an explicit unavailable
Portuguese record; no Portuguese route or hreflang is generated. The site must provide
locale-aware recovery instead of a fabricated translation.

## Source and representation boundary

Editorial prose is original. OpenStax links support the instructional role but no
OpenStax text or exercise is copied. Learner pages expose rendered, LaTeX and Lean
states with exact FART/FLOC/FLINK and revision provenance. Scoped and example
relations must not be relabeled as verified prose or whole-candidate coverage.

## Non-claims and revalidation

This repository state does not prove browser behavior, accessibility conformance,
deployment, external mapping coverage, Portuguese translation completeness or a full
Course. Revalidate after any selector, source, route, Course reference, Project-1
readiness, registry blob, Lean/mathlib revision, external-snapshot, locale schema or
generator change. A change to a frozen identity/binding returns to MAT-346.
