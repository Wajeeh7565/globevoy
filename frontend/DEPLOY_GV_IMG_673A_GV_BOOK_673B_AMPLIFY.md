# Deploy GV-IMG-673A + GV-BOOK-673B

1. Open AWS Amplify for the Globevoy production frontend.
2. Choose the current production branch and select **Deploy updates**.
3. Upload `frontend-staging-gv-img-673a-gv-book-673b-global-images-multicity-search-complete.zip` directly.
4. Do not extract the ZIP before uploading. `index.html` is already at the archive root.
5. Do not edit or redeploy Lambda for this release.
6. Wait for Amplify deployment to finish.
7. Open Globevoy in an Incognito window or press `Ctrl + Shift + R`.
8. Run `Run-GV-IMG-673A-GV-BOOK-673B-Smoke.ps1`.
9. Complete the manual checks in `GV-IMG-673A_GV-BOOK-673B_MANUAL_CHECKLIST.md`.

## Rollback

Redeploy the last accepted GV-UX-672B frontend ZIP. The backend is unchanged, so no Lambda rollback is needed.
