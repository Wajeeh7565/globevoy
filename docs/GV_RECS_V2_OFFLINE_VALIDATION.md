# GV-RECS-V2 offline validation

The strongest configuration to test next is FARE_MAP_READ_PLAN=on with FARE_MAP_BALANCED_POOL=on and the standard three-city limit. On this snapshot it surfaced better-connected, longer trips at the high budgets within the same hard limits on planning reads, edges, and elapsed time. The new flags are off by default. Production latency, provider availability, and spend have yet to be measured.

## Real cached fare replay

The inputs were the November 25, 2026 Toronto snapshot and its matching hotel memory export. The fares cover 48,541 rows across 308 partitions, with one departure per directional market-month and no duration or stop counts. The hotel memory covers 55 cities and has no clean Bayesian observation fields. The replay uses the production tour builder and Ignav adapter with mocked responses, an in-memory DynamoDB substitute, and simulated hotel rates. It preserves the eight-candidate limit and role assignment and applies the production budget and date guards. The historical first-passing metric reproduced 74%, 53%, 86%, 67%, 54%, 36%, 27%, and 18%. It is reported separately from the guest and member results below.

Each cell shows the guest’s first verified mock trip and the member’s Best use of your budget role as percentages of entered budget.

| CAD | Baseline | Claude read plan + 4 | Route variants | Beam target | Balanced alone | Read plan + balanced | Read plan + balanced + variants | Read plan + 4 + five-leg live |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,500 | 74 / 81 | 74 / 81 | 76 / 81 | 74 / 82 | 74 / 81 | 74 / 81 | 76 / 81 | 74 / 81 |
| 2,000 | 53 / 80 | 53 / 80 | 53 / 80 | 53 / 80 | 53 / 80 | 53 / 80 | 53 / 80 | 53 / 80 |
| 3,000 | 83 / 83 | 83 / 83 | 83 / 83 | 83 / 83 | 83 / 83 | 83 / 83 | 83 / 83 | 83 / 83 |
| 4,000 | 65 / 78 | 84 / 84 | 65 / 78 | 65 / 78 | 65 / 78 | 84 / 84 | 84 / 84 | 84 / 84 |
| 5,000 | 52 / 63 | 66 / 68 | 52 / 63 | 52 / 69 | 52 / 63 | 66 / 68 | 66 / 68 | 66 / 68 |
| 7,500 | 34 / 44 | 57 / 57 | 34 / 44 | 34 / 46 | 44 / 44 | 53 / 53 | 53 / 53 | 47 / 59 |
| 10,000 | 26 / 33 | 43 / 43 | 26 / 33 | 26 / 35 | 33 / 33 | 46 / 46 | 46 / 46 | 35 / 44 |
| 15,000 | 17 / 21 | 22 / 29 | 17 / 21 | 17 / 23 | 22 / 22 | 31 / 31 | 31 / 31 | 23 / 41 |

The final matrix ran 24 configurations across eight budgets, for 192 cases and 759 mocked displayed cards. It recorded zero duplicate displayed routes within a page and zero protected-budget violations. All cases in the table had complete partition coverage. The read-plan-plus-four-city-and-targeted-beam combination needed five missing partitions at C$4,000, C$5,000 and C$7,500, and four at C$10,000 and C$15,000. Those results are incomplete. The matrix also runs shrink, shrink with p60, regional calibration, Bayes, longer stays, pool diversity, refresh rotation, read allocation alone, and five-leg support alone. Each case records coverage, plans before and after deduplication, prices and stops, verification outcomes, and mocked requests.

## Search limits and variant retention

- At C$7,500–15,000 the baseline used six Toronto partitions, reached 66 total at depth 1, and at depth 2 blocked all 53 new partitions needed by the beam. The reservation for later returns froze the ceiling at 66. The retained routes were at most two cities. With the four-city read plan, the high-budget trace used 6, 28, 50, 64 and 94–96 cumulative reads by successive depth. It explored all four cities.
- The 32-state beam prunes substantially before final rank. At C$15,000 the first layer drew 293 eligible partial candidates. The four-city read plan reduced the first beam from 32 to 12 for its 22-read allocation. The targeted beam alone modestly improved member use, with no change in the high-budget guest pick. In the diagnosis, the C$15,000 targeted beam’s 17 accepted three-city completions failed the geographic pool screen. Preserve read allocation and coherence instead of broadly increasing the cost target.
- In the eight original cases, the legacy collapse removed 30 dated variants from 293 complete accepted candidates. None of those 30 offered two or more extra nights over its retained route. With read plan plus four cities, 14 dated variants were dropped, including two that were both two or more nights longer and higher cost. FARE_MAP_ROUTE_VARIANTS recovered 22 eligible date variants on baseline. Variant retention worked in the dated fixture and barely changed the measured Toronto picks. Keep this feature as a separate opt-in.
- The route-variant pool considers up to three date variants per ordered sequence from the already bounded completed set. It keeps the original representative, cheapest protected-cost variant, and one variant with a meaningful duration gain or a comparably priced departure in another month. Pool and role candidate lists preserve route-level uniqueness. The traditional trip list keeps its existing behavior.
- One fare date per market-month limits departure combinations. Increasing city stay maxima helps some compatible combinations, while flexible trips still cap at 28 nights. In the four-city read-plan runs with the Ignav cap unchanged, stay expansion improved simulated member use at C$5,000, C$7,500 and C$10,000, but lowered the C$4,000 member result from 84% to 75%. Keep the default allowance.
- At C$2,000 the baseline accepted 14 one-city completions across 11 sequences and zero two-city completions. The protected-cost gate rejected 43 one-city and 84 two-city completions. Montego Bay still won the guest queue with cached return evidence at 53%, while member Best use was Fort Lauderdale at 80%. The C$2,000 behavior needs broader evidence on guest ranking and viable two-city dates. The high-budget scoring flag leaves this case alone.

