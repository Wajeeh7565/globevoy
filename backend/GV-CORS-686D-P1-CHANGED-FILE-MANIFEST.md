# GV-CORS-686D-P1 — Changed-file manifest

Authoritative production-code baseline:

- artifact: `lambda-gv-flight-685c-r3-r1-code-only.zip`
- SHA-256: `FC14E98AE35D2EFB581A1D32EB40C333B5C948E3C57B83F5B37D3CC50EDA4E9D`
- production `CodeSha256`: `/BTpiuNdLvtYGh0y60DDM7XJSOPFe4P1s308xQ7aTp0=`
- production `RevisionId`: `f340146e-e85e-49c0-ae21-08900d8aa788`

## Runtime delta

Exactly one existing runtime file changed:

| File | Baseline SHA-256 | P1 SHA-256 | Purpose |
|---|---|---|---|
| `lambda.js` | `d459b2ace57cf9a8063fe764a5351520cf29c01f24124c8bdea30d99c2f24f9f` | `bf1a0902d071616194abecd2aa404bed8a27afe9d1fd607c99f1f37ef8acbfa4` | Event-aware two-origin CORS allowlist |

No existing file other than `lambda.js` changed. No file was removed.

## Validation/support additions

- `validate-gv-cors-686d-p1.js`
- `GV-CORS-686D-P1-EXACT-DIFF.patch`
- `GV-CORS-686D-P1-VALIDATION-REPORT.md`
- `GV-CORS-686D-P1-ROLLBACK.md`
- `GV-CORS-686D-P1-CHANGED-FILE-MANIFEST.md`
- `GV-CORS-686D-P1-INTERNAL-SHA256.txt`

These additions are validation or release documentation. They are not imported by `lambda.js` and add no runtime route or provider capability.

## Configuration delta

- Lambda environment variables: **none**
- Function URL managed CORS: **not enabled and not changed**
- handler/runtime/provider settings: **none**
- network/provider/order/payment/booking capability: **none**

The exact runtime patch is preserved in `GV-CORS-686D-P1-EXACT-DIFF.patch`.
