# Formal Mathematics Curriculum content

This repository is the governed source for Project 5 editorial, pedagogy, locale,
source, route-key, and classification-alignment records after a qualified change is
merged. It does not own Project 1 curriculum identities or Lean declarations.

`P5-M5.6-CONTENT-v1` adds one bounded, governed candidate corpus. It contains 15
stable entities, 15 authored Course references, 10 exact formal bindings, original
English editorial copy, unavailable Portuguese locale records, deterministic search
and outline inputs, and explicit missing external-snapshot states. It is a candidate
input, not a deployed release or a full-course claim.

The only all-five-projection placement data remains an explicitly synthetic contract
fixture under `fixtures/m5-6/validation/`. The generator structurally excludes its
reserved IDs from production manifests, search, sitemap and coverage outputs.

## Validate

```sh
node --version
pnpm generate
pnpm validate
pnpm test
```

The pinned runtime is Node 24.19.0 and the package manager is pnpm 11.23.0.

`source/m5-6/` owns reviewed editorial and authority inputs. `generated/m5-6/`
contains disposable deterministic outputs. `pnpm check:generated` fails if checked-in
outputs differ from the source and exact generator. See
`docs/m5-6-governed-pipeline.md` for ownership, reproduction and non-claims.
