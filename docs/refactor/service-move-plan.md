# GV-REFACTOR-R1.1 — Proposed backend service move plan

Status: **proposal only — no runtime files moved yet**.

This plan classifies all 69 current files under `backend/services/` by responsibility. It follows the folder direction proposed by Vamsi, while adding explicit account and booking areas that exist in the current codebase.

## Target shape

```text
backend/services/
├── admin/
│   └── audits/
├── accounts/
│   ├── architecture/
│   ├── auth/
│   ├── saved-trips/
│   └── travel-profile/
├── booking/
│   ├── context/
│   └── revalidation/
├── cities/
│   ├── gateways/
│   │   └── staging/
│   ├── recovery/
│   │   └── staging/
│   └── registry/
├── domain/
│   ├── eligibility/
│   ├── live-fares/
│   ├── pricing/
│   └── routing/
│       └── staging/
├── providers/
│   ├── flights/
│   │   ├── duffel/
│   │   │   └── staging/
│   │   ├── staging/
│   │   └── travelpayouts/
│   ├── links/
│   └── stays/
│       ├── agoda/
│       ├── nuitee/
│       ├── shared/
│       └── stay22/
└── shared/
```

## Safety rules before execution

- Do not rename implementation symbols or change behavior while moving files.
- Move one cohort at a time, not all 69 in one commit.
- Update every relative `require(...)` path, validator path, workflow path, and Lambda build/package path in the same cohort commit.
- Preserve the load ordering in `staging-lambda-702d.js`; several staging overlays must install before the ordinary staging Lambda loads.
- Re-run the existing validation suite after every cohort.
- Keep production and `main` untouched until the refactor is proven on the feature branch and staging.
- Treat a zero/low reference count as an investigation signal, never as automatic permission to delete a service.

## Exact proposed mapping

