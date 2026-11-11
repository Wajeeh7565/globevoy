# Resolve original package paths without changing historical checksum evidence.
function Resolve-GVFrontendPackagePath([string]$RelativePath) {
    $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
    $movedPaths = @{
        'GV-BOOK-686C-CHANGE-ROLLBACK-MANIFEST.md' = 'archive/frontend/release-evidence/GV-BOOK-686C-CHANGE-ROLLBACK-MANIFEST.md'
        'GV-BOOK-686C-CHECKSUMS.sha256' = 'frontend/validation/releases/GV-BOOK-686C-CHECKSUMS.sha256'
        'GV-BOOK-686C-FINAL-REPORT.md' = 'archive/frontend/release-evidence/GV-BOOK-686C-FINAL-REPORT.md'
        'GV-BOOK-686C-VALIDATION-LOG.txt' = 'archive/frontend/release-evidence/GV-BOOK-686C-VALIDATION-LOG.txt'
        'GV-JOURNEY-686B-CHANGE-ROLLBACK-MANIFEST.md' = 'archive/frontend/release-evidence/GV-JOURNEY-686B-CHANGE-ROLLBACK-MANIFEST.md'
        'GV-JOURNEY-686B-CHECKSUMS.sha256' = 'frontend/validation/releases/GV-JOURNEY-686B-CHECKSUMS.sha256'
        'GV-JOURNEY-686B-FINAL-REPORT.md' = 'archive/frontend/release-evidence/GV-JOURNEY-686B-FINAL-REPORT.md'
        'GV-JOURNEY-686B-VALIDATION-LOG.txt' = 'archive/frontend/release-evidence/GV-JOURNEY-686B-VALIDATION-LOG.txt'
        'GV-RC-686D-CHANGED-FILE-HASHES.sha256' = 'frontend/validation/releases/GV-RC-686D-CHANGED-FILE-HASHES.sha256'
        'GV-RC-686D-FINAL-REPORT.md' = 'archive/frontend/release-evidence/GV-RC-686D-FINAL-REPORT.md'
        'GV-RC-686D-LEGAL-COMMERCIAL-GATE.md' = 'frontend/validation/releases/GV-RC-686D-LEGAL-COMMERCIAL-GATE.md'
        'GV-RC-686D-MASTER-VALIDATION-LOG.txt' = 'archive/frontend/release-evidence/GV-RC-686D-MASTER-VALIDATION-LOG.txt'
        'GV-RC-686D-PRODUCTION-DELTA-MANIFEST.md' = 'archive/frontend/release-evidence/GV-RC-686D-PRODUCTION-DELTA-MANIFEST.md'
        'GV-RC-686D-RELEASE.json' = 'frontend/validation/releases/GV-RC-686D-RELEASE.json'
        'GV-RC-686D-ROLLBACK-MANIFEST.md' = 'archive/frontend/release-evidence/GV-RC-686D-ROLLBACK-MANIFEST.md'
        'GV-RC-686D-VALIDATION-ARCHITECTURE.md' = 'archive/frontend/release-evidence/GV-RC-686D-VALIDATION-ARCHITECTURE.md'
        'GV-SHELL-686A-CHANGE-ROLLBACK-MANIFEST.md' = 'archive/frontend/release-evidence/GV-SHELL-686A-CHANGE-ROLLBACK-MANIFEST.md'
        'GV-SHELL-686A-CHECKSUMS.sha256' = 'frontend/validation/releases/GV-SHELL-686A-CHECKSUMS.sha256'
        'GV-SHELL-686A-FINAL-REPORT.md' = 'archive/frontend/release-evidence/GV-SHELL-686A-FINAL-REPORT.md'
        'GV-SHELL-686A-VALIDATION-LOG.txt' = 'archive/frontend/release-evidence/GV-SHELL-686A-VALIDATION-LOG.txt'
        'GV-SHELL-686D-R1-CHANGED-FILE-LIST.md' = 'archive/frontend/release-evidence/GV-SHELL-686D-R1-CHANGED-FILE-LIST.md'
        'GV-SHELL-686D-R1-RELEASE.json' = 'frontend/validation/releases/GV-SHELL-686D-R1-RELEASE.json'
        'GV-SHELL-686D-R1-ROLLBACK-MANIFEST.md' = 'archive/frontend/release-evidence/GV-SHELL-686D-R1-ROLLBACK-MANIFEST.md'
        'GV-SHELL-686D-R1-VALIDATION-REPORT.md' = 'archive/frontend/release-evidence/GV-SHELL-686D-R1-VALIDATION-REPORT.md'
        'Run-GV-RC-686D-Validate.ps1' = 'ops/frontend/validation/Run-GV-RC-686D-Validate.ps1'
        'Run-GV-SHELL-686D-R1-Validate.ps1' = 'ops/frontend/validation/Run-GV-SHELL-686D-R1-Validate.ps1'
        'gv-book-685d-browser-fixture.html' = 'frontend/validation/fixtures/gv-book-685d-browser-fixture.html'
        'gv-book-686c-browser-fixture.html' = 'frontend/validation/fixtures/gv-book-686c-browser-fixture.html'
        'gv-book-686c-partner-fixture.html' = 'frontend/validation/fixtures/gv-book-686c-partner-fixture.html'
        'gv-journey-686b-browser-fixture.html' = 'frontend/validation/fixtures/gv-journey-686b-browser-fixture.html'
        'gv-rc-686d-all-flight-browser-fixture.html' = 'frontend/validation/fixtures/gv-rc-686d-all-flight-browser-fixture.html'
    }
    $key = $RelativePath -replace '\\', '/'
    if ($movedPaths.ContainsKey($key)) { return Join-Path $repositoryRoot $movedPaths[$key] }
    if ($key -match '^[^/\\]+\.html$') { return Join-Path (Join-Path $repositoryRoot 'frontend/pages') $key }
    return Join-Path (Join-Path $repositoryRoot 'frontend') $key
}
