# GV-PROD-673C — Browser-verified handoff honesty and active-city photo recovery

## Scope

- Replaced the unqualified complete-booking claim with an explicit Kiwi beta handoff.
- Uses Kiwi's documented direct multi-city results path, copies every dated leg, and preserves individual-leg fallback links.
- Does not claim one payment or guaranteed route preservation.
- Added verified local Miami and Montego Bay images to repair the manual-test failures.
- Added Wikipedia REST exact-title lookup before Wikidata/geographic fallbacks.
- Added Wikipedia search fallback for ambiguous/transliterated city names.
- Neutral fallback results for production-active cities are not cached, so later visits retry photo resolution.
- The visualizer waits for the resolver rather than immediately presenting generated artwork as if it were a city photograph.

## Honest limitation

A static deployment cannot prove that an external partner will preserve a route after navigation. The beta handoff must be manually checked. Likewise, Wikimedia availability and article coverage vary; unresolved active-city images are visibly neutral and remain eligible for retry/manual review.
