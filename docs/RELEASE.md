# GlobeVoy release procedure (frontend and backend)

GitHub `main` is the source of truth for production. Code is committed, reviewed and merged into `main` and pushed **before** it is packaged or deployed. Nothing is built from a local edit or an unmerged branch.

## Where production runs

| Part | Service | Identifier |
| --- | --- | --- |
| Website `globevoy.com` and `www` | AWS Amplify Hosting, manual deploy (zip upload) | App `globevoy` `dttux5e6ddtzb`, branch `main`, us-east-2 |
| Redirect rules | Amplify custom rules | `https://www.globevoy.com` → `https://globevoy.com` (302); `/<*>` → `/index.html` (404-200) |
| Login | Cognito Hosted UI (classic) | Pool `us-east-2_gr7p2ySyA`, client `h41vnimofe8dq3rsprjqg7aom` |
| Recommendations API | Lambda `globevoy-recommendations` (function URL) | us-east-2 |

The account has no separate CloudFront distribution or S3 website bucket. Amplify manages the CDN and storage. The second Amplify app `globevoy-staging` is not production.

Every website package contains `release-manifest.json` listing the Git commit, a `dirty` flag, `onMain`, and the SHA-256 of every file. The live copy is at `https://globevoy.com/release-manifest.json`.

## Frontend release

1. Merge the change into `main` on GitHub. Locally: `git checkout main && git pull`.
2. `npm test` and the browser group (`GLOBEVOY_TEST_BROWSER_PATH=… node scripts/run-tests.mjs browser`).
3. Package. The packager refuses a dirty tree, and refuses a commit that is not on `origin/main`:
   ```
   GLOBEVOY_MAPS_BROWSER_KEY=<current browser key from runtime/config.js on the live site> \
   GLOBEVOY_ENABLE_PRODUCTION_REACT=true GLOBEVOY_PRODUCTION_REACT_VERIFIED=yes \
   GLOBEVOY_ENABLE_PRODUCTION_ACCOUNTS=true GLOBEVOY_PRODUCTION_ACCOUNTS_VERIFIED=yes \
   GLOBEVOY_PRODUCTION_USER_POOL_ID=us-east-2_gr7p2ySyA \
   GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID=h41vnimofe8dq3rsprjqg7aom \
   GLOBEVOY_PRODUCTION_COGNITO_DOMAIN=https://globevoy-prod-083409.auth.us-east-2.amazoncognito.com \
   GLOBEVOY_OUTPUT_NAME=<new-unique-name> node ops/release/package-production.mjs
   ```
   Afterwards run `npm run build:web` to restore the development React output.
4. **Ancestry check — mandatory.** Confirm the new package contains whatever is live:
   ```
   curl -fsS https://globevoy.com/release-manifest.json -o live-manifest.json
   node ops/release/verify-live-ancestry.mjs live-manifest.json .cache/<new-unique-name>
   ```
   `FAIL` means production has code your package does not. Stop and merge production's commit first.
5. Keep the zip of the build that is currently live (the rollback copy).
6. Deploy from one terminal only: Amplify console → `globevoy` → `main` → *Deploy updates* → upload `.cache/<name>.zip`.
7. Verify: open `/release-manifest.json` and check the commit; check that every listed file's SHA-256 matches what is served; load the home, sign-in, results, itinerary and booking pages.

### Frontend rollback

Upload the previous zip to the same Amplify branch (*Deploy updates*). Amplify switches atomically. Then check `/release-manifest.json` again. You can also rebuild any earlier release exactly from its manifest commit with the same command.

## Backend release

The same rule applies: merge to `main`, then package with `ops/release/package-backend.cjs` from a clean `main` checkout and deploy the Lambda as a new numbered version. Settings that change behaviour stay off until they are tested. Rollback: point production back at the previous Lambda version, using the rollback procedure tested for version 10.

## Never

- Deploy from an unmerged branch or a dirty tree (both are blocked by the packager).
- Deploy a package whose ancestry check fails.
- Run the same deployment from two terminals.
- Change Route 53 records as part of a release.
