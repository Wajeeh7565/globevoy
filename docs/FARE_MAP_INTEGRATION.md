# Fare-map integration review

This branch combines PR #154 f494975 and PR #155 21c55a2 on top of the
Booking v2 CI correction. Both source PRs remain open against main; nothing was
merged to main. The shared storage and expiry changes merge cleanly.

Reviewed: page offsets are checkpointed only after writes; failures retain the
current task; all provider pages/retries share pacing; 429 persists cooldown;
lease acquisition compares revision and every checkpoint/release requires the
same owner with an unexpired lease. Readers filter TTL and observation age in
both DynamoDB and application code and honor cancellation/page limits. Optimizer
stays opt-in and preserves legacy routing and API responses.

Found and fixed an additional storage edge case: DynamoDB can return an empty
UnprocessedItems entry for the requested table. It previously remained truthy,
causing empty retries and a false failure. Now only nonempty pending writes are
retried; tests cover partial success, exact write counts, empty entries, filtered
empty query pages, pagination and local freshness rejection. Combined focused
suite: 35 tests pass offline. No external providers or AWS calls.

Limits retained for expansion: a monthly minimum does not represent a daily
calendar; bounded partition reads can omit routes. Price observations do not
prove flight availability or arrival times. Controlled staging remains required.
