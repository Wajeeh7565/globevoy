# Branch inventory

Snapshot: November 6, 2026. Compared with `staging` at `447fba5`. Counts describe commit ancestry, not deployment or feature correctness. No branches were deleted or merged by this cleanup.

| Branch | Behind staging | Ahead of staging | Next action |
| --- | ---: | ---: | --- |
| `feature/cleanup-frontend-backend-audit-20261008` | 9 | 6 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `feature/globevoy-feature-inventory-frontend-tidy-20261008` | 9 | 6 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `feature/gv-dist-709a-claude-mcp-local` | 300 | 17 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `feature/gv-infra-docker-poc-713a` | 9 | 2 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `feature/gv-perf-684b-684a-reuse-diagnostic` | 158 | 5 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `feature/gv-refactor-r2a-validation-results` | 18 | 0 | Fully contained in staging; candidate for branch retirement after PR/owner review |
| `feature/gv-refactor-r2b-audit-scripts` | 16 | 0 | Fully contained in staging; candidate for branch retirement after PR/owner review |
| `feature/gv-refactor-r2c-release-evidence` | 14 | 0 | Fully contained in staging; candidate for branch retirement after PR/owner review |
| `feature/gv-refactor-r2d-historical-validators` | 12 | 0 | Fully contained in staging; candidate for branch retirement after PR/owner review |
| `feature/gv-refactor-r3a-frontend-evidence` | 3 | 0 | Fully contained in staging; candidate for branch retirement after PR/owner review |
| `feature/gv-refactor-r3b1-frontend-tools` | 1 | 0 | Fully contained in staging; candidate for branch retirement after PR/owner review |
| `feature/gv-test-708c-clock-fixture` | 8 | 0 | Fully contained in staging; candidate for branch retirement after PR/owner review |
| `feature/gv-website-parity-classic-20261008` | 11 | 1 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `feature/gv-website-parity-react-20261008` | 11 | 2 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `feature/unified-globevoy-account-design` | 11 | 12 | Keep: divergent history; review diff and equivalent/cherry-picked commits before integration |
| `main` | 689 | 0 | Keep: recorded release baseline; do not delete |
| `staging` | 0 | 0 | Development integration baseline |

## Practical branch workflow

Use `staging` for integrated development, one short-lived task branch for a change, and `main` for the deliberately promoted baseline. Do not create another branch for each audit pass of the same task.

A branch with zero ahead commits is fully reachable from staging at this snapshot. Refresh the remote before any later deletion decision. Divergent branches can include changes already cherry-picked elsewhere; an ahead count alone is not a list of missing features.

The existing frontend cleanup/inventory and account-design branches still have divergent history. They were not bulk-merged into this cleanup. The Docker proof of concept also remains separate. Review their actual diffs before continuing those tasks.

Local release/audit folders outside this checkout are separate from remote branches. They may contain uncommitted work and were not removed. Use this checkout as the clear starting point; inventory old local folders before archiving them.
