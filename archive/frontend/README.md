# Historical classic frontend material

This archive preserves earlier release evidence and validators. It is outside the
`frontend/` directory copied into the Amplify artifact.

| Folder | Contents |
| --- | --- |
| `release-evidence/` | Release notes, deployment instructions, checksums and reports from previous work |
| `validation-results/` | Recorded outputs and historical audit inputs; these are not current test results |
| `legacy-validation-scripts/` | Historical validators and wrappers retained as reference |

The November 6 cleanup moved 39 files byte-for-byte. The complete mapping and
SHA-256 hashes are in [remaining-cleanup-moves.json](../../docs/refactor/remaining-cleanup-moves.json).
No current executable, configuration, workflow or checksum manifest references
those files. `npm run test:structure` checks that invariant.

Archived validators retain their original relative paths and assertions. They
are **not runnable from this archive** and are not part of the current test suite.
To investigate their original behavior, use a separate checkout of the relevant
historical release. The manifest's baseline commit provides the exact pre-move
layout, but even that newer staging source may fail older release assertions.
Do not copy old validators back into the active tree as a routine test step.

Files used by current package validators are now grouped under
`frontend/validation/`, including release JSON, checksums, browser fixtures and
inherited trust/booking validators. Their consumers were updated together in the
[active-layout cleanup](../../docs/refactor/active-layout-cleanup.md).
