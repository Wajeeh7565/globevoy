# Booking v2 browser CI repair

The eleven failures share two obsolete entry points in the browser harness:
Booking v2 intentionally hides `#gv-booking-workspace`, but the harness waited
for that section without clicking **Show detailed view**. Reproduced the failure
on main 4b24a6d with the guest, unsaved and unsupported-backend scenarios.

The shared navigation now asserts that v2 is visible, contains itinerary rows,
uses HTTPS/noopener links and explains price uncertainty, then opens the detailed
view through its public button. All original authentication, saved-trip ownership,
no-provider-POST, duplicate-request, partial/quota/network/401 and expiry assertions
remain. Expiry waits for the existing refresh timer to remove LIVE status instead
of racing a fixed 2.4-second sleep against browser timer scheduling.

Verification: the non-browser baseline has 70 passing commands across repo,
backend, frontend, account, providers, release, performance and syntax; five web
commands, TypeScript and static export also pass. The browser suite has 20 tests;
run against both source and the composed production artifact. Browser networking
is intercepted. Edge may be selected locally with GLOBEVOY_TEST_BROWSER_PATH;
CI installs pinned Playwright Chromium.

Follow CI build order: build the isolated production fixture, then restore the
normal web export before source browser tests. A production-only web/out cannot
serve the synthetic mock release used by source tests. This changes no runtime
code, authentication policy or provider gate.
