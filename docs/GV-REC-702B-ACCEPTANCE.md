# GV-REC-702B Acceptance Criteria

702B is acceptable only if CI proves all of the following without weakening prior validators:

1. The candidate universe remains exactly the 431 GV-REC-702A `mapped-reviewed-inactive` cities.
2. The July GV-CITY-668S Recovery150 history is recognized by city ID, not guessed from names.
3. Exactly 132 of today's 431 candidates are surviving Recovery150 members and 299 were not selected in that recovery wave.
4. The 30-day review horizon from GV-CITY-668T is preserved.
5. At the fixed validation time on August 20, 2026, July 22 Recovery150 survivors are not prematurely queued as due.
6. `due-now-first-recovery` excludes all Recovery150 survivors.
7. Every record preserves `requiresExactItineraryVerification: true` and `activationAllowedByThisPlan: false`.
8. The staging endpoint is GET-only, exact-origin guarded, and feature-off fail-closed.
9. GV-REC-702A, GV-DATA-701, GV-REC-687B, and GV-PLATFORM-700A regressions remain green.
10. CI and packaging remain deployment-free; `backend/lambda.js`, production `main`, and the production Lambda are untouched.
