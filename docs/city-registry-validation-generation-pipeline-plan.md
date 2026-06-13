# Globevoy City Registry Validation and Generation Pipeline Plan

Status: planning artifact only. This file does not change production behavior.

Created: 2026-06-06

## A. Summary

The 100-city rollout should be generated from a reviewed registry, not manually
copied into `destination-meta.js` and `destination-data.js`. The pipeline should
have three layers:

1. Registry candidate creation.
2. Validation and readiness reporting.
3. Generated backend/frontend slices and deployment QA artifacts.

No generated file should be imported into production until validation, product
review, and manual QA pass.

## B. Current Data Issues

Current production maintenance has these issues:

- Backend and frontend destination datasets are separate.
- Backend has 50 production metadata records.
- Frontend has 30 curated display records.
- Explore can render API-backed destinations without curated frontend records,
  but this is not a complete replacement for reviewed frontend copy and image
  data.
- Existing draft registry and preview slices are useful, but still reflect a
  50-city foundation and are not production-ready for 100 cities.
- Manual expansion depends on careful one-off checks and does not scale.

## C. Validation Pipeline

Recommended script family:

| Script | Purpose | Output |
| --- | --- | --- |
| `scripts/validate-production-city-registry.js` | Validate a candidate registry before generation. | Errors, warnings, grouped readiness summary. |
| `scripts/compare-registry-to-live.js` | Compare candidate registry against current backend/frontend production. | Added/removed/changed city report. |
| `scripts/generate-production-slices.js` | Generate production-candidate backend/frontend slices from ready records only. | Non-imported candidate JS files. |
| `scripts/generate-registry-qa-report.js` | Produce release QA report and checklist. | Markdown/CSV report. |
| `scripts/package-readiness-check.js` | Scan generated packages before upload. | Package inclusion/exclusion report. |

Initial validation checks:

- JSON parses.
- Top-level metadata exists.
- Exact target count is present, such as 100 candidate records.
- `globevoyCityId` values are unique.
- Display city/country pairs are unique unless region disambiguation exists.
- Required backend fields exist.
- Required frontend fields exist.
- Coordinates are valid.
- Coordinates represent city center, not airport, unless documented.
- Aliases and normalized aliases do not collide unsafely.
- Duplicate Agoda city IDs are flagged.
- Duplicate Travelpayouts city codes are flagged.
- Airport code overlaps are flagged.
- Primary airport reuse is flagged.
- Metro-code cases are explicitly reviewed.
- Agoda coverage status is valid.
- Travelpayouts coverage status is valid.
- Currency values are supported.
- Estimate confidence and source fields exist for fallback prices.
- Hold-back cities are excluded from generated production slices.
- `productionStatus` is valid.
- `validationStatus` is valid.
- No raw Agoda feed rows are present.
- No API keys, tokens, passwords, env files, or credentials are present.
- No draft registry files are imported by production code.
- No origin-airport draft file is imported by production code.

Blocking errors:

- Duplicate `globevoyCityId`.
- Missing required city/country/code fields.
- Invalid coordinates.
- Missing fallback estimates for a backend-ready city.
- Missing primary airport for a backend-ready city.
- Missing provider mapping status for a backend-ready city.
- Hold-back city marked `ready`.
- Secret-like text in registry or generated output.
- Generated file imported into production before approval.

Warnings:

- Partial Agoda coverage.
- Provisional fallback flight or stay estimate.
- Missing curated image/copy.
- Metro-code policy needs review.
- Duplicate alias requires country/region disambiguation.
- Frontend display is API-renderable but not curated.

## D. Generation Pipeline

The generator should read the candidate registry and output review artifacts
first. Production replacement should be a separate later sprint.

Recommended generated artifacts:

- `release/generated/backend-destination-meta-100.production-candidate.js`
- `release/generated/frontend-destination-data-100.production-candidate.js`
- `release/generated/city-registry-100-readiness-report.md`
- `release/generated/city-registry-100-provider-gaps.csv`
- `release/generated/city-registry-100-deploy-checklist.md`

Backend generation rules:

- Include only records with `productionStatus` of `live` or `ready`.
- Include `city`, `country`, `code`, provider IDs, coordinates, fallback prices,
  daily spend, activities, stay estimate, and cautious display notes.
- Do not include `hold-back` or `needs-review` records.
- Preserve current partner/referral behavior.
- Do not generate origin resolver changes.
- Do not import draft registry at runtime.

Frontend generation rules:

- Include only records with frontend display readiness or safe API-renderable
  fallback fields.
- Preserve curated fields where they already exist.
- Do not overwrite curated copy, images, map placement, or tags without review.
- For missing curated fields, generate explicit TODO/readiness warnings in the
  report, not vague marketing copy.
- Do not expose hold-back records.

QA report generation rules:

- Report current live count vs generated candidate count.
- Report records added, removed, and changed.
- Report missing backend fields.
- Report missing frontend fields.
- Report provider gaps.
- Report provisional estimates.
- Report metro-code review cases.
- Report partner-link safety scan result.
- Report production import safety scan result.

## E. Proposed Workflow

1. Build `release/city-registry-100-candidate.json` from approved sources.
2. Run candidate validation.
3. Review provider and product warnings.
4. Promote only low-risk records to `productionStatus: ready`.
5. Generate backend/frontend production-candidate slices.
6. Compare generated slices against current live files.
7. Product reviews copy, images, estimates, provider mappings, and metro codes.
8. Package a small implementation patch.
9. Run backend tests, frontend static checks, package scans, and local smoke.
10. Upload manually only after the package sprint passes.

## F. Package Safety Checks

Before any package is created:

- Backend tests pass.
- Frontend inline JS parse passes.
- Registry validation has 0 blocking errors.
- High-budget Toronto count matches expected generated count.
- `Fakecity`, `Tehran`, and `Auckland` stay unsupported.
- No `Book now` wording exists.
- `Compare flights` and `Compare stays` wording remains.
- `tp.media` / Aviasales / Travelpayouts references remain.
- Agoda references remain.
- Draft/candidate/generated files are not imported into production runtime.
- ZIP package excludes docs, scripts, candidate files, raw feeds, old ZIPs, and
  credentials.

## G. Risks

- Accidental full 100-city import without review.
- Provider ID duplicates causing wrong hotel or flight links.
- Metro-code confusion, especially city codes vs airport codes.
- Incorrect city-center coordinates.
- Placeholder frontend copy reaching users.
- Formula-derived estimates being treated as verified prices.
- Partner tracking breakage during generation.
- Unsupported origins being silently mapped.

## H. Next Implementation Sprint

Recommended next sprint:

1. Create `release/city-registry-100-candidate.json` with 100 draft records.
2. Extend the validator to support candidate target counts and production status.
3. Generate a 100-city readiness report only.
4. Do not generate production slices until the candidate has 0 blocking errors.