| Current file | Proposed path |
|---|---|
| `backend/services/account-architecture-705a.js` | `backend/services/accounts/architecture/account-architecture-705a.js` |
| `backend/services/affordable-flight-discovery-684b.js` | `backend/services/domain/live-fares/affordable-flight-discovery-684b.js` |
| `backend/services/agoda-demand-readiness-704a.js` | `backend/services/providers/stays/agoda/agoda-demand-readiness-704a.js` |
| `backend/services/agoda.js` | `backend/services/providers/stays/agoda/agoda.js` |
| `backend/services/canonical-total-evidence.js` | `backend/services/domain/pricing/canonical-total-evidence.js` |
| `backend/services/cheap-one-way-flights.js` | `backend/services/providers/flights/cheap-one-way-flights.js` |
| `backend/services/city-registry.js` | `backend/services/cities/registry/city-registry.js` |
| `backend/services/current-500-completion-audit.js` | `backend/services/admin/audits/current-500-completion-audit.js` |
| `backend/services/current-trip-total-712.js` | `backend/services/domain/pricing/current-trip-total-712.js` |
| `backend/services/destination-value-proximity.js` | `backend/services/domain/routing/destination-value-proximity.js` |
| `backend/services/duffel-adult-scope-703e.js` | `backend/services/providers/flights/duffel/duffel-adult-scope-703e.js` |
| `backend/services/duffel-live-adapter-683d.js` | `backend/services/providers/flights/duffel/duffel-live-adapter-683d.js` |
| `backend/services/duffel-p2-staging-683h.js` | `backend/services/providers/flights/duffel/duffel-p2-staging-683h.js` |
| `backend/services/duffel-sandbox-proof.js` | `backend/services/providers/flights/duffel/duffel-sandbox-proof.js` |
| `backend/services/expansion-priority-city-audit-wave2.js` | `backend/services/admin/audits/expansion-priority-city-audit-wave2.js` |
| `backend/services/expansion-priority-city-audit.js` | `backend/services/admin/audits/expansion-priority-city-audit.js` |
| `backend/services/fare-calendar.js` | `backend/services/providers/flights/fare-calendar.js` |
| `backend/services/final-expansion-city-audit.js` | `backend/services/admin/audits/final-expansion-city-audit.js` |
| `backend/services/flexible-dates.js` | `backend/services/providers/flights/flexible-dates.js` |
| `backend/services/flight-cache-semantics-702f-a.js` | `backend/services/providers/flights/flight-cache-semantics-702f-a.js` |
| `backend/services/flight-provider-contract-683c.js` | `backend/services/providers/flights/flight-provider-contract-683c.js` |
| `backend/services/flight-provider-router-683c.js` | `backend/services/providers/flights/flight-provider-router-683c.js` |
| `backend/services/fx-normalization-683g.js` | `backend/services/shared/fx-normalization-683g.js` |
| `backend/services/gateway-foundation-triage-702f-c.js` | `backend/services/cities/gateways/gateway-foundation-triage-702f-c.js` |
| `backend/services/global-provider-recovery-smoke-plan-702c.js` | `backend/services/admin/audits/global-provider-recovery-smoke-plan-702c.js` |
| `backend/services/global-recommendation-coverage-702a.js` | `backend/services/admin/audits/global-recommendation-coverage-702a.js` |
| `backend/services/global-recovery-priority-702b.js` | `backend/services/admin/audits/global-recovery-priority-702b.js` |
| `backend/services/global-route-graph.js` | `backend/services/domain/routing/global-route-graph.js` |
| `backend/services/hotel-guest-context-712.js` | `backend/services/booking/context/hotel-guest-context-712.js` |
| `backend/services/inactive-city-recovery-wave1.js` | `backend/services/admin/audits/inactive-city-recovery-wave1.js` |
| `backend/services/live-fare-selection-685c.js` | `backend/services/domain/live-fares/live-fare-selection-685c.js` |
| `backend/services/live-provider-verification.js` | `backend/services/domain/live-fares/live-provider-verification.js` |
| `backend/services/nuitee-hotel-708c.js` | `backend/services/providers/stays/nuitee/nuitee-hotel-708c.js` |
| `backend/services/ourairports-gateway-enrichment-702f-b.js` | `backend/services/cities/gateways/ourairports-gateway-enrichment-702f-b.js` |
| `backend/services/partner-links.js` | `backend/services/providers/links/partner-links.js` |
| `backend/services/permanent-gateway-foundation-candidate-702f-e.js` | `backend/services/cities/gateways/permanent-gateway-foundation-candidate-702f-e.js` |
| `backend/services/price-evidence-integrity.js` | `backend/services/domain/pricing/price-evidence-integrity.js` |
| `backend/services/property-identity-682c.js` | `backend/services/providers/stays/shared/property-identity-682c.js` |
| `backend/services/provider-live-coverage.js` | `backend/services/admin/audits/provider-live-coverage.js` |
| `backend/services/provider-mapping-audit.js` | `backend/services/admin/audits/provider-mapping-audit.js` |
| `backend/services/public-live-fare-pilot-684a.js` | `backend/services/domain/live-fares/public-live-fare-pilot-684a.js` |
| `backend/services/remaining-current-city-audit.js` | `backend/services/admin/audits/remaining-current-city-audit.js` |
| `backend/services/reviewed-activation-promotion-702e.js` | `backend/services/cities/recovery/reviewed-activation-promotion-702e.js` |
| `backend/services/reviewed-recovery-overlay-702c-r2.js` | `backend/services/cities/recovery/reviewed-recovery-overlay-702c-r2.js` |
| `backend/services/route-curator.js` | `backend/services/domain/routing/route-curator.js` |
| `backend/services/route-diversity-687b.js` | `backend/services/domain/routing/route-diversity-687b.js` |
| `backend/services/route-feasibility.js` | `backend/services/domain/routing/route-feasibility.js` |
| `backend/services/staging-affordable-flight-five-origin-703d.js` | `backend/services/providers/flights/staging/staging-affordable-flight-five-origin-703d.js` |
| `backend/services/staging-booking-revalidation-707b-r1.js` | `backend/services/booking/revalidation/staging-booking-revalidation-707b-r1.js` |
| `backend/services/staging-booking-revalidation-707b.js` | `backend/services/booking/revalidation/staging-booking-revalidation-707b.js` |
| `backend/services/staging-booking-revalidation-708c.js` | `backend/services/booking/revalidation/staging-booking-revalidation-708c.js` |
| `backend/services/staging-cognito-auth-705b-r3.js` | `backend/services/accounts/auth/staging-cognito-auth-705b-r3.js` |
| `backend/services/staging-duffel-five-origin-703b.js` | `backend/services/providers/flights/duffel/staging/staging-duffel-five-origin-703b.js` |
| `backend/services/staging-duffel-shared-budget-703c.js` | `backend/services/providers/flights/duffel/staging/staging-duffel-shared-budget-703c.js` |
| `backend/services/staging-duffel-two-adult-703e.js` | `backend/services/providers/flights/duffel/staging/staging-duffel-two-adult-703e.js` |
| `backend/services/staging-gateway-foundation-702f-d.js` | `backend/services/cities/gateways/staging/staging-gateway-foundation-702f-d.js` |
| `backend/services/staging-multicity-auto-dates-710e-r3a.js` | `backend/services/domain/routing/staging/staging-multicity-auto-dates-710e-r3a.js` |
| `backend/services/staging-reviewed-recovery-702d.js` | `backend/services/cities/recovery/staging/staging-reviewed-recovery-702d.js` |
| `backend/services/staging-saved-trips-705c.js` | `backend/services/accounts/saved-trips/staging-saved-trips-705c.js` |
| `backend/services/staging-travel-profile-710f-r1.js` | `backend/services/accounts/travel-profile/staging-travel-profile-710f-r1.js` |
| `backend/services/stay22-evidence-682b.js` | `backend/services/providers/stays/stay22/stay22-evidence-682b.js` |
| `backend/services/travel-entry-eligibility.js` | `backend/services/domain/eligibility/travel-entry-eligibility.js` |
| `backend/services/traveller-pricing.js` | `backend/services/domain/pricing/traveller-pricing.js` |
| `backend/services/travelpayouts.js` | `backend/services/providers/flights/travelpayouts/travelpayouts.js` |
| `backend/services/verified-city-activation.js` | `backend/services/cities/registry/verified-city-activation.js` |
| `backend/services/whole-trip-date-optimizer-681b-p2.js` | `backend/services/domain/routing/whole-trip-date-optimizer-681b-p2.js` |
| `backend/services/whole-trip-fare-reconciliation-685c-r1.js` | `backend/services/domain/pricing/whole-trip-fare-reconciliation-685c-r1.js` |
| `backend/services/whole-trip-route-optimizer.js` | `backend/services/domain/routing/whole-trip-route-optimizer.js` |
| `backend/services/worldwide-city-registry-701a.js` | `backend/services/cities/registry/worldwide-city-registry-701a.js` |

