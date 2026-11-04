# GV-RC-686D — Validation Architecture

## Authoritative release gate

Run:

```powershell
node validation/validate-gv-rc-686d.js
```

or:

```powershell
.\Run-GV-RC-686D-Validate.ps1
```

The master validator executes the relevant cumulative validators and then applies final-state release, trust, shell, journey, booking, handoff, authentication, legal and package-scope checks.

## Repaired inherited validators

The validators were preserved and updated rather than deleted:

- `validation/validate-gv-shell-686a.js`: its obsolete requirement that the generated-tour engine equal pre-journey R2 was superseded by the approved 686B engine hash.
- `validation/validate-gv-journey-686b.js`: its obsolete requirement that `booking.html` equal the pre-workspace 686A page was superseded by the approved 686D RC page hash.
- `validation/validate-gv-book-686c.js`: its fixture isolation and final RC stylesheet/cache assertions were updated for the consolidated package.

The inherited 686A, 686B and 686C checksum manifests were rebaselined only where later approved releases intentionally changed their covered files. Every listed checksum now matches the cumulative 686D state.

## Historical validators

Older root-level `validate-gv-*.js` files remain historical release evidence. They are intentionally not the 686D release gate because many lock old version markers or old release-specific topology. They were not deleted or presented as current.

Current executable gates are the four validators in `validation/`. Running every JavaScript validator in that directory produces zero failures.

