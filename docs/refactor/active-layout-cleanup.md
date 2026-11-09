# Completed active layout cleanup

Updated November 9, 2026. Continues PR #120 on `codex/remaining-repository-cleanup`.

## Final layout

The first pass archived 39 historical files. This follow-up relocates another
88 files and updates their consumers, rather than leaving active clutter at the
backend and frontend roots.

| Files | Destination |
| --- | --- |
| 40 backend validators | `backend/validation/` |
| 12 backend application modules | Existing service domains: tours, recommendations, routing, pricing and cities |
| 7 frontend validators | `frontend/validation/` |
| 7 recorded frontend validation results | `frontend/validation/results/` |
| 11 frontend release metadata/checksum files | `frontend/validation/releases/` |
| 6 browser fixtures | `frontend/validation/fixtures/` |
| 5 PowerShell tools | `ops/frontend/validation/` and `ops/frontend/smoke/` |

The backend root now contains only `lambda.js`, `server.js`, `staging-lambda.js`
and `staging-lambda-702d.js`. The frontend root contains public HTML pages and the
favicon. Public page URLs and Lambda handler names are unchanged.

The full [move map](active-layout-moves.json) records every source and destination.
Imports, source-reading validators, performance-test mocks, workflow filters,
artifact checks, operator paths and fixture redirects were migrated together.
New validator output goes to ignored `.cache/validation/frontend/`; recorded
results and release checksum values remain historical evidence.

## Verification

- `npm test` passes, including the current frontend gate and new fixture-path test.
- Account, provider and React/Web test groups pass.
- React TypeScript checking and static production build pass.
- All 377 statically declared relative CommonJS imports resolve.
- Runtime equivalence check covers 236 files and allows only relocated module
  imports; source behavior, application pages and runtime data are preserved.
- All 40 backend and 17 frontend validators were compared with a clean export of
  the pre-move commit. Previously passing validators remain passing. Older
  standalone release checks retain their existing failures.
- PowerShell syntax and every referenced historical checksum path resolve.
- All five redirecting browser fixtures reach their public page; the local
  partner fixture path resolves. No live provider calls or deployment were used.

Four standalone backend validators fail both before and after: account 705B,
flight 684A, recommendation 684B, and recommendation 702F-E. They are outside the
default passing groups and retain historical expectations. Several standalone
frontend release checks also report known historical/sanitized-byte differences;
the current 687B gate accepts its established sanitized baseline and passes.

**Correction to the first report:** its five frontend gate failures were caused
by Windows CRLF checkout bytes, not five newly discovered code regressions.
A clean Git export passes that gate, as does the LF working checkout. No expected
hashes or assertions were weakened to make it pass.

## CI and maintenance

Workflow commands and packaging assertions now name the new paths. Older
task-specific scope gates use a one-time migration path only when the PR base
does not yet contain this move manifest. That path must pass runtime equivalence
against the actual PR base plus organization checks. Ordinary task scope gates
resume after integration; regression/build steps always run.

`npm run test:structure` prevents validators/reports returning to the public roots,
checks all 88 destinations, and preserves the original 39 archive hashes.
Build output is ignored. Historical checksum manifests are not regenerated to
match refactored files: operator tools resolve moved paths and still reject byte
differences from a historical release.

No branch was deleted, no production deployment was performed, and runtime data
was not migrated to external storage. Those are separate changes from organizing
the directory tree. This branch is ready for review against staging, not an
automatic production promotion.
