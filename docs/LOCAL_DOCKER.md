# Local backend with Docker

Run these commands from the repository root using Docker Desktop in Linux-container
mode. The image uses Node.js 24, runs as the non-root `node` user and starts
`backend/server.js` on port 8787. Its loaded modules need no npm packages, so there
is no install/build step. All backend services and runtime data retain their paths.

## Build and run

```powershell
docker build -t globevoy-backend:local .
docker run --rm -d --name globevoy-backend-local -p 127.0.0.1:8787:8787 -e GLOBEVOY_USE_MOCKS=true -e CORS_ORIGIN=http://127.0.0.1:8000 globevoy-backend:local
```

The host port is bound only to loopback. Change the first port to use a different
host port, for example `127.0.0.1:8788:8787`. Set `CORS_ORIGIN` to your actual local
frontend origin when testing browser requests; it is an existing server setting.
No environment files, AWS credentials or provider tokens are needed for these
smoke tests. Do not put credentials into the Dockerfile or build arguments.

## Test

```powershell
Invoke-RestMethod http://127.0.0.1:8787/health
Invoke-RestMethod http://127.0.0.1:8787/api/city-registry
docker inspect --format '{{.State.Health.Status}}' globevoy-backend-local

$env:GLOBEVOY_SMOKE_BASE_URL = 'http://127.0.0.1:8787'
node --test tests/backend/server-http.test.cjs
Remove-Item Env:GLOBEVOY_SMOKE_BASE_URL
```

Expect HTTP 200, `ok: true`, a populated registry search and eventually Docker
health `healthy`. The same tests run automatically with `npm run test:backend`
and `npm test`; without the URL variable they start and stop an isolated local
Node process on a temporary port. They do not require Docker or npm dependencies.
Only loopback HTTP targets are accepted, and the two routes use bundled data.
The image health check also uses Node, so curl is not needed. Health confirms the
HTTP process is responding, not that external providers are available.

## Stop

```powershell
docker logs globevoy-backend-local
docker stop globevoy-backend-local
```

`--rm` removes the container after it stops. The local image remains available.

## Scope

This is the existing public prototype API, not the production Lambda account
backend or frontend. Cognito, saved trips and travel-profile account routes are
not added here. Application behavior, AWS and authentication stay unchanged.
The allowlist in `.dockerignore` excludes frontend builds, tests, archives,
deployment backups and credentials. Do not replace the explicit Dockerfile
copies with `COPY . .`.
