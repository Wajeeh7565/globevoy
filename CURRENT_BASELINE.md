# Current baseline â€” 2026-08-19

Branch: `sync/current-2026-08-19`

Backend source: `lambda-gv-rec-687b-p3-production-origin-autoenable-code-only.zip`
SHA-256: `e717bfba9db30b064a7c96539008c66a2b9cd79623e9f4d6317b5ae35ce285f4`

Backend predecessor/rollback verified when available:
`ROLLBACK-globevoy-recommendations-before-687b-p3-20260819-224137.zip`
SHA-256: `9555db5ed4e0c1cd551991fd67fd2d433dc068317faba7c2bef78b174f7866d8`

Frontend target: `GV-REC-687B-R1`.
Full release ZIP SHA-256 when available locally:
`52097ac1d5a1aea2e69d83369a19b1a6ad675133860b41dafe32ce6c93ed9b3e`

If the full 687B ZIP was unavailable, the sync reconstructed 687B from the verified 687A-R2 package plus the reviewed 687B delta included with the sync kit.

Validation gates before Git commit:
- GV-REC-687B-P3 exact release: 12/12 PASS
- GV-REC-687B frontend exact release: 36/36 PASS
- GitHub-only runtime/config.js sanitization: syntax + key-removal PASS
- strict post-sanitization secret-pattern guard: PASS

GitHub source note: the concrete restricted Google Maps browser key is sanitized unless `-KeepBrowserMapsKey` is explicitly supplied.
