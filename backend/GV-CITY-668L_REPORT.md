# GV-CITY-668L — Current-500 Completion Activation Merge

## Status

Complete and locally validated. No frontend files changed. No provider calls were made during packaging.

## Purpose

Merge the reviewed GV-CITY-668J 400-city activation baseline with the completed GV-CITY-668K Final145 audit. The result completes the audit of the full Current-500 foundation while preserving the 1,000-city discovery registry.

## Imported evidence

- Baseline: `data/verified-city-activation-400-668j.json`
- New audit: `data/provider-live-current500-final145-668k-source.json`
- New audit engine: GV-CITY-668E
- Completed: 145/145
- Provider-covered: 68
- Production-ready: 63
- Reviewed inactive: 82
- Failed batches: 0

## Merged production state

- Registry cities: 1,000
- Audited: 545
- Production-active: 322
- Direct/metro active: 295
- Gateway-supported active: 27
- Reviewed inactive: 223
- Unaudited: 455
- Estimate-only total: 678

### Current-500

- Audited: 500/500
- Production-active: 309
- Reviewed inactive: 191

### Expansion-500

- Audited: 45
- Production-active: 13
- Reviewed inactive: 32
- Unaudited: 455

## GV-CITY-668K import details

The Final145 wave contributed:

- 45 direct/metro activations
- 18 gateway-supported activations
- 63 total activations
- 82 reviewed inactive records

The 18 newly active gateway destinations are:

- Banff → Calgary (YYC)
- Bath → Bristol (BRS)
- Braga → Porto (OPO)
- Brighton → London Heathrow (LHR)
- Cesky Krumlov → Prague (PRG)
- Guanajuato → Leon/Guanajuato (BJX)
- Koh Lanta → Krabi (KBV)
- Kyoto → Osaka Kansai (KIX)
- Matera → Bari (BRI)
- Moshi → Kilimanjaro (JRO)
- Naivasha → Nairobi (NBO)
- Niagara Falls → Toronto (YYZ)
- Ronda → Malaga (AGP)
- Segovia → Madrid (MAD)
- Siena → Florence (FLR)
- Sintra → Lisbon (LIS)
- Toledo → Madrid (MAD)
- Whistler → Vancouver (YVR)

Five provider-covered cities remained inactive under the unchanged quality and comfort policy:

- Juneau — too many transfers
- Granada — flight duration too long
- Puerto Princesa — no quality-qualified live hotel rate
- Taormina — flight duration too long and too many transfers
- Chefchaouen — flight duration too long and too many transfers

## Retry queues

- Missing flight observations: 189
- Unresolved Agoda mapping: 25
- No live hotel rate: 4
- Hotel quality failure: 7
- Flight comfort failure: 27

Queue membership can overlap. A retry queue is an operational worklist and does not prove that a city or mapping is permanently unsupported.

## Runtime behavior

Feature flag:

`ENABLE_VERIFIED_CITY_ACTIVATION_668L=true`

When enabled:

- only the 322 imported verified-active cities are eligible for provider-driven live recommendations;
- the 223 reviewed inactive cities remain discoverable as estimate-only;
- the 455 unaudited expansion cities remain discoverable as estimate-only;
- gateway labels and transfer evidence remain attached;
- exact itinerary-level GV-LIVE-667A/GV-LIVE-667B checks remain mandatory before current price, availability, or bookability claims.

When disabled, activation enforcement rolls back to the prior non-allowlist behavior.

## API

Existing read-only endpoints are preserved:

- `GET /api/verified-city-activation`
- `GET /api/verified-city-activation/retry-queues`
- `GET /api/current-500-completion-audit`

## Files added or changed

Changed:

- `services/verified-city-activation.js`

Added:

- `data/provider-live-current500-final145-668k-source.json`
- `data/provider-live-current500-final145-668k-source-VALIDATION.json`
- `data/verified-city-activation-545-668l.json`
- `data/verified-city-production-active-322-668l.json`
- `data/verified-city-production-active-322-668l.csv`
- `data/verified-city-review-223-668l.json`
- `data/verified-city-review-223-668l.csv`
- `data/verified-city-retry-queues-668l.json`
- `build-gv-city-668l-activation.js`
- `validate-gv-city-668l.js`
- `Run-GV-CITY-668L-Activation-Smoke.ps1`
- `VALIDATION_GV_CITY_668L.json`
- `GV-CITY-668L_REPORT.md`
- `MANIFEST_GV_CITY_668L.txt`

## Deployment

1. Deploy the 668L backend ZIP.
2. Add `ENABLE_VERIFIED_CITY_ACTIVATION_668L=true`.
3. Keep existing provider credentials and earlier feature flags.
4. Run `Run-GV-CITY-668L-Activation-Smoke.ps1`.

The prior 668J allowlist remains the rollback artifact.
