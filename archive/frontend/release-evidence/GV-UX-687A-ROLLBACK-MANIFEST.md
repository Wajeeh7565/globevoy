# GV-UX-687A — Rollback Manifest

No deployment was performed.

## Authoritative rollback baseline

`frontend-staging-gv-shell-686d-r1-minimal-header-portable.zip`

SHA-256:

`c9f1dba944ee5ece6ba229176c8a5a78bbaabb7c21cc16902df88ebfb9ecb2e5`

GV-UX-687A is frontend-only. No backend, Lambda, CORS, provider, payment, authentication, map-provider, pricing-source or business-logic change is included.

If GV-UX-687A is later deployed and requires rollback, restore the exact 686D-R1 frontend artifact above through the same Amplify manual deployment path.
