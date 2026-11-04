# GV-RC-686D — Consolidated UX Release Candidate

Status: validated and packaged for independent audit. **Not deployed.**

## Master result

- Master validator: **51 total / 51 pass / 0 fail**
- GV-SHELL-686A cumulative validator: **21/21 PASS**
- GV-JOURNEY-686B cumulative validator: **24/24 PASS**
- GV-BOOK-686C cumulative validator: **27/27 PASS**
- All current validators in `validation/`: **zero failures**
- All inherited 686A/686B/686C checksum manifests: **PASS**

## Release result

686D uses the authenticated 686C package as the sole cumulative source. It preserves the trust repair, unified product shell, journey experience and booking workspace.

Two final RC-only customer-flow repairs were made after browser QA:

- inherited Duffel sandbox/prototype UI is hidden from the canonical booking workspace;
- offline complete-trip QA uses the existing static map instead of loading Google Maps, eliminating local referer console errors.

These are release-hardening repairs, not new product features or a redesign.

## Exact production runtime delta

Direct comparison against authenticated GV-BOOK-685D-R1:

- Changed runtime files: **21**
- Added runtime files: **5**
- Removed runtime files: **0**
- Backend/Lambda/runtime-server files: **0**

Exact old/new hashes are in `GV-RC-686D-PRODUCTION-DELTA-MANIFEST.md`.

## Browser QA

Desktop: **PASS**

- homepage and shared navigation visible;
- all-flight recommendation rendered;
- optional journey playback and manual synchronization worked;
- ground-transfer journey remained ground transport;
- complete-trip handoff preserved saved snapshot parameters;
- all five booking-workspace steps worked;
- sticky summary remained visible;
- metro JFK → LGA disclosure and LGA handoff worked;
- no public sandbox/prototype content remained visible;
- final isolated walkthrough console errors: **0**.

375 px mobile: **PASS**

- document client width 360 px and scroll width 360 px;
- no page-level horizontal overflow;
- journey player width 332 px;
- journey rail scroll contained internally (304 px client / 626 px scroll);
- sticky context width 340 px;
- booking stepper scroll contained internally (342 px client / 669 px scroll);
- summary width 334 px and collapsed successfully;
- public sandbox content remained hidden.

## End-to-end walkthrough

**PASS using isolated/offline fixtures with live API disabled.**

Homepage → generated recommendation → journey story → Play your journey → rail/card/map synchronization → complete-trip details → booking workspace → Verify flights → Verify stays → Price confidence → Complete bookings → validated Aviasales/Agoda handoffs.

Fixtures covered:

- all-flight Toronto → Montreal → New York → Toronto;
- Toronto → Cleveland → Pittsburgh → Toronto with ground transfer;
- requested JFK → resolved LGA metro substitution;
- LIVE, CACHED and ESTIMATED evidence.

## Trust and evidence result

**PASS**

- Ground transport never receives Aviasales flight fulfilment.
- Hotel property costs remain planning estimates without actual rate evidence.
- Cached hotel and Duffel observations remain visibly cached.
- Partial evidence produces an estimated trip total.
- Provider result reviewed never means booked.
- Booking status remains outside Globevoy until partner purchase.
- No Pay button, payment/card form, combined checkout, order, confirmation or ticket claim exists.

## Partner handoff result

**PASS**

- Fixture Aviasales: `YYZ0209CLE1`, `PIT0809YYZ1`
- Fixture Agoda: correct Cleveland/Pittsburgh city, check-in/out, 1 room, 1 adult and `cid=1891461`
- Metro fixture: requested JFK resolved to LGA; outbound search uses `LGA0509YOW2`
- Metro Agoda: Ottawa, Sep 5–8, 1 room, 2 adults and `cid=1891461`
- Ground fixture's planted Aviasales URL was rejected.

## Legacy-route result

**PASS**

`multi-city.html` redirects to the canonical visualizer while preserving query and hash. Normal shared navigation does not expose the legacy route or old prototype destinations.

## Authentication honesty result

**PASS for guest-first beta; authentication is not implemented.**

No public password/login form exists. The UI states secure accounts are unavailable, and the travel profile is browser-local. This release does not claim authentication is complete.

## Performance/loading measurements

Local isolated browser harness, live API disabled, fresh-tab observed wall time:

- initial homepage/search readiness: **1,905 ms**
- authenticated 685D-R1 comparison in the same harness: **2,270 ms**
- first meaningful all-flight recommendation visibility: **289 ms**
- journey experience readiness: **231 ms**
- booking workspace readiness: **347 ms**

No obvious loading regression was observed. These are release-smoke timings, not production Web Vitals.

## Legal/commercial gate

**LEGAL-CONTENT-APPROVAL-REQUIRED**

Privacy, Terms and Affiliate root content is byte-identical to 685D-R1; 686D did not invent or approve legal wording. Owner/legal/commercial approval is still required before deployment. See `GV-RC-686D-LEGAL-COMMERCIAL-GATE.md`.

## Deployment

No deployment, backend change, Lambda change or live provider call was performed. Package SHA-256 is supplied by the adjacent release sidecar after packaging.

