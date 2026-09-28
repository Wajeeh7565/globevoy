# GV-CORS-686D-P1 — Rollback instructions

Status: **not deployed**. Production is unchanged, so no rollback action is currently required.

If P1 is later deployed and must be reverted:

1. Restore the authenticated code-only artifact `lambda-gv-flight-685c-r3-r1-code-only.zip`.
2. Verify its local SHA-256 is exactly `FC14E98AE35D2EFB581A1D32EB40C333B5C948E3C57B83F5B37D3CC50EDA4E9D` before upload.
3. Use the expected production function `globevoy-recommendations` in `us-east-2` and protect the update with the then-current revision identifier.
4. Do not change runtime `nodejs24.x`, handler `src/lambda.handler`, environment variables, activation flags, quotas, or provider configuration as part of rollback.
5. Keep AWS Function URL managed CORS disabled; application CORS remains authoritative.
6. After any authorized rollback, verify the deployed code hash and run approved production smoke checks separately.

Historical pre-P1 production evidence supplied for this task:

- `CodeSha256`: `/BTpiuNdLvtYGh0y60DDM7XJSOPFe4P1s308xQ7aTp0=`
- `RevisionId`: `f340146e-e85e-49c0-ae21-08900d8aa788`

Do not assume the historical revision identifier is still current at a future rollback time.
