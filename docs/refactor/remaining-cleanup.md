# Remaining directory cleanup — November 6, 2026

## Scope and result

Based on staging commit `447fba5` (PR #119), preserving the service migration and
earlier archive work already integrated there. The root README previously described
only the August main baseline, which made the newer work difficult to find.

- Moved 39 files from the classic frontend root into the existing frontend archive:
  17 historical validators, 19 validation/audit JSON files, and 3 release documents.
- Preserved every moved file's exact committed bytes. Archive attributes disable
  newline conversion so historical evidence remains identical across platforms.
- Added a manifest with original paths, archive paths and SHA-256 hashes.
- Added `test:structure` to the repository test group already run by CI. It checks
  archive integrity and rejects active references to the moved filenames.
- Added a starting guide, documentation index, branch inventory and AGENTS.md
  organization rules for future changes.

The reference audit covered executable source, configuration, workflows, operator
scripts and checksum manifests. Historical prose and archived scripts retain their
original paths as historical context. Archived validators are reference material,
not relocated executable tests; see [archive usage](../../archive/frontend/README.md).

## Verification

Environment: Windows, Node.js v24.15.0. Checked before and after the moves.

| Check | Result |
| --- | --- |
| Organization guard | 39/39 exact hashes; no active references to moved files |
| Repo, backend, account, providers, performance, syntax groups | PASS: 43 commands across 6 groups |
| Classic worldwide API contract | PASS: 14/14 |
| Classic unified account header | PASS: 8/8 |
| `npm test` | Existing frontend failure reproduced unchanged; 687B validator reports 32/37 |

The five failing nested historical regressions produce the same results on untouched
staging and after cleanup:

| Nested validator | Before | After |
| --- | --- | --- |
| 687A | 28/35 | 28/35 |
| 686D master | 47/51 | 47/51 |
| 686D-R1 shell | 22/28 | 22/28 |
| 686C booking | 24/27 | 24/27 |
| 686B journey | 20/24 | 20/24 |

These validators compare older release expectations, including exact source hashes.
Their observed failures need a separate baseline reconciliation; this cleanup does
not change assertions or bless current bytes as a new release. The default runner
stops at the frontend failure, so performance and syntax were also run explicitly
with the other passing groups. React build, live AWS/provider checks and browser
deployment testing were not run for this archive/documentation-only change.

## Files intentionally retained in active locations

- The remaining seven root frontend validators are invoked by existing booking and
  trust PowerShell wrappers. Their output paths are retained with them.
- Frontend release JSON, checksum manifests and browser fixtures are consumed by
  release validators. Moving them requires migrating those contracts together.
- Backend entry points, root validators and data remain referenced by runtime,
  packaging or validation contracts. The services are already organized.
- Existing feature-document paths are referenced by workflows and validators;
  the new index makes them navigable without breaking those links.

No runtime behavior, account persistence, imports, production configuration or
deployment definition was changed. No branch or local release directory was deleted.
The branch inventory distinguishes integrated cleanup branches from divergent work
so subsequent cleanup can happen without losing unfinished features.
