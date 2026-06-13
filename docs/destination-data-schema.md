# Globevoy Destination Data Schema v1

Status: MVP curated estimates, not live booking data.

Target dataset size: 30 destinations. Current backend dataset size: 30 destinations.

Every destination should include the same fields so Globevoy can move from simple route cards to full trip-cost recommendations.

## Required Fields

| Group | Fields |
|---|---|
| Identity | `id`, `city`, `country`, `code` |
| Map | `lat`, `lng`, `x`, `y` |
| Trip framing | `days`, `recommendedDays`, `nights`, `season`, `seasonInsight` |
| Style | `theme`, `styleTags` |
| Cost inputs | `costs.flightDemandUsd`, `costs.nightlyStayUsd`, `costs.dailySpendUsd`, `costs.dailySpendSource`, `costs.activitiesLocalUsd`, `dailyBudget.perDay`, `dailyBudget.trip` |
| Practical notes | `travelTime`, `walkability`, `visaNote`, `weather`, `localCost`, `safetyNote` |
| Recommendation voice | `whyItFits` |
| Media | `img` |

## Cost Meaning

- `flightDemandUsd`: route-demand adjustment used with distance to estimate flight cost.
- `nightlyStayUsd`: curated nightly stay estimate for a realistic, non-luxury stay.
- `dailySpendUsd`: food, basic local transport, and everyday spending per day.
- `dailySpendSource`: short source or confidence note for the daily spend estimate. Use honest labels such as `manual MVP estimate - needs verification` until the number is backed by a named data source.
- `activitiesLocalUsd`: rough activity/local movement budget for the full trip.
- `dailyBudget.perDay.food`: derived daily food estimate.
- `dailyBudget.perDay.localTransport`: derived daily local transit / short ride estimate.
- `dailyBudget.perDay.everydayBuffer`: derived small daily buffer for water, snacks, tips, misc. items, and local variance.
- `dailyBudget.trip.basicActivities`: activity/local movement estimate for the whole trip.
- `recommendedDays`: default trip length used for the estimate.
- `nights`: stay nights used for lodging estimate.

## Daily Spend Method

The current MVP uses a hybrid-but-honest approach:

1. Each destination has one curated `dailySpendUsd` value.
2. Each value is currently marked with `dailySpendSource: manual MVP estimate - needs verification` unless a named source has actually been used.
3. The backend derives a readable daily budget from that value:
   - food
   - local transport
   - everyday buffer
4. The separate `activitiesLocalUsd` value remains a whole-trip estimate for basic paid activities and local movement.

This keeps the product useful without pretending the values are exact. The next data upgrade should replace the manual estimates with a documented source approach, such as a hybrid of public cost-of-living/travel budget data and manual review for the most important destinations.

## Offer Calculation

For each origin and destination:

```text
flight = distance-based route estimate + destination demand adjustment
stay = nightlyStayUsd * nights
daily = dailySpendUsd * recommendedDays
activities = activitiesLocalUsd
total = flight + stay + daily + activities
budgetBuffer = userBudget - total
```

The backend now also returns:

```text
dailyBudget.perDay = food + localTransport + everydayBuffer
dailyBudget.trip = tripFood + tripLocalTransport + tripEverydayBuffer + basicActivities
```

## Budget Fit Formula

`Budget Fit` is a 25-98 score based on how comfortably the estimated full trip fits inside the user's budget. It is not a popularity score.

Globevoy also returns a plain-language `budgetFitLabel`:

```text
Good fit: total trip estimate is 90% or less of user budget
Tight: total trip estimate is more than 90% but less than or equal to 100% of user budget
Over budget: total trip estimate is above user budget
```

```text
budgetUse = total / userBudget

If budgetUse <= 0.70: Budget Fit = 96
If budgetUse is 0.71-0.85: Budget Fit scales from 95 down to 85
If budgetUse is 0.86-1.00: Budget Fit scales from 84 down to 65
If budgetUse is 1.01-1.15: Budget Fit scales from 64 down to 40
If budgetUse is 1.16-1.30: Budget Fit scales from 39 down to 25
If budgetUse > 1.30: hide the result from the MVP result list
```

Meaning:

- `90+`: comfortably inside budget.
- `75-89`: strong fit with useful room.
- `60-74`: close fit, but still workable.
- `40-59`: stretch option.
- `<40`: weak fit, shown only if it is still within the MVP tolerance.

The score should be calculated from full trip cost only: flight, stay, daily spending, and local activities. It should not be changed by result order or visual ranking.

The backend helper `calculateFullTripCost` produces:

- estimated flight cost
- estimated stay cost
- estimated daily spend total
- estimated activities/local total
- total trip estimate
- budget buffer
- budget use ratio
- Budget Fit score
- Budget Fit label
- Budget Fit status for UI styling

## Numeric Why It Fits Copy

Every recommendation should explain the estimate with numbers:

```text
Your $1,500 budget covers a $1,010 full-trip estimate:
$370 flight, $310 stay, $240 daily spending, and $90 activities/local.
That leaves $490 in budget, giving Mexico City a Budget Fit of 96.
```

The destination-specific `whyItFits` field can add context after the numeric explanation, but it should not replace the cost reasoning.

## Practical Notes Display

Every selected destination should expose practical decision notes, not only price:

- Travel time: helps users understand route effort.
- Walkability: helps users know whether the trip works without a car.
- Local cost: explains how expensive the destination feels after arrival.
- Visa note: reminds users to verify entry rules before booking.
- Weather: gives a quick timing/comfort cue.
- Safety: gives a non-alarming practical caution.

Explore should show the full practical note set in the selected destination panel. Ask Globevoy should include a smaller practical snapshot in result cards and the full set when answering about one destination.

## Edge-Case Handling

The MVP should avoid dead-end messages.

- Very low budgets: explain that full-trip estimates include flight, stay, daily spending, and activities; show the closest curated alternatives and the budget gap.
- No matches with filters: suggest clearing filters or widening the trip style; show closest alternatives when possible.
- High budgets: explain that Globevoy still ranks practical value first; future versions can use extra room for multi-city ideas, longer trips, or upgraded stays.
- Empty destination pool: explain that the curated MVP dataset is still small.

## Next Data Improvements

- Add source notes for each estimate.
- Add seasonal multipliers.
- Add origin-specific flight baselines for Toronto, Montreal, Vancouver, New York, and London.
- Replace curated estimates with API-supported pricing where possible.
