# Full website Docker demo (GV-DOCKER-002)

Local build only; no AWS deployment is performed by the build or tests.
The separate Dockerfile preserves the backend-only Dockerfile and .dockerignore.
Node 24 builds Next.js with the existing pinned lockfile, static export and composer.
The runtime has no Next.js server or node_modules, runs as `node`, serves port 8787,
and loads the existing backend services/data. Only public travel GET routes are forwarded;
prototype audit/provider/admin endpoints are intentionally unavailable in this wrapper.

## Build, run, test, stop (Windows PowerShell)

```powershell
Set-Location 'C:\Users\Hassa\Downloads\globevoy'
docker build --platform linux/amd64 -t globevoy-full-demo -f Dockerfile.fargate-demo .
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
# Port 8787 must be free. For another port, change both mapping and exact origin.
docker run -d --name globevoy-full-demo --cpus=0.25 --memory=512m -p 127.0.0.1:8787:8787 -e GLOBEVOY_DEMO_ORIGIN=http://127.0.0.1:8787 globevoy-full-demo
if ($LASTEXITCODE -ne 0) { throw 'Container failed to start' }
try {
  (Invoke-WebRequest http://127.0.0.1:8787/ -UseBasicParsing).StatusCode
  Invoke-RestMethod http://127.0.0.1:8787/health
  Invoke-RestMethod 'http://127.0.0.1:8787/api/city-registry?q=Toronto&limit=3'
  Start-Process http://127.0.0.1:8787/
  New-Item -ItemType Directory -Force .cache/fargate-demo-site | Out-Null
  docker cp globevoy-full-demo:/app/.cache/fargate-demo-site/. .cache/fargate-demo-site
  $env:GLOBEVOY_DEMO_TEST_URL='http://127.0.0.1:8787'
  node scripts/run-tests.mjs demo
  if ($LASTEXITCODE -ne 0) { throw 'HTTP tests failed' }
  # npm ci --prefix web --no-audit --no-fund; install Playwright Chromium if needed.
  # Or use an installed Edge browser:
  $env:GLOBEVOY_DEMO_BROWSER_CHANNEL='msedge'
  node scripts/run-tests.mjs demo-browser
  if ($LASTEXITCODE -ne 0) { throw 'Browser test failed' }
  docker inspect --format '{{.State.Health.Status}}' globevoy-full-demo
  docker stats --no-stream globevoy-full-demo
} finally {
  docker stop globevoy-full-demo
  docker rm globevoy-full-demo
}
```

The HTTP group can also start the wrapper locally against the extracted real site:
remove `GLOBEVOY_DEMO_TEST_URL`, then `node scripts/run-tests.mjs demo`.
Never run `compose-demo.mjs` over a nonempty output directory; the existing composer
rejects overwriting a prior artifact. Preserve prior evidence or use a fresh output path.

## Isolation and limitations

The dedicated build replaces the shared policy module using the existing webpack
replacement hook (`GLOBEVOY_PRODUCTION_POLICY_MODULE`; the name is historical).
Only this Docker build receives the demo module. Production/staging source is unchanged.
The server inserts a blocking configuration script before classic/React scripts.
It advertises exactly `GLOBEVOY_DEMO_ORIGIN`, never an arbitrary Host/Origin header.
Other origins fail closed. No wildcard origin or automatic production/staging fallback.
The static artifact and React chunks contain no production/staging API/Cognito destinations.

Accounts, Cognito login, saved-trip API, profile storage, worldwide registry, booking,
fare calendar and provider/admin APIs are unavailable. Existing disabled-account UI and
an explicit demo notice explain this. Guest browser storage remains available.
No production tokens, identities or data are used. Google Maps remains unconfigured
(the existing public-key placeholder); do not inject a production key into this demo.
External fonts/images may need internet and are not guaranteed offline.

Recommendations, registry and multi-city planning use the local Node prototype;
this is not Lambda parity. Only the existing multi-city and generated-tour feature
flags are enabled in the image; provider credentials are absent. A representative
YYZ / CAD 2500 / March 2027 / 1 passenger / 7 nights query produced multi-city routes.
Generated-tour returned HTTP 200 with `supported:false` and
`stale-or-mixed-itinerary-dates`. Its itinerary safety guard is preserved, not bypassed.
Do not present this query as a successfully generated/price-validated tour.
Some date/provider-dependent queries will not work without separate backend work.

## Evidence and sizing

