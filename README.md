# Globevoy

Promotion preparation: see [docs/releases/MAIN_CONSOLIDATION.md](docs/releases/MAIN_CONSOLIDATION.md). After the approved promotion, use `main` for new work; this does not deploy the website.
GlobeVoy contains the classic travel website, a React successor, and backend services.

**Start with [docs/START_HERE.md](docs/START_HERE.md)** for the folder map, commands, and development workflow. See [docs/BRANCHES.md](docs/BRANCHES.md) before resuming an older branch.

`main` is the current base for new work, including the merged classic/React production release fixes. Keep `staging` infrastructure separate. Source changes and production publication are separate decisions. See the [frontend directory guide](frontend/README.md) for public pages, retained legacy screens and archived designs.

## Recorded release baseline (August 2026)

- Frontend: GV-REC-687B-R1 horizontal journey carousel / route-diversity UI.
- Backend: GV-REC-687B-P3 production-origin auto-enable Lambda package.
- P3 backend validator: 12/12 PASS.
- 687B frontend validator on exact release bytes: 36/36 PASS.

`backend/` mirrors the current Lambda package source tree. `frontend/` mirrors the current Amplify frontend package source tree.

The repository does not contain Lambda environment values or server-side provider credentials. The concrete Google Maps browser key in `frontend/runtime/config.js` is replaced with a placeholder for source control and should be configured securely during deployment.

`main` is the canonical source branch. Source-control changes do not by themselves deploy AWS unless an external deployment integration is configured to react to `main`.
