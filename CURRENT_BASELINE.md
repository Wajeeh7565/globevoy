# Current Globevoy source-sync baseline — 2026-08-19

This branch is a sanitized source sync of the latest validated Globevoy work available on 2026-08-19. It is not a deployment artifact and does not prove that every file here is currently deployed to production.

## Source basis

- Frontend source basis: `GV-REC-687B-R1` horizontal journey carousel package.
- Backend source basis: `GV-REC-687B-P3` production-origin auto-enable code-only package.
- The P3 backend validator reported 12/12 for P3, 22/22 for the 687B diversity engine, and 18/18 for the inherited CORS gate.

## Synced areas

- Current 687B backend route-diversity gate and Lambda routing surface.
- Current route-curator dependency used by 687B.
- Current evidence-aware budget-confidence helper used by the current frontend trust flow.
- Latest 687B P3 validation script used for the source-sync gate.

## Intentionally excluded

- Real API keys, tokens, secrets, passwords, and private credentials.
- Deployment ZIPs, rollback ZIPs, caches, logs, screenshots, and generated browser artifacts.
- Large provider feeds and large generated registry/audit datasets that were already excluded from the original source-review repository.
- Production-only browser configuration values. `frontend/runtime/config.js` is sanitized for local/source review.

## Safety

- GitHub `main` was not changed by this sync.
- The sync branch is `sync/current-2026-08-19`.
- Production deployment remains a separate action and must be reviewed independently.
