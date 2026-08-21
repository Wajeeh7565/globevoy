# GV-ACCOUNT-705B — Staging Cognito Managed Login Bootstrap

## Scope

705B bootstrap creates the **staging identity foundation only**. It does not yet change the live Globevoy frontend or Lambda runtime.

The operator script may create/reuse:

1. staging Cognito user pool
2. OAuth resource server and `globevoy/trips.write` scope
3. public browser app client with no secret
4. Cognito prefix domain with Managed Login v2
5. default Cognito-managed login branding

It does **not** create DynamoDB, saved-trip routes, IAM browser credentials, Lambda changes, Amplify changes, payment/provider integrations, or production Cognito resources.

## Why this split exists

705A established the security architecture. The current `create-account.html` is still deliberately only a browser-local travel profile. Before changing that UI, 705B first creates a real staging authentication service whose public IDs/endpoints can be wired and tested deterministically.

This keeps infrastructure creation separate from browser/runtime changes and gives us a clean rollback/debug boundary.

## AWS contract researched on 2026-08-21

Authoritative AWS references:

- `create-user-pool`: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-user-pool.html
- `create-resource-server`: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-resource-server.html
- `create-user-pool-client`: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-user-pool-client.html
- `create-user-pool-domain`: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-user-pool-domain.html
- `create-managed-login-branding`: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-managed-login-branding.html
- Cognito command list, including `describe-managed-login-branding-by-client`: https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/
- managed login: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html
- self-service signup: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html

Important provider facts carried into the script:

- user-pool `ESSENTIALS` is Managed-Login-capable; Managed Login is not available on Lite;
- email can be the username and auto-verified attribute;
- self-service signup is enabled by `AllowAdminCreateUserOnly=false`;
- custom OAuth scopes come from a Cognito resource server;
- OAuth browser features require `AllowedOAuthFlowsUserPoolClient=true`;
- the app client can be public with `GenerateSecret=false`;
- the only enabled OAuth flow is `code`;
- `create-user-pool-domain --managed-login-version 2` selects modern Managed Login;
- a programmatically created app client still needs a Managed Login branding style; the script applies Cognito-provided default branding;
- prefix domains can take roughly a minute to propagate.

## Exact staging configuration

Region:

`us-east-2`

User pool name:

`globevoy-staging-users`

App client name:

`globevoy-staging-web`

Resource server:

`globevoy`

Custom scope:

`globevoy/trips.write`

Callback URL:

`https://staging.dy4fw8gx1ccie.amplifyapp.com/auth-callback.html`

Logout URL:

`https://staging.dy4fw8gx1ccie.amplifyapp.com/index.html`

The Cognito prefix domain is generated from a one-way SHA-256-derived suffix. The AWS account number is used only inside the shell process for uniqueness; it is not printed and is not placed in the public config output.

## Public browser-client security

The bootstrap creates a **public** client:

- no client secret
- code grant only
- future browser flow = Authorization Code + PKCE S256
- scopes = `openid email profile globevoy/trips.write`
- native Cognito identity provider
- user-existence errors prevented
- token revocation enabled
- exact callback/logout allowlists

705B bootstrap does not implement the PKCE JavaScript yet. It creates the server-side Cognito configuration that the next 705B runtime step will consume.

## Idempotence and fail-closed behavior

The operator script can be re-run.

It searches for the expected staging resources by their reviewed names and identifiers. If they exist, it validates security-critical settings before reuse.

It refuses to silently repair or overwrite conflicts such as:

- duplicate named user pools/app clients
- non-email username pool
- self-signup disabled
- Lite user-pool tier
- missing custom scope
- browser client with a secret
- implicit/other OAuth flow instead of code-only
- mismatched callback/logout URLs
- different existing Cognito domain
- domain owned by another pool

No destructive cleanup is automatic. If a run stops after creating some resources, re-run the same script after correcting the reported problem; matching resources are safely reused.

## Operator output

The script writes:

`GV-ACCOUNT-705B-Staging-Cognito-Public.json`

The JSON intentionally contains only values that the later browser/backend config needs:

- region
- user pool ID
- public app client ID
- issuer
- Cognito domain
- authorize/token/logout endpoints
- callback/logout URL
- OAuth flow/scopes
- Managed Login branding ID
- booleans showing which resources were newly created

It does **not** contain:

- AWS account number
- caller ARN
- client secret
- AWS access key/session token
- provider credentials
- user passwords

Cognito user-pool IDs and public app-client IDs are identifiers, not credentials; still, the output should be treated as project configuration rather than posted publicly without need.

## Cost note

This creates real AWS staging resources. Cognito pricing depends on feature tier and active-user/authentication usage. The bootstrap does not create test users or generate traffic by itself. Before a broad public rollout, review current AWS Cognito pricing and budgets/alerts separately.

## Validation

`backend/validate-gv-account-705b.js` verifies the script boundary without contacting AWS.

CI additionally runs:

- repository guard
- 703E flight regression
- 704A hotel architecture regression
- 705A account architecture regression
- 705B bootstrap validation
- `bash -n` shell syntax check
- no production/runtime/deployment wiring

CI **must never execute the operator script**, because the script is designed to create real staging Cognito resources.

## Operator sequence after merge

1. Download the exact CI operator pack.
2. Upload the bootstrap shell script to AWS CloudShell.
3. Verify its SHA-256 against the CI-produced digest.
4. Run it once.
5. Return only `GV-ACCOUNT-705B-Staging-Cognito-Public.json` to ChatGPT.
6. ChatGPT validates the public config and then builds the next runtime portion on a new/same reviewed feature branch.

## Next runtime portion after successful bootstrap

The next change should implement **staging only**:

- `auth-callback.html`
- PKCE S256 browser helper
- redirect to Cognito Managed Login
- code exchange at `/oauth2/token`
- access/ID session state in `sessionStorage`, not `localStorage`
- no persisted refresh token
- shared-shell Sign in / signed-in state
- guest mode preserved
- backend bearer-access-token verification boundary
- no saved-trip writes yet

Saved-trip DynamoDB persistence remains **GV-ACCOUNT-705C** after secure staging login is proven end to end.
