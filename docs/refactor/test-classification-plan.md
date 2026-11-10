# GV-REFACTOR-R1.2 — Test and validation classification plan

Status: **Phase A, Phase B, the safe portion of Phase C, and the R1 backend cleanup are completed**.

Current state:

- Root `npm test` and grouped test commands are implemented.
- The unified `Globevoy Validation` GitHub Actions workflow is active and proven on the service-refactor branch.
- Runtime service organization is complete at 69/69 files.
- Phase C has started: the four PERF-R2/R3/R4/R5 Node tests are now organized under `tests/performance/`.
- Release/package validators that are referenced by historical workflows or expected inside build artifacts remain in their existing locations.
- Further physical validator relocation is deferred unless workflow/package contracts are migrated separately with explicit evidence.

## Current inventory

The branch inventory found 162 executable validation/test files under `backend/`, `frontend/`, `web/`, and `ops/`. Including the repository-level validator `.github/scripts/validate-repo.mjs`, there are 163 executable validation-related scripts.

There are also 97 `VALIDATION_*.json` files. These are evidence/output artifacts, not executable tests.

## Practical classification

| Group | Approx. executable scripts | Purpose |
|---|---:|---|
| Backend core/regression | 73 | Broad recommendation, pricing, routing, trust, booking, and regression contracts |
| Backend account/auth | 7 | Cognito, saved trips, account/travel-profile boundaries |
| Backend city/coverage | 25 | City registry, gateway, activation, recovery, and global coverage checks |
| Backend flights | 6 | Duffel, fare, provider, and flight-specific checks |
| Backend stays | 7 | Nuitee, Stay22, Agoda, hotel/current-price checks |
| Backend performance | 4 | PERF-R2/R3/R4/R5 Node tests |
| Legacy frontend | 34 | Classic frontend regressions and browser/static contracts |
| React web | 5 | React/Next static and journey/live validations |
| Ops/provider | 1 | Operational provider validation |
| Repository/CI | 1 | Repository structure/policy validation |

The only conventionally named `.test.*` files today are:

- `tests/performance/validate-gv-perf-r2.test.js`
- `tests/performance/validate-gv-perf-r3.test.js`
- `tests/performance/validate-gv-perf-r4.test.js`
- `tests/performance/validate-gv-perf-r5.test.js`
- `web/validation/validate-gv-live-712c.test.mjs`

## Proposed future test layout

```text
tests/
├── unit/
├── integration/
├── regression/
│   ├── backend/
│   ├── frontend/
│   └── web/
├── providers/
│   ├── flights/
│   └── stays/
├── account/
├── performance/
└── fixtures/
```

Do not move the 97 historical `VALIDATION_*.json` files into `tests/`. They should be handled separately as validation evidence/artifacts.

## Migration strategy

### Phase A — add one test entry point first

Create a root `package.json` with a small test runner that invokes the current validators **in place**. This gives the repository an `npm test` command before physical file movement.

The first runner should be conservative:

1. repository validation;
2. backend critical regression checks;
3. account/auth checks;
4. flight/provider checks;
5. stay/current-price checks;
6. frontend classic checks;
7. React/Next checks;
8. performance tests.

Do not run validators that require live credentials, destructive provider calls, production access, or environment-specific deployment state as part of the default local suite.

### Phase B — make CI call the same entry point

After the root runner is proven locally, add one GitHub Actions workflow that runs the same command on pull requests.

Existing historical workflows should remain in place initially. The new workflow should be additive until equivalent coverage is proven.

### Phase C — move validators gradually

Once the unified runner is stable, move **standalone test files** into `tests/` by cohort and update paths.

The PERF-R2/R3/R4/R5 Node tests have now been moved to `tests/performance/`.

Do not automatically relocate release validators that are referenced by historical workflows, packaging checks, deployment artifacts, or operator procedures. Those validators are part of release/build contracts and require a separate migration decision.

### Phase D — retire redundant workflows only with evidence

After the unified suite reproduces the required checks, identify duplicated historical workflows and retire them in a separate cleanup PR. The known `validate-707a.yml` issue should be investigated explicitly rather than hidden by the new runner.

## Suggested default commands

Target developer experience:

```bash
npm test
npm run test:backend
npm run test:frontend
npm run test:web
npm run test:providers
npm run test:account
npm run test:performance
npm run typecheck:web
npm run build:web
```

The exact command membership should be generated from the current workflow/validator inventory rather than guessed.

## Safety rules

- Do not delete any validator merely because it is old or release-numbered.
- Do not treat `VALIDATION_*.json` evidence as executable tests.
- Do not make default tests depend on production credentials or live production provider calls.
- Keep test-suite consolidation separate from Lambda/Fargate/CDK migration.
- Preserve fail-closed provider and account/security behavior.
- Keep `main` and production untouched until the consolidated suite is proven on the feature branch and staging.

## Questions for Vamsi

1. Should the first `npm test` run the entire historical regression suite, or should it be a fast PR gate plus a larger scheduled/full suite?
2. Should provider tests be mocked by default, with live sandbox provider checks in a separate workflow?
3. Should historical `VALIDATION_*.json` evidence move to S3/artifact storage after the CI refactor?
4. Which checks should block every PR versus run nightly/on demand?
5. Should we use Node's built-in test runner first, or adopt a framework such as Vitest/Jest later only if needed?


## R1 backend cleanup closeout

The backend cleanup portion of GV-REFACTOR-R1 is complete on the feature branch.

Completed cleanup:

- All 69/69 backend service files are organized under responsibility-based folders.
- No JavaScript service files remain directly under `backend/services/`.
- PERF-R2/R3/R4/R5 tests are organized under `tests/performance/`.
- Historical release reports and release evidence are separated under `backend/archive/`.
- 38 historical manifests were moved to `backend/archive/manifests/`.
- 25 non-operational validation-result JSON files were moved to `backend/archive/validation-results/`.
- 33 non-operational historical utility scripts were moved under `backend/archive/scripts/`.
- One unreferenced historical checksum artifact was removed.

Final backend-root inventory:

- 188 files total.
- 118 `validate-*.js` validators.
- 48 operational `VALIDATION_*.json` files.
- 5 operational `Run-*.ps1` scripts.
- 1 retained operational `GV-*` checksum file.
- 16 core backend JavaScript files.
- 0 `build-*.js` files.
- 0 `run-*.js` files.

Final validator audit:

- 36 validators are referenced by workflows or the unified test runner.
- 2 validators have other operational references.
- 80 validators are standalone but path-sensitive.
- 0 validators are standalone/simple relocation candidates.

Further validator relocation is intentionally deferred. Moving the remaining validators would require changing historical workflow, packaging, fixture, or relative-path contracts and should be handled as a separate migration rather than repository cleanup.

Final local verification passed:

- `npm test` — 36 commands across 5 groups.
- `git diff --check` — clean.
- No AWS, production, provider-behavior, deployment, IAM, or secrets changes were made as part of the cleanup.

Latest completed utility-script cleanup commit before closeout: `fc497a5a82906c4b887bbf8fab96c070d0863478`.

GitHub `Globevoy Validation` run #996 passed on repair commit `6829c1609843b37365f7829ccdc2be7b55d5c29e`.

## Non-goals

No AWS deployment changes, no Lambda/Fargate migration, no provider behavior changes, no production calls, no removal of existing workflows, and no relocation of release/package validators whose paths are part of historical workflow or artifact contracts.
