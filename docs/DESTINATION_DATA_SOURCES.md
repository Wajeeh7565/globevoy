# Globevoy Destination Data Sources

Globevoy currently has two destination datasets because the MVP can run as a static frontend while the API prototype is still being prepared.

## Frontend Fallback Dataset

`destination-data.js` is used by the static website when live API mode is disabled in `config.js`.

This file keeps the public site usable on AWS Amplify without backend secrets or API calls. It should be treated as the browser fallback dataset, not the long-term source of truth.

## Backend Recommendation Dataset

`backend/src/data/destination-meta.js` is used by the Node API prototype to build full-trip recommendations.

This dataset is the current source for backend recommendation metadata: Agoda city IDs, daily spend estimates, fallback nightly rates, fallback flight estimates, map coordinates, practical notes, and destination framing.

## Sync Rule During The MVP

Until the Explore page calls the backend exclusively, keep both datasets aligned for visible fields such as city, country, image, theme, season, and practical notes.

Cost fields should move toward the backend dataset as the canonical source because they feed Budget Fit, Agoda stay estimates, Travelpayouts flight estimates, and the numeric "why it fits" copy.

Daily spend is now treated as a backend-owned cost input. The backend exposes a derived `dailyBudget` object with food, local transport, everyday buffer, and basic activity estimates. See `backend/DAILY_SPEND_METHODOLOGY.md` for the current MVP method and the future source-backed upgrade path.

## Next Step

After the backend is deployed and stable, migrate Explore to consume backend recommendations by default and keep `destination-data.js` only as an offline/static fallback.
