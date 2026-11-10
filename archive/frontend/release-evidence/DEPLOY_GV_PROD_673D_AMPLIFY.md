# Deploy GV-PROD-673D

Upload the complete Amplify-ready frontend ZIP directly to the existing Globevoy Amplify app.

Do not extract the ZIP before uploading.
Do not edit or redeploy Lambda.
Do not change the GV-CITY-668T activation flags.

After deployment:

1. Wait for Amplify deployment to complete.
2. Hard-refresh Globevoy with `Ctrl+Shift+R`.
3. Open a generated multi-city route and continue to the booking hub.
4. Run `Run-GV-PROD-673D-Deployment-Smoke.ps1` with the deployed site URL.
5. Complete `GV-PROD-673D_MANUAL_CHECKLIST.md`.

Rollback: redeploy the verified GV-PROD-673C frontend ZIP with SHA-256 `6656a3040c84995a16b1bb7e9db873f15abff03e18eaae789dc18d2528e7c708`.
