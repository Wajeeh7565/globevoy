# Working on GlobeVoy

- Read README.md and docs/START_HERE.md before changing code. During promotion, follow docs/releases/MAIN_CONSOLIDATION.md. After its approved merge, start new work from main; until then staging is the integrated source.
- Keep one task per branch and describe its purpose, changed files, and checks. Do not merge unrelated feature branches to tidy the repository.
- Put backend services in the existing responsibility-based folders under backend/services. Preserve staging overlay installation order.
- Keep classic frontend URLs and Lambda entry points stable. A file move must update its imports, consumers, tests, packaging, and workflow references together.
- Keep new automated tests under tests/, backend/validation, frontend/validation or web/validation. Register current checks in scripts/run-tests.mjs. Avoid adding new validators at the backend or frontend root.
- Put documentation under docs/, operator tools under ops/, and generated local output under .cache/. Historical reports belong in archive/ or the existing backend/archive tree. Do not edit archived evidence to make tests pass.
- Do not remove backend/data files simply because they are data. Several are runtime fixtures and inputs; inspect consumers before proposing an external-storage migration.
- Run npm run test:repo and the relevant grouped tests. Run npm test for cross-cutting changes. Report existing failures separately from regressions; do not weaken assertions or replace expected hashes just to get a pass.
- Branch deletion, production deployment, and infrastructure changes are separate from directory cleanup. Preserve unmerged work.