## Quality, verification, and latency

Balanced ranking rewards sufficient time at the destination, caps the reward for more cities at three, and applies a flat fit reward across a spend band. It penalizes geographic detours and discounts a buffered return more than a cached date, with an additional penalty when the return is mirrored. It uses the same already-read routes and final geometry screen. The search protects 10% of the entered budget throughout. The user still sees the first verified result as a guest, and verified prices still drive member roles.

The stronger C$7,500 guest pick was Cairo → Rome → Paris with 19 mocked verified hotel nights split 4 / 7 / 8, across three countries. Its longest intercity hop was 2,139 km and detour ratio 1.00. At C$10,000 and C$15,000 it was Paris → Nice → Rome with 22 nights split 4 / 10 / 8, across two countries. Its longest hop was 688 km and detour ratio 1.01. Both examples require exact verification of a return date inferred from a cached fare. The remaining C$10,000–15,000 convergence reflects similar useful options in this sample. Spending the unused budget was outside the objective.

The real Ignav adapter refused four-city candidates before making provider requests because it accepted four flight legs at most. FARE_MAP_FOUR_CITY_LIVE opts in to five verified flight legs for a structurally valid four-city fare-map loop. At C$15,000 that enabled Bangkok → Hanoi → Kunming → Langkawi as a member winner under simulated verification, with 23 hotel nights, a 2,101 km longest intercity hop and 1.10 detour ratio. The member page used 21 mocked requests with two spares. Leave this flag separate pending verification-latency and cost evidence.

Across two local matrix runs, eight-case optimizer averages were 67–99 ms baseline and 91–104 ms for read plan plus balanced. Observed peak retained completions increased from 49 to 57. These measurements exclude provider latency and do not estimate Lambda percentiles. At high budgets the candidate used four simulated guest flight requests versus three at baseline. With two spares it used 19–20 member requests versus 15. With zero spares it used 12 at each tested high budget and still filled one round. At C$2,000, one spare used eight requests in one round, while zero used eight over two rounds. Compare request usage against production latency and fill rates before changing spare defaults. See [Ignav request and spending controls](IGNAV_SPEND_CONTROL_PROPOSAL.md).

## Hotel upgrade checks

Mocked provider offers exercised the actual Nuitée adapter. Best use accepted an all-in US$540 offer over the US$380 base, rejected a higher-rated offer whose mandatory fee would exceed the 50% allowance, and rejected the US$540 offer when the total hotel allowance was US$530. Something different respected the 25% allowance and accepted breakfast as a meaningful improvement at equal rating. Lowest cost received no discretionary upgrades. Initial pricing and offer re-selection used one hotel request, with fees included. The existing cheapest-room retry gap between the protected and entered budget came from the earlier diagnosis and remains a separate pricing change.

## Synthetic multi-origin checks

Five origins ran all eight budgets under synthetic fares and hotel truth for baseline and read plan plus balanced. Both configurations returned one guest card and three member cards in all 40 cases. Distinct displayed member cities increased from 81 to 107. The benchmark’s member quality flags decreased from three detour flags to one synthetic leg over 14 hours. The hotel and flight mock outputs stayed inside the protected budget. Average guest and member requests changed from 3.4 and 15.1 to 3.8 and 16.3 with the existing spare setting. Average synthetic guest/member percentages were identical at C$1,500, C$2,000 and C$3,000. The C$4,000 paired averages moved from 70% / 77% to 71% / 76%. All synthetic results are separate from the Toronto snapshot table.

## Configuration and reproduction

Keep production defaults as checked in. For the next approved comparison, use FARE_MAP_READ_PLAN=on and FARE_MAP_BALANCED_POOL=on with three cities. Try existing poolSpare=0 and poolSpare=1 independently. Keep FARE_MAP_ROUTE_VARIANTS, FARE_MAP_FOUR_CITY_LIVE and FARE_MAP_BEAM_TARGET separate until they demonstrate their own benefit on representative coverage. Compare exact-date availability, route quality, page fill and time to first verified card before promotion.

Use the existing harness with local file paths. Its matrix JSON contains sensitive replay output and belongs in an ignored local directory.

    node tests/performance/recommendation-investigation.cjs --fare-snapshot <local-gzip> --memory-file <local-memory> --matrix
    node tests/performance/recommendation-investigation.cjs --fare-snapshot <local-gzip> --memory-file <local-memory> --json --cost-study --env FARE_MAP_READ_PLAN=on --env FARE_MAP_BALANCED_POOL=on

The main test runner passed 70 commands across repo, backend, frontend, performance and syntax. The separate provider group passed six commands. Both ran with external network access blocked.


## Files changed

- Search instrumentation, variant retention and ranking in [fare-map-optimizer.js](../backend/services/domain/fare-map/fare-map-optimizer.js).
- Five-leg verification gate in [ignav-live-fares.js](../backend/services/domain/live-fares/ignav-live-fares.js).
- Experiment matrix and production-path mocks in [recommendation-investigation.cjs](../tests/performance/recommendation-investigation.cjs), with split simulated prices in [recommendation-benchmark.cjs](../tests/performance/recommendation-benchmark.cjs).
- Regression coverage in [fare-map-route-variants.test.cjs](../tests/backend/fare-map-route-variants.test.cjs), [recommendation-pool.test.cjs](../tests/backend/recommendation-pool.test.cjs), [ignav-live-fares.test.cjs](../tests/backend/ignav-live-fares.test.cjs), and [hotel-upgrade-policy.test.cjs](../tests/backend/hotel-upgrade-policy.test.cjs). The variant test is registered in [run-tests.mjs](../scripts/run-tests.mjs).
