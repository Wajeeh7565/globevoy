# GV-PLATFORM-700A — GitHub, staging and validation workflow

Status: staging foundation only. No production deployment is performed by this task.

## Goal

Make GitHub the normal development source of truth while keeping the current Globevoy production release protected.

The intended flow is:

`feature/*` → automated validation → `staging` → browser/API QA → reviewed promotion → `main`

`main` remains the canonical production source branch. A merge to `main` is a separate approval decision.

## Branch roles

### `main`

Canonical production source. Do not develop directly on this branch. Production deployment should happen only after staging acceptance, review, and a deliberate promotion decision.

### `staging`

Integration branch for changes that have passed feature-branch CI. This branch is intended to become the source for a non-production Amplify environment.

A hosted staging frontend must not be treated as fully isolated while it still points at the production Lambda URL. Before provider-changing or state-changing backend work is tested through staging, create an isolated staging Lambda/API and point the staging runtime configuration at that endpoint.

### `feature/*`

One bounded task per branch. Examples:

- `feature/global-cities-701`
- `feature/live-flights-703`
- `feature/live-hotels-704`
- `feature/auth-705`

Only one implementation owner should edit a feature branch at a time.

## Automated validation

`.github/workflows/validate.yml` runs on feature/staging pushes and pull requests to staging or main.

It intentionally has read-only repository permission and contains no AWS deployment step.

Current gates are:

1. Repository structure and secret-safety guard.
2. Exact GV-REC-687B-P3 backend validation.
3. GV-REC-687B recommendation regression validation.
4. Exact GV-REC-687B frontend validation, including its protected regressions.
5. Syntax checks for the current Lambda, generated-tour runtime, 687B diversity service and 687B frontend visualizer.
6. A guard that rejects AWS deployment commands inside the validation automation itself.

CI success means the source passed automated checks. It does not mean the change is approved for production.

CI proof note: this branch contains a harmless documentation-only change solely to prove that the pull-request validation workflow executes after the workflow has landed on `staging`.

## Staging deployment boundary

GV-PLATFORM-700A creates the GitHub staging branch and validation foundation only.

The existing production Amplify branch and production Lambda are not changed by this task.

The next infrastructure step is to connect the GitHub `staging` branch to a non-production Amplify branch/environment. Backend staging should be isolated before live provider or backend mutation testing is moved there.

Do not restore the old `686d-preview` branch as part of this task. The new branch is simply `staging`.

## Promotion procedure

1. Start from current `staging` and create a bounded `feature/*` branch.
2. Implement the task without production changes.
3. Push and require green CI.
4. Review the diff and merge the feature PR into `staging`.
5. Test the deployed staging site on desktop and mobile when applicable.
6. Record provider/evidence behaviour and any known limitation.
7. Open a separate promotion PR from `staging` to `main`.
8. Review CI, staging evidence, protected files and rollback path.
9. Merge/promote only after explicit release approval.
10. Smoke-test production immediately after an approved deployment and roll back if a serious regression appears.

## Production safety rules

- Never store provider credentials or Lambda environment values in Git.
- Keep `frontend/runtime/config.js` sanitized in source control.
- Do not make CI capable of deploying AWS resources.
- Do not enable automatic Lambda production deployment in this phase.
- Do not weaken LIVE/CACHED/ESTIMATED/UNAVAILABLE evidence rules.
- Do not claim booked, ticketed, confirmed or live hotel pricing without genuine provider evidence.
- Preserve a rollback path for any future production-impacting release.

## Follow-up after 700A

Once the staging frontend is actually hosted and an isolated staging API strategy is decided, Globevoy can begin the 701+ product sprints from GitHub instead of using manual ZIPs as the normal development workflow.
