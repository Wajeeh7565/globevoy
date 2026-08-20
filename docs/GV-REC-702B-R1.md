# GV-REC-702B-R1 — asOf Summary Routing Repair

Staging smoke testing found one presentation bug in GV-REC-702B: a request containing only `asOf=<ISO timestamp>` was classified as a search because `asOf` was included in the endpoint's `hasSearch` detector. The underlying 702B counts and priority logic were correct, but the response returned `status: search` and omitted summary fields such as `counts`, `lanes`, and `policy`.

R1 removes `asOf` from the search-mode detector. `asOf` remains available to make either summary or filtered search results deterministic.

Expected behavior after R1:

- `/api/global-recovery-priority?asOf=2026-08-20T12:00:00.000Z` returns the deterministic summary;
- filtered requests such as `lane=due-now-first-recovery&asOf=...` remain search responses;
- the 431/132/299 accounting and 143/156/132 lane split are unchanged;
- no provider calls, activation, ranking, pricing, generated-tour behavior, or production code are changed.

A focused regression validator locks the asOf-only summary contract.
