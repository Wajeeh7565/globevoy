# Current baseline - 2026-08-20

Canonical branch: `main`

Backend source: `lambda-gv-rec-687b-p3-production-origin-autoenable-code-only.zip`
SHA-256: `e717bfba9db30b064a7c96539008c66a2b9cd79623e9f4d6317b5ae35ce285f4`

Backend predecessor/rollback verified when available:
`ROLLBACK-globevoy-recommendations-before-687b-p3-20260819-224137.zip`
SHA-256: `9555db5ed4e0c1cd551991fd67fd2d433dc068317faba7c2bef78b174f7866d8`

Frontend target: `GV-WEB-2` (new homepage and results page, November 2026; replaces `GV-REC-687B-R1`).
Full release ZIP SHA-256 when available locally:
`52097ac1d5a1aea2e69d83369a19b1a6ad675133860b41dafe32ce6c93ed9b3e`

If the full 687B ZIP was unavailable during the original sync, 687B was reconstructed from the verified 687A-R2 package plus the reviewed 687B delta included with the sync kit.

Validation gates before promotion to `main`:
- GV-REC-687B-P3 exact release: 12/12 PASS
- GV-WEB-2 frontend: tests/frontend/trip-search.test.cjs PASS (replaces the GV-REC-687B frontend validator)
- GitHub-only runtime/config.js sanitization: syntax + key-removal PASS
- strict post-sanitization secret-pattern guard: PASS

GitHub source note: the concrete restricted Google Maps browser key is sanitized in source control and should be configured securely during deployment.
