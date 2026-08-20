# Globevoy

This private repository tracks the current validated Globevoy source baseline.

## Current baseline

- Frontend: GV-REC-687B-R1 horizontal journey carousel / route-diversity UI.
- Backend: GV-REC-687B-P3 production-origin auto-enable Lambda package.
- P3 backend validator: 12/12 PASS.
- 687B frontend validator on exact release bytes: 36/36 PASS.

`backend/` mirrors the current Lambda package source tree. `frontend/` mirrors the current Amplify frontend package source tree.

The repository does not contain Lambda environment values or server-side provider credentials. The concrete Google Maps browser key in `frontend/runtime/config.js` is replaced with a placeholder for source control and should be configured securely during deployment.

`main` is the canonical source branch. Source-control changes do not by themselves deploy AWS unless an external deployment integration is configured to react to `main`.
