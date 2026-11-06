# Frontend + Backend cleanup — Phase 1 (safe-first)

**Target:** `staging` via a reviewable feature-branch PR.  
**Goal:** Reduce clutter while preserving GlobeVoy's working homepage, recommendations, booking, accounts, API behavior and deployment.

## Audit summary

The audited GitHub `staging` source tree contains:

| Area | Files | Approx. size | Findings |
| --- | ---: | ---: | --- |
| `frontend/` | 375 | 15.12 MiB | 67 HTML pages, 125 JS, 35 CSS, many old root-level reports and versioned assets |
| `backend/` | 513 | 96.84 MiB | 287 files already in `archive/`, 101 `data/` files (many multi-MiB exports), active services and validators |

These are **tracked-source sizes**, not the size sent to each user's browser. Only a runtime/deployment dependency audit can determine whether a file can be dropped from hosting or Lambda packages.

### Critical boundaries

- The original `frontend/index.html`, shared `frontend/styles/shell.css`, and `frontend/scripts/shell-670f.js` must retain their approved branding.
- The React `web/` project coexists with the original frontend and is served under `/react/`; don't delete old account/booking bridge code just because React has new pages.
- `backend/lambda.js`, `backend/staging-lambda*.js`, `backend/generated-tour.js`, `backend/recommendations.js`, `backend/services/` and root validation scripts are protected pending dependency mapping.
- Keep `backend/data/` unchanged. `global-destination-catalogue.json` is loaded by `backend/data/global-catalogue.js` behind a feature flag; other exports may also be loaded dynamically.
- Keep `backend/archive/` unchanged except for non-invasive documentation. The archive is already organized by purpose.
- No change to `amplify.yml`, AWS infrastructure, authentication, saved trips, or production handlers.

## Actual first-pass cleanup

1. Add `backend/README.md` to document the protected entry points and testing commands.
2. Add `backend/archive/README.md` to explain where old backend evidence belongs.
3. Add `scripts/audit-frontend-backend.mjs`: a read-only inventory of file counts, large backend datasets and candidate historical frontend reports. This **does not remove files or certify them unused**.
4. Move just three historical deployment Markdown reports out of the web-serving `frontend/` root into `docs/archive/frontend/`, preserving their exact bytes in Git. These are old deployment notes, not application resources.

The separate feature-inventory/older frontend report cleanup in PR #115 may be merged independently. This phase avoids editing any path that PR #115 changes.

## Future work, after this PR passes tests

| Priority | Candidate | Required evidence before deletion |
| --- | --- | --- |
| 1 | More `frontend/*.md`, `*.txt`, `*.sha256` release history | Search repo references and manuals; check public deep links; move in small batches |
| 2 | Legacy numbered JS/CSS versions | Enumerate current HTML, dynamic script loaders, integration tests, archived release expectations and staging requests |
| 3 | `frontend/pages/` variants and browser fixtures | Determine published routes vs screenshot/test fixtures; retain QA contracts |
| 4 | `backend/data/` snapshots | Enumerate `require`, `fs.readFile`, dynamic path builders, CI, Lambda packaging and data validation; identify canonical vs historical |
| 5 | Backend release scripts and validators | Identify active invocation paths, CI workflows, operational rollback needs |
| 6 | Deploy artifact composition | Test excluding docs/reports from Amplify hosting instead of deleting them from Git, only after validating deployment |

## Validation and rollback

- CI must pass the default repository checks and React tests.
- For documentation moves, confirm exact Git blobs match old paths and `staging` still builds.
- Smoke-test homepage, Explore, multi-city visualizer, booking, account and saved trips after deployment if this phase is merged.
- All changes can be reversed through Git. Do **not** merge until review.

## Using the inventory tool

From the repository root:

```powershell
node scripts/audit-frontend-backend.mjs
node scripts/audit-frontend-backend.mjs --json
```

An item with zero literal references in this report is **not** automatically safe to delete: dynamic paths, external links, old releases, scripts omitted from the scan, and runtime configuration may still depend on it.
