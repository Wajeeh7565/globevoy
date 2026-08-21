# GV-WEB-706R — React / Next.js foundation

This directory is the parallel migration target for Globevoy's frontend.

## Decisions

- Next.js 15.5.21: pinned to the major line explicitly supported by current AWS Amplify Hosting documentation.
- React 19.2.7.
- TypeScript strict mode.
- App Router.
- Static export first (`output: 'export'`). Existing AWS Lambda APIs remain the backend.
- No Cognito, DynamoDB, provider, Lambda, production-route, or current `frontend/` replacement is performed by 706R.

## Local commands

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Node.js 20.9+ is required.

## Runtime configuration

When a migrated page begins using the existing API, configure:

`NEXT_PUBLIC_GLOBEVOY_API_BASE_URL`

Do not put provider credentials, Cognito secrets, AWS credentials, or private tokens in `NEXT_PUBLIC_*` variables. The typed API adapter accepts an already-established browser access token from the future Cognito adapter and never persists that token itself.

## Migration rule

A legacy Globevoy page remains authoritative until its React replacement has equivalent deterministic tests and browser acceptance. Do not remove or reroute a proven page merely because a component exists here.
