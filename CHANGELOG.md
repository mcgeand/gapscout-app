# Changelog

## [0.9.0] - 2026-10-05

First release candidate. Local-first SIPOC mapping and gap analysis, stored in SQLite on the machine that runs the app.

### Added

- Projects, with a current or future state kept separate from the name
- SIPOC wizard, Discovery grid, and a diagram laid out by team
- Gaps against steps, including a Jira ticket link
- Teams, systems, policies and glossary
- Export to a Markdown pack, CSV registers, PNG and SVG
- Search across the open project
- macOS universal DMG and Windows MSI and NSIS installers, built by the release workflow and attached to a draft release

### Fixed

- A SIPOC customer is handed to the nearest later supplier, not to every later step
- Digits inside a Jira project key are kept
- Search-index rows are removed after the record delete commits
- A project's timestamp moves when its contents change

### Known limits

- The macOS build is ad-hoc signed. Gatekeeper blocks a downloaded copy.
- The Windows installers are unsigned. SmartScreen warns on first run.
- There is no in-app backup yet. Copy `gapscout.db` from the `.gapscout` folder in your home directory.
