# Deploy GV-TRUST-685B

Frontend-only release. Deploy the complete frontend ZIP to the existing Globevoy Amplify app using the same proven frontend deployment path.

**Do not redeploy Lambda.** Keep GV-REC-684B-R3 production backend and all 89 Lambda environment variables unchanged.

After Amplify deployment:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
& "$env:USERPROFILE\Downloads\Run-GV-TRUST-685B-Deployment-Smoke.ps1" -BaseUrl "https://globevoy.com"
```

Then complete the manual checklist.

Rollback: redeploy the immediately preceding working frontend package. Backend rollback is not required because GV-TRUST-685B changes no backend code.
