# GlobeVoy — Feature Inventory (staging)

**Owner:** GlobeVoy team  
**Purpose:** List what a visitor can do and where that capability is implemented, as requested for product planning.  
**Reference:** [Staging website](https://staging.dy4fw8gx1ccie.amplifyapp.com/) and GitHub `staging` source.  
**Last reviewed:** October 2026

> **Important:** “Implemented in code” does not prove a feature works end to end in staging. Confirm each feature in the browser before declaring it fully functional. The classic `frontend/` experience and React `web/` pages coexist; do not count their duplicate interfaces as separate product features.

## 1. Search and personalization

| Feature / user story | GitHub implementation | Verification |
|---|---|---|
| As a visitor, I can enter my starting city or airport. | [Homepage](../frontend/index.html), [search JS](../frontend/scripts/home-live-674a.js) | Manual staging test needed |
| I can choose a travel budget and group size. | [Homepage](../frontend/index.html), [search JS](../frontend/scripts/home-live-674a.js) | Manual staging test needed |
| I can choose trip dates/duration and adjust advanced preferences. | [Homepage](../frontend/index.html), [search JS](../frontend/scripts/home-live-674a.js) | Manual staging test needed |
| I can choose interests, destination region and hotel preferences. | [Homepage](../frontend/index.html), [search JS](../frontend/scripts/home-live-674a.js) | Manual staging test needed |
| I can preview destination ideas from the homepage. | [Homepage](../frontend/index.html), [discovery data](../frontend/runtime/discovery-data-500.js) | Manual staging test needed |
| I can start discovering trips without signing in. | [Homepage](../frontend/index.html), [Account](../web/components/account/account-page-client.tsx) | Manual staging test needed |

## 2. Recommendations, routes and trip details

| Feature / user story | GitHub implementation | Verification |
|---|---|---|
| I can see suggested single-city destinations based on my search. | [Explore UI](../frontend/explore.html), [explore JS](../frontend/scripts/explore-live.js), [recommendations API](../backend/recommendations.js) | Manual staging and API check needed |
| I can compare suggested destinations and estimated prices. | [Mixed results](../frontend/mixed-results.html), [mixed results JS](../frontend/scripts/mixed-results-674a.js) | Manual staging test needed |
| I can explore destinations on a map and see photos where available. | [Explore](../frontend/explore.html), [city images](../frontend/scripts/city-images-673c.js) | Manual staging test needed |
| I can generate a connected multi-city itinerary. | [Multi-city visualizer](../frontend/multicity-visualizer.html), [generated tour API](../backend/generated-tour.js) | Manual staging and API check needed |
| I can compare routes and see the order of stops. | [Multi-city visualizer JS](../frontend/scripts/multicity-visualizer-687b.js) | Manual staging test needed |
| I can view each stop, estimated hotel/transport details and a journey visualization. | [Selected trip](../frontend/multi-city-trip.html), [journey JS](../frontend/scripts/journey-experience-687a.js) | Manual staging test needed |
| I can adjust or replace a route destination where available. | [Multi-city visualizer](../frontend/multicity-visualizer.html), [route JS](../frontend/scripts/multicity-visualizer-687b.js) | Check route eligibility and limitations |

## 3. Account, saved trips and profile

| Feature / user story | GitHub implementation | Verification |
|---|---|---|
| I can sign in through the managed account flow. | [React account](../web/components/account/account-page-client.tsx), [authentication provider](../web/components/account/auth-provider.tsx) | Test on approved deployed origin; not localhost |
| I can sign out of my session. | [React Account](../web/components/account/account-page-client.tsx) | Test on approved deployed origin |
| I can save and reopen my trips. | [React My Trips](../web/components/account/my-trips-client.tsx), [account API](../web/lib/api.ts) | Test signed-in flow |
| I can filter or delete my saved trips. | [React My Trips](../web/components/account/my-trips-client.tsx) | Test signed-in flow |
| I can save my usual airport, currency, interests and travel preferences. | [React Travel Profile](../web/components/account/travel-profile-client.tsx) | Test signed-in flow |
| I can save visited and wishlist destinations. | [React Travel Profile](../web/components/account/travel-profile-client.tsx) | Test signed-in flow |

## 4. Flights, hotels, booking information

| Feature / user story | GitHub implementation | Verification |
|---|---|---|
| I can review estimated flights, hotels and total trip budget. | [Booking page](../frontend/booking.html), [booking hub](../frontend/scripts/booking-hub-685d.js) | Test evidence freshness and pricing labels |
| I can review entry/transit guidance associated with a planned route. | [Booking page](../frontend/booking.html), [entry JS](../frontend/scripts/booking-entry-675a.js) | Guidance only, not visa confirmation |
| I can continue to booking partners where a verified handoff is available. | [Booking hub](../frontend/scripts/booking-hub-685d.js), [React booking workspace](../web/components/booking/booking-workspace-client.tsx) | Test availability and links |
| I can re-check current provider price evidence for eligible saved journeys. | [React booking workspace](../web/components/booking/booking-workspace-client.tsx) | Limited flow; verify eligibility |

**Not currently a completed GlobeVoy feature:** making and paying for a complete flight+hotel reservation inside GlobeVoy itself. Booking proceeds via external partners and estimates should never be described as guaranteed live prices.

## 5. Current product issues / potential new features

These are proposals **for team review**, not things to present as already delivered:

1. More variety across repeat destination searches (Vamsi's feedback).
2. Scheduled discovery and refresh of new destination/attraction information.
3. More accurate, refreshed flight/hotel pricing and clearer confidence labels.
4. Fewer unnecessary paragraphs and more purposeful visual content (Mehdi's feedback).
5. Consistent cards, page layout, buttons and typography across older and React pages.
6. A smoother handoff from recommendation to final reservation.

## How to use this with Vamsi

- Walk through the live website as a **guest** and as a **signed-in** user on approved staging.
- Update each verification cell to `Working`, `Partially working`, `Not working`, or `Not tested`.
- Report limitations/bugs separately instead of silently classifying all source code as complete.
- Agree on priority improvements before opening implementation issues.
