# GlobeVoy — Feature Inventory and GitHub References

**Date:** October 8, 2026  
**Purpose:** Identify existing GlobeVoy user features, locate their implementation in GitHub, and prepare for a team review.

**Repository:** [Wajeeh7565/globevoy — staging](https://github.com/Wajeeh7565/globevoy/tree/staging)

**Important:** The features below are supported by code in the staging repository. Their deployment status and end-to-end functionality still need to be confirmed through website testing.

## A. Homepage and Trip Search

| Feature | What the user can do | GitHub reference |
| --- | --- | --- |
| Starting city search | Enter a departure city or airport and choose from suggestions | [Homepage React component](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/discovery/home-discovery-client.tsx) |
| Location-based origin | Use location services to select a nearby departure airport | [Homepage React component](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/discovery/home-discovery-client.tsx) |
| Budget and passengers | Set trip budget, currency and number of travellers | [Homepage](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/index.html) |
| Travel preferences | Choose dates, trip duration, interests, region and hotel style | [Homepage search logic](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/home-live-674a.js) |
| Homepage trip previews | See suggested trips before opening the full results page | [Trip previews](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/discovery/home-trip-previews.tsx) |

## B. Recommendations and Results

| Feature | What the user can do | GitHub reference |
| --- | --- | --- |
| Single-city recommendations | Discover destinations based on budget and preferences | [Recommendation backend](https://github.com/Wajeeh7565/globevoy/blob/staging/backend/recommendations.js) |
| Mixed trip results | Compare single-city and multi-city trip possibilities | [Mixed results frontend](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/mixed-results-674a.js) |
| Budget-based ranking | View destinations selected using cost, preferences and quality rules | [Recommendation backend](https://github.com/Wajeeh7565/globevoy/blob/staging/backend/recommendations.js) |
| Destination maps | Explore recommended destinations geographically | [Explore frontend](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/explore-live.js) |
| Destination photos | View photos associated with destinations | [City image component](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/city-images-673c.js) |
| Flexible fare comparison | Explore observed flight prices for different travel dates where supported | [Explore frontend](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/explore-live.js) |

## C. Multi-City Trip Planning

| Feature | What the user can do | GitHub reference |
| --- | --- | --- |
| Automatic route generation | Generate a connected multi-city itinerary | [Generated tour backend](https://github.com/Wajeeh7565/globevoy/blob/staging/backend/generated-tour.js) |
| Multiple route choices | Compare alternative multi-city itineraries | [Multi-city visualizer](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/multicity-visualizer-687b.js) |
| Route visualization | See city order, travel connections and route maps | [Multi-city visualizer](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/multicity-visualizer-687b.js) |
| Route customization | Replace or adjust cities in a generated itinerary where permitted | [Multi-city visualizer](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/multicity-visualizer-687b.js) |
| Trip details | View trip duration, estimated transport and hotel costs | [Trip details page](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/multi-city-trip.html) |
| Visual journey experience | Explore the trip as a journey from departure to return | [Journey experience](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/journey-experience-687a.js) |

## D. Accounts and Personalization

| Feature | What the user can do | GitHub reference |
| --- | --- | --- |
| User authentication | Sign in, create an account through managed authentication, and sign out | [Account component](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/account/account-page-client.tsx) |
| Travel Profile | Save home airport, currency, interests, hotel preferences and travel pace | [Travel Profile component](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/account/travel-profile-client.tsx) |
| Visited and wishlist places | Record previously visited destinations and places the user wants to visit | [Travel Profile component](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/account/travel-profile-client.tsx) |
| Saved Trips | Save trips to a signed-in account and reopen them later | [My Trips component](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/account/my-trips-client.tsx) |
| Saved-trip management | View, filter and delete saved trips | [My Trips component](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/account/my-trips-client.tsx) |

## E. Flight, Hotel and Booking Features

| Feature | What the user can do | GitHub reference |
| --- | --- | --- |
| Flight and hotel estimates | View the estimated cost of transport and accommodation | [Recommendation backend](https://github.com/Wajeeh7565/globevoy/blob/staging/backend/recommendations.js) |
| Booking itinerary | Review the flight, hotel and transport components of a planned journey | [Booking Hub](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/booking-hub-685d.js) |
| External booking links | Open external travel partners where supported | [Booking Hub](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/booking-hub-685d.js) |
| Fresh price revalidation | Request updated provider evidence for eligible saved trips | [Booking workspace](https://github.com/Wajeeh7565/globevoy/blob/staging/web/components/booking/booking-workspace-client.tsx) |
| Entry and transit guidance | Review travel-entry considerations for a planned route | [Booking entry logic](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/scripts/booking-entry-675a.js) |
| Price transparency | Understand the difference between live, cached and estimated prices | [Trust and pricing page](https://github.com/Wajeeh7565/globevoy/blob/staging/frontend/trust.html) |

## F. Areas for Improvement

These are possible improvements to discuss, not completed features.

| Improvement | Reason |
| --- | --- |
| More diverse city recommendations | Avoid recommending very similar destinations repeatedly |
| Periodic destination-data updates | Keep attraction and destination information fresh |
| Better personalization | Make stronger use of saved preferences and travel history |
| More reliable live prices | Reduce reliance on estimates and outdated provider observations |
| Complete booking integration | Improve the path from trip planning to confirmed reservations |
| Better performance | Reduce delays and improve the user experience |
| Unified React experience | Complete migration and reduce differences between older and newer pages |

## Next Steps

1. Test the major features on GlobeVoy staging.
2. Record whether each one is working, partially working or not working.
3. Confirm the relevant GitHub source files.
4. Review gaps and priorities with the team.
5. Select improvements and create development tasks.

**Expected outcome:** A clear reference showing what GlobeVoy currently offers, how features are implemented, and what should be improved next.