Validated locally with Docker Desktop Linux AMD64, Node 24, non-root user `node`,
health HEALTHY, 0.25 CPU / 512 MiB hard limits; about 78 MiB after HTTP/browser probes.
Six HTTP tests and browser navigation passed. This is a small sequential demo, not
load testing. 256/512 is feasible for these probes; recommend 512 CPU / 1024 MiB for
an approved interactive meeting task with ECS Exec overhead and headroom. Review the
extra charge before launch. Next build is a separate stage and needs more build memory.
Existing CSS autoprefixer warnings do not prevent build or typechecking.

## AWS deployment: commands to review, NOT executed

Requires separate explicit approval of image digest, task definition, resources,
network access and costs. Do not modify CodeExecStack, CDKToolkit, production, IAM
or the existing demo security group. Existing zero-ingress networking cannot expose
the website to a browser. A separately approved source-IP-only TCP 8787 rule on an
isolated security group is necessary for direct browser access; never use 0.0.0.0/0.
Until approved, test through existing authorized ECS Exec with no inbound port.
HTTP public-IP browsing is a temporary demo, not production TLS/authentication.
No service, ALB, NAT gateway or DNS change is needed or authorized here.

The registry-specific ECR helper from GV-AWS-DOCKER-001 performs automatic auth.
Do not print tokens or use plaintext login storage. After manual approval:

```powershell
$region='us-east-2'
$kit='C:\Users\Hassa\Downloads\GV-AWS-DOCKER-001'
$plan=Get-Content (Join-Path $kit 'demo-plan.json') -Raw | ConvertFrom-Json
$state=Get-Content (Join-Path $kit 'demo-state.json') -Raw | ConvertFrom-Json
$identity=aws sts get-caller-identity --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $identity.Account -ne $plan.account) { throw 'Account mismatch or expired authentication' }
# Inspect demo-plan.json field names privately; use the existing verified repository URI.
$repository=$plan.repositoryUri
if (-not $repository) { throw 'Missing approved repository URI' }
$tag='gv-docker-002-'+(git rev-parse --short HEAD)
docker tag globevoy-full-demo ($repository+':'+$tag)
docker push ($repository+':'+$tag)
if ($LASTEXITCODE -ne 0) { throw 'Push failed' }
$image=aws ecr describe-images --repository-name globevoy-backend-demo --image-ids imageTag=$tag --region $region --output json | ConvertFrom-Json
$digest=$image.imageDetails[0].imageDigest
if ($LASTEXITCODE -ne 0 -or $digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Digest verification failed' }
# Build a new revision from the approved dedicated demo definition only.
$old=aws ecs describe-task-definition --task-definition $state.taskDefinitionArn --region $region --output json | ConvertFrom-Json
$td=$old.taskDefinition
if ($td.family -ne 'globevoy-backend-demo' -or $td.containerDefinitions.Count -ne 1 -or $td.containerDefinitions[0].name -ne 'backend') { throw 'Unexpected definition' }
$container=$td.containerDefinitions[0]
$container.image=$repository+'@'+$digest
$container.command=@('timeout','--signal=TERM','--kill-after=10s','3600','node','ops/docker/serve-demo.cjs')
# Use exactly one approved origin. With no ingress, loopback permits ECS Exec probes.
$demoOrigin='http://127.0.0.1:8787'
$container.environment=@(@{name='GLOBEVOY_DEMO_ORIGIN';value=$demoOrigin})
# Other image defaults provide mock mode and the two local planning flags.
$request=[ordered]@{family=$td.family;taskRoleArn=$td.taskRoleArn;executionRoleArn=$td.executionRoleArn;networkMode='awsvpc';requiresCompatibilities=@('FARGATE');cpu='512';memory='1024';runtimePlatform=@{operatingSystemFamily='LINUX';cpuArchitecture='X86_64'};containerDefinitions=@($container)}
# Confirm essential=true, writable filesystem for ECS Exec, initProcessEnabled=true,
# existing dedicated logs and port 8787. Preserve approved roles/logging/health checks.
New-Item -ItemType Directory -Force .cache/gv-docker-002 | Out-Null
$file=Join-Path (Get-Location) '.cache/gv-docker-002/task-definition.json'
[IO.File]::WriteAllText($file,($request|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
# Local CLI input validation first (no registration):
aws ecs register-task-definition --cli-input-json ('file://'+$file) --generate-cli-skeleton output --region $region
# STOP: review JSON/digest and obtain approval before the following mutation.
$new=aws ecs register-task-definition --cli-input-json ('file://'+$file) --region $region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Registration failed' }
$active=aws ecs list-tasks --cluster globevoy-backend-demo --desired-status RUNNING --region $region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $active.taskArns.Count -ne 0) { throw 'A demo task is already active; do not launch' }
# Reuse the preserved launcher network JSON (approved subnet/SG/public-IP settings).
$network=Get-ChildItem (Join-Path $kit 'launch-requests') -Filter '*network.json' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $network) { throw 'Missing approved network JSON' }
$launched=aws ecs run-task --cluster globevoy-backend-demo --task-definition $new.taskDefinition.taskDefinitionArn --launch-type FARGATE --count 1 --enable-execute-command --network-configuration ('file://'+$network.FullName) --region $region --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $launched.failures.Count -or $launched.tasks.Count -ne 1) { throw 'Launch failed: inspect sanitized failure' }
$task=$launched.tasks[0].taskArn
aws ecs wait tasks-running --cluster globevoy-backend-demo --tasks $task --region $region
aws ecs describe-tasks --cluster globevoy-backend-demo --tasks $task --region $region --query 'tasks[].{status:lastStatus,health:healthStatus,agents:containers[].managedAgents}'
aws logs tail /ecs/globevoy-backend-demo --since 10m --region $region
# Probes use JSON files to preserve JavaScript quoting in Windows PowerShell 5.1.
foreach ($route in @('/health','/api/city-registry')) {
  $code="fetch('http://127.0.0.1:8787$route').then(async r=>{console.log(r.status,await r.text());if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"
  $execRequest=@{cluster='globevoy-backend-demo';task=$task;container='backend';interactive=$true;command=('node -e "'+$code+'"')}
  $execFile=Join-Path (Get-Location) '.cache/gv-docker-002/exec.json'
  [IO.File]::WriteAllText($execFile,($execRequest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  aws ecs execute-command --cli-input-json ('file://'+$execFile) --region $region
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Probe failed; stop the demo task below'; break }
}
# Stop immediately after testing:
aws ecs stop-task --cluster globevoy-backend-demo --task $task --reason 'GV-DOCKER-002 demo complete' --region $region --query 'task.lastStatus'
aws ecs wait tasks-stopped --cluster globevoy-backend-demo --tasks $task --region $region
aws ecs list-tasks --cluster globevoy-backend-demo --desired-status RUNNING --region $region --query taskArns
```

