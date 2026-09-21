# macOS support sprint

## Tasks

- [x] Make native packaging inputs deterministic and verify generated assets, executable bits, and LF line endings.
- [x] Fix bundled CLI resolution for macOS app bundles and retain Linux compatibility with fixture tests.
- [x] Add categorized, actionable startup diagnostics with safe machine-readable logging and regression tests.
- [ ] Qualify macOS DMG/ZIP install, packaged lifecycle, persistence, and uninstall cleanup on the native runner.
- [ ] Run final build and relevant release checks, then push the sprint commits.

## Hiccups & Notes

- macOS signing was unavailable because the machine has no valid Developer ID Application identity. Artifacts remain unsigned previews; signing/notarization is outside this local sprint.
- The current runner is macOS arm64, so Intel qualification remains pending.

## Final notes

This sprint stops before any support claim changes. macOS remains an unsigned preview until the native signing, clean-machine, upgrade, uninstall, and architecture gates pass.
