# M5.8 external snapshot licensing and refresh boundary

This is the content-authority half of MAT-367 and implements
`P5-M5.8-OPERATIONS-FREEZE-v1`. It qualifies evidence, not public mapping coverage,
and it does not authorize deployment.

## Decision

External taxonomies remain upstream authority. This repository stores a reviewed
manifest and, only when rights plus durable raw preservation are complete, a bounded
snapshot. The site consumes an exact merged content revision and never fetches a
taxonomy at learner runtime. A hash without recoverable raw bytes is evidence of an
observation, not a durable snapshot.

No current candidate meets every public-payload gate:

- OntoMathPRO 1.12.6 is pinned to an immutable commit, Git blob, byte count and
  SHA-256, with an exact Apache-2.0 license blob. Its source/license are qualified,
  but no raw payload is vendored or released here and no mapping is reviewed, so its
  effective snapshot state remains `unavailable`.
- The official MSC2020 publisher page confirms CC BY-NC-SA. Exact CSV acquisition
  returned HTTP 502 on 2026-08-24, and NonCommercial/ShareAlike separation from the
  repository CC0 still needs review. It remains `license_needs_review` with no hash
  invented.
- arXiv API terms identify classification terms as descriptive metadata under CC0.
  The taxonomy HTML observation is fingerprinted, but its mutable raw bytes are not
  durably preserved, so the snapshot remains `unavailable`. No runtime API is used;
  any future acquisition must respect the current one-request-per-three-seconds,
  single-connection legacy API limit and avoid implied endorsement.
- OpenStax Prealgebra 2e remains link plus original project paraphrase only. Its
  CC BY-NC-SA terms, attribution rules and explicit no-LLM-ingestion restriction are
  not converted into permission to ingest or vendor its prose, images or exercises.

## Refresh procedure

1. Record the exact issue, upstream URL/revision and intended bounded fields.
2. Acquire once under current upstream usage/rate rules.
3. Preserve raw bytes in this repository or an authorized immutable release asset.
4. Record byte count, SHA-256, media type, retrieval date and upstream identity.
5. Record license, attribution, NOTICE/modification, trademark, NC/SA and endorsement
   obligations. Unknown or contradictory rights fail closed.
6. Normalize deterministically with a pinned schema/adapter and output manifest.
7. Diff additions, removals, renames, identifier reuse and hierarchy changes.
8. Mark affected mappings stale/needs-review; a fresh snapshot never proves mapping.
9. Obtain separate licensing-steward and classification-review decisions.
10. Merge the content source before updating a site input lock.
11. Regenerate and verify routes/search/attribution/missing states in a preview.
12. Use a separate exact release approval; a snapshot merge is not deployment.

Stop on missing raw preservation, checksum mismatch, unknown format/schema, ambiguous
license/attribution, unexpected upstream diff, synthetic coverage, runtime fetching,
unreviewed mapping or any attempt to treat an external hierarchy as curriculum truth.
