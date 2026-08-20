# GV-SHELL-686D-R1 — Rollback manifest

Status: **not deployed**. No production rollback is currently required.

Authoritative rollback artifact:

- `frontend-staging-gv-rc-686d-consolidated-ux-release-candidate-portable.zip`
- SHA-256: `cac8de2a870c4edca3393e358c6559d16a59607d473da43efd7e0b57ad10b3c4`

If 686D-R1 is later deployed and must be reverted, redeploy that exact authenticated 686D frontend artifact using the normal frontend deployment gate. Do not alter backend, Lambda, provider, pricing, booking, payment, or authentication configuration during rollback.

The R1 runtime delta is limited to `scripts/shell-670f.js`, `styles/shell.css`, and fourteen shell cache-key updates listed in `GV-SHELL-686D-R1-CHANGED-FILE-LIST.md`.
