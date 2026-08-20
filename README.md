# Globevoy

This private repository now tracks the current validated Globevoy source baseline.

## Current baseline

- Frontend: GV-REC-687B-R1 horizontal journey carousel / route-diversity UI.
- Backend: GV-REC-687B-P3 production-origin auto-enable Lambda package.
- P3 backend validator: 12/12 PASS.
- 687B frontend validator on exact release bytes: 36/36 PASS.

`backend/` mirrors the current Lambda package source tree. `frontend/` mirrors the current Amplify frontend package source tree.

The repository does not contain Lambda environment values or server-side provider credentials. By default, the GitHub sync also replaces the concrete Google Maps browser key in `frontend/runtime/config.js` with a placeholder. Configure that restricted browser key during deployment rather than storing it in Git.

Production deployment is a separate action. Pushing this branch does not deploy AWS and does not modify `main`.
