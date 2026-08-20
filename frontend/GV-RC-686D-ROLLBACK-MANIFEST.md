# GV-RC-686D — Rollback Manifest

No deployment was performed.

## Currently deployed comparison state

The direct production comparison baseline used for this release candidate is:

- GV-BOOK-685D-R1
- Authenticated portable ZIP SHA-256: `a01337ec4494a4a1bf907811b3f24da1fc2854f7b35cb3ca94a423b52b10736e`

If 686D is later deployed and needs to be rolled back to the immediately preceding production state, redeploy the complete authenticated 685D-R1 frontend artifact through the same Amplify application/branch workflow. Do not restore individual files from mixed releases.

## Known-good emergency rollback

The recorded known-good rollback remains:

- GV-TRUST-685B
- Amplify production job 231 artifact
- SHA-256: `22107006178F42914881E9A31E11CC2B372D784AD30C87ECAB4D483AD01E36FC`

Use Amplify's controlled redeploy/rollback workflow for that exact artifact if an emergency rollback beyond 685D-R1 is required.

## Post-rollback checks

After any rollback:

1. Confirm the Amplify deployment reports success for the intended branch.
2. Confirm the deployed artifact/hash corresponds to the selected rollback package.
3. Run desktop and 375 px smoke checks for homepage, generated trip, trip details and booking.
4. Verify partner URLs and ground-transfer integrity.
5. Verify the guest-first authentication boundary.
6. Record the rollback job ID and live-smoke evidence externally.

No backend, Lambda, database, environment-variable or data migration rollback is part of this frontend release candidate.

