# Globevoy Technical Review Guide

Please review this private source snapshot as an application and data-pipeline handoff, not as a deployment package.

## Requested Review Areas

1. Code organization, naming, readability, and module boundaries.
2. Security, browser configuration, environment-variable handling, CORS, and secret-management risks.
3. AWS Lambda handler structure, error envelopes, timeouts, and operational observability.
4. Strict origin validation and protection against silent fallback to Toronto.
5. Recommendation math, fallback estimates, Budget Fit scoring, sorting, limits, and same-origin exclusion.
6. Travelpayouts/Aviasales and Agoda partner-link generation and tracking separation.
7. Frontend/backend destination identity alignment and generic fallback-card guardrails.
8. City registry/provider mapping design and the path from 115 toward 250+ cities.
9. Performance, memory use, response size, and maintainability at 250, 1,000, and more cities.
10. API and frontend error handling, loading-state recovery, accessibility, and mobile behavior.
11. Test coverage, missing integration tests, brittle fixtures, and useful automation additions.
12. Deployment, rollback, release packaging, and configuration management.

## Questions to Answer

- What are the highest-priority correctness, security, or reliability bugs?
- Which responsibilities should be split into smaller modules first?
- Where is data duplicated or at risk of frontend/backend drift?
- Which provider assumptions need explicit contracts or validation?
- What should be automated before the dataset grows further?
- Which tests would provide the most confidence per unit of effort?
- What is the safest incremental architecture for 250+ destinations?

## Package Boundaries

- Real keys, tokens, partner account identifiers, and the live Lambda URL were replaced with placeholders in this copy.
- Raw provider feeds and static provider datasets are excluded.
- Draft/candidate/generated registry artifacts are excluded from runtime source.
- The compact backend fixture exists only to keep the 115-destination metadata tests self-contained.
- Do not deploy this review snapshot without a separate configuration, security, and release review.

Please return findings ordered by severity, with file/line references, expected impact, and a suggested remediation. Separate confirmed bugs from architectural recommendations.

