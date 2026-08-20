# Deploy GV-PROD-673F-R2

This is a frontend-only photo-hydration repair.

## Deploy

Upload the complete frontend ZIP to the existing Amplify app.

**Do not redeploy Lambda.** Keep the currently deployed backend and all environment variables unchanged.

## Verify

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force

& "$env:USERPROFILE\Downloads\Run-GV-PROD-673F-R2-Deployment-Smoke.ps1" `
  -BaseUrl "https://globevoy.com"
```

Then complete `GV-PROD-673F-R2_MANUAL_CHECKLIST.md`, especially the visible third-card photo test.

## Rollback

Redeploy `frontend-staging-gv-prod-673f-r1-release-integrity-portable.zip`. The backend does not need rollback because it is not changed by R2.
