# Start here

Promotion preparation: see [releases/MAIN_CONSOLIDATION.md](releases/MAIN_CONSOLIDATION.md). After the approved promotion, use `main` for new work; this does not deploy the website.
## Pick the right baseline

As inspected on November 6, 2026, **staging is the development integration branch**.
It includes the service reorganization, account work, React work, and cleanup
through PR #119. `main` still records the August 20 release baseline. It is 689
commits behind staging by ancestry; this is not evidence that every staging feature
has been deployed. See [branch inventory](BRANCHES.md) before choosing older work.

For the next task, update staging and create one focused branch from it:

```sh
git fetch origin
git switch -c codex/short-task-name origin/staging
npm test
```

Use a clean checkout or commit your own work before changing branches. Open changes
against staging. Promotion to main and production is a separate release decision.

## Where things belong

| Location | Purpose |
| --- | --- |
| `backend/lambda.js` | Existing Lambda entry point |
| `backend/staging-lambda*.js` | Staging entry points and ordered overlays |
| `backend/server.js` | HTTP server entry point |
| `backend/services/` | Organized accounts, booking, cities, domain, providers, and shared services |
| `backend/services/domain/tours/` | Generated tours, date controls and fallback logic |
| `backend/services/domain/recommendations/` | Recommendations, quality and mixed results |
| `backend/validation/` | All 40 backend validators, invoked by the grouped runner and CI |
| `backend/data/` | Versioned runtime inputs, fixtures, and review data; inspect consumers before moving |
| `frontend/` | Public HTML pages and favicon only at the root; website URLs remain stable |
| `frontend/runtime/`, `scripts/`, `styles/` | Classic configuration/API client, behavior, and CSS |
| `frontend/validation/` | Validators, browser fixtures, release metadata and historical recorded results |
| `ops/frontend/validation/`, `ops/frontend/smoke/` | PowerShell validation and deployment smoke tools |
| `.cache/validation/frontend/` | Fresh local validation output; ignored by Git |
| `web/` | Next.js/React application exported under `/react` |
| `tests/` | Shared test collections, currently performance and legacy frontend tests |
| `scripts/` | Repository-wide developer commands |
| `ops/` | Operator and provider evaluation tools; inspect before running |
| `docs/` | Feature and architecture documentation; use [the index](README.md) |
| `archive/`, `backend/archive/` | Historical evidence and scripts, not current runtime code |
| `.github/workflows/` | Validation automation |
| `amplify.yml` | Composite frontend build definition |

## Check your change

Node.js 22 or newer is required; the unified CI uses Node.js 24.

```sh
npm run test:repo
npm run test:backend
npm run test:frontend
npm run test:account
npm run test:providers
npm run test:performance
npm run test:syntax
```

`npm test` includes repo, backend, frontend, performance and syntax groups. It
stops at the first failed group; it does not include account, providers or web.
For React checks, install the existing pinned dependencies first:

```sh
npm install --prefix web --no-audit --no-fund --no-package-lock
npm run test:web
npm run typecheck:web
npm run build:web
```

Current cleanup verification and existing failures are recorded in
[the active-layout cleanup report](refactor/active-layout-cleanup.md). Old release hashes or recorded
PASS counts are not proof that the current checkout passes today.

## Continue in small steps

1. Use the grouped test commands for current work. Investigate older standalone release validators separately; several assert historical behavior that has since changed.
2. Review the feature inventory and frontend audit branches listed in BRANCHES.md;
   bring over only the changes still wanted after comparing with current staging.
3. Resume one product feature at a time, with its relevant grouped tests.

The meeting notes assigned infrastructure/Docker/CDK work to Vamsi and code/data
cleanup to Wajeeh. They also discussed S3, but that discussion is not a completed
storage migration: current account services and runtime data already have their
own contracts. Review them before changing persistence. Login/history features,
external data migration, and deployment should each have their own task.