## Suggested execution cohorts

1. **Low-risk audit/city planning utilities first** — `admin/audits`, then non-runtime city review/recovery utilities.
2. **Shared/domain pure logic** — eligibility, pricing, routing helpers, live-fare selection.
3. **Provider adapters** — flights, stays, and partner links; verify provider contracts after each subgroup.
4. **Account and booking services** — preserve owner-private Cognito/DynamoDB boundaries and current-price semantics.
5. **Staging overlays last** — preserve installation order and fail-closed behavior in `staging-lambda-702d.js`.

## Questions to confirm with Vamsi before the first runtime move

- Should staging-specific implementations live inside their domain/provider folder (as proposed here), or under one top-level `staging/` tree?
- Should historical audit/planning modules remain executable source under `services/admin/audits`, or eventually move to a tooling/scripts area?
- Do we want provider-specific subfolders such as `providers/flights/duffel/` now, or keep a shallower `providers/flights/` until more providers arrive?
- Should `VALIDATION_*.json` evidence stay version-controlled during the first refactor, then be handled separately as a data/artifact migration?

## Non-goals for R1.1

No provider behavior changes, no AWS migration, no CDK/Fargate work, no secrets/IAM changes, no production deployment, no recommendation behavior changes, and no deletion of historical validation/data artifacts.
