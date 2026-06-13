# Globevoy Full-Trip Cost Logic

Status: implemented in the backend recommendation service.

## Purpose

Globevoy should estimate the cost of the whole trip, not only the flight or hotel. The backend combines API data and Globevoy dataset values into one clear trip estimate.

## Inputs

- Flight estimate from Travelpayouts / Aviasales
- Stay estimate from Agoda or fallback nightly rate
- Trip length from user input
- Daily spend estimate from the Globevoy destination dataset
- Basic activities / local cost estimate from the Globevoy destination dataset
- User budget

## Calculation

```text
flight = flightUsd
stay = nightlyStayUsd * nights
dailySpend = dailySpendUsd * tripDays
activitiesLocal = activitiesLocalUsd

total = flight + stay + dailySpend + activitiesLocal
budgetBuffer = userBudget - total
budgetUse = total / userBudget
```

The backend exposes this through `calculateFullTripCost`.

## Budget Fit Labels

```text
Good fit:
total trip estimate is 90% or less of user budget

Tight:
total trip estimate is more than 90% but less than or equal to 100% of user budget

Over budget:
total trip estimate is above user budget
```

The backend also keeps the numeric `score` because the UI uses it for ranking and visual comparison.

## Output Per Recommendation

- `flight`
- `lodging`
- `dailySpend`
- `activitiesLocal`
- `dailyBudget`
- `total`
- `budgetBuffer`
- `budgetUse`
- `score`
- `budgetFitLabel`
- `budgetFitStatus`
- `whyItFits`

## Missing Data Behavior

Missing flight data:
Travelpayouts errors fall back to curated destination flight candidates.

Missing stay data:
Agoda errors or weak hotel results fall back to curated nightly stay estimates.

Missing daily spend data:
The destination dataset provides an MVP fallback value with `dailySpendSource`.

## Test Examples

The backend test suite covers:

- Toronto to Cancun as a good-fit example
- Toronto to Lisbon as a tight example
- Toronto to New York as an over-budget example
- missing month default
- invalid origin fallback
- Agoda zero-result fallback
- Agoda low-trust stay filtering

Run:

```text
node src/recommendations.test.js
```