Use the same JSON-file ECS Exec technique as the fixed meeting helper, pointing to
the new task ARN, with `node -e "fetch('http://127.0.0.1:8787/health').then(async r=>console.log(r.status,await r.text()))"`;
then substitute `/api/city-registry`. Include cluster, task, container `backend`,
interactive true and command in BOM-free JSON, passed with `--cli-input-json file://...`.
Never rewrite the original kit's state file to make it target an unreviewed revision.
If direct-browser networking is separately approved, set the exact public demo origin
before launching, verify `/`, `/react/account/`, `/health`, `/api/city-registry`, and
check browser network requests never target production/staging APIs.
Fargate assigns its public IP after launch, so a raw-IP origin cannot be guessed in
advance. For a browser demonstration, use an approved stable demo hostname as the
exact origin (for example `http://globevoy-demo.local:8787`) and, after separate local
approval, map that hostname to the task IP on the demonstration computer. This needs
no production DNS change. Direct raw-IP browsing will deliberately leave API features
disabled if it does not match the configured origin. Neither this hostname mapping
nor inbound networking has been configured or tested in AWS by this change.

```powershell
# Only after separate networking approval and exact-origin task configuration:
$publicOrigin='http://<approved-task-public-ip>:8787'
(Invoke-WebRequest ($publicOrigin+'/') -UseBasicParsing).StatusCode
(Invoke-WebRequest ($publicOrigin+'/react/account/') -UseBasicParsing).StatusCode
Invoke-RestMethod ($publicOrigin+'/health')
Invoke-RestMethod ($publicOrigin+'/api/city-registry')
```

Rollback: stop this standalone task and wait for STOPPED. The old pinned image,
task definition and meeting kit remain untouched; use the original reviewed launcher
for the backend-only demo after confirming no running/pending demo task exists.
Retain the new private ECR image/task definition only if approved. Stopped tasks have
no compute charge; retained ECR storage and existing CloudWatch logs can still cost.
Do not delete shared resources or widen permissions to resolve a demo failure.

References: [multi-stage builds](https://docs.docker.com/build/building/multi-stage/),
[Fargate task parameters](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html),
[ECS Exec prerequisites and logging](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html).
