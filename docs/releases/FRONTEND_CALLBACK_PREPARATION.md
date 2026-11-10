# Production frontend callback release guard

The manually deployed Amplify job 240 lacks auth-callback.html and its authentication scripts. Missing callback handling caused the browser to reach hosting clean-URL normalization and a 404. The repository already contains the callback implementation; no Cognito allowlist change or routing rewrite is required to prepare the correct artifact.

This focused change makes both the manual production packager and composite Amplify build fail if the callback page, shared environment policy, public auth configuration or session implementation is absent. Root classic HTML/CSS/JavaScript and URLs remain unchanged. React remains under /react for account-related functionality. No publishing command is added.

Build a candidate from a clean checkout using Node 24 and the locked web dependencies. Supply the restricted public Maps browser key outside Git, set GLOBEVOY_ENABLE_PRODUCTION_REACT=true, GLOBEVOY_PRODUCTION_REACT_VERIFIED=yes, GLOBEVOY_ENABLE_PRODUCTION_ACCOUNTS=true, GLOBEVOY_PRODUCTION_ACCOUNTS_VERIFIED=yes, and the already verified production API/pool/client/domain identifiers. Set GLOBEVOY_OUTPUT_NAME to a new ignored output directory, then run npm run package:production. These variables build a review candidate; they do not authorize publication or prove complete security acceptance.

Before approval, inspect the artifact: classic home/recommendation/tour/trip pages, runtime/scripts/styles/assets and restricted Maps key preserved; auth-callback.html and dependencies present; exported React account/my-trips/travel-profile routes present; embedded policy chooses only the production API and Cognito for canonical globevoy.com. Unknown/staging identities must not be selected for production. Inspect callback behavior locally at the canonical origin via browser request fulfillment, without publishing or changing callback allowlists.

Use tests/release/browser-smoke.cjs with the appropriate local artifact path for offline navigation checks, plus callback/dependency checks. Real map tiles/provider interactions, public signup/email delivery and complete live frontend browser acceptance require separate controlled acceptance; do not represent blocked external requests as successful vendor rendering.

Account security evidence and the final local artifact checksum are recorded with the preparation report outside Git. Two-user tests must use only the specifically authorized synthetic users and clean up new trips. JWT revocation limitations remain an explicit design consideration; this PR changes no authentication architecture.

No Lambda code/configuration, IAM, Cognito settings, DynamoDB configuration, staging or Amplify hosting changes are part of this PR. The public callback must return 200 with working asset paths when a separately approved frontend release is published; its actual hosting canonicalization must be rechecked then. Preserve the job 240 rollback ZIP before that future deployment.
