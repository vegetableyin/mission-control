# Local project inventory acceptance — 2026-07-22

## Environment

- Windows 11
- Node.js 22.23.1
- Production server: `http://127.0.0.1:3100`
- Scan root: `D:\Work`
- Scan depth: 2

## Result

The production UI discovered 28 local project candidates before import. One project, `视频自动生成字幕+字幕整理`, was explicitly imported for acceptance, leaving 27 candidates pending. No candidate was imported automatically.

The imported project was scanned through the UI. The scan reported branch `master`, a local HEAD and last commit, 173 working-tree changes, no configured origin, and no locally available ahead/behind reference. Its deterministic health result was `healthy` with a score of 100 after the next action was recorded.

The following interactions passed in the production UI:

- discover `D:\Work` candidates;
- import one selected candidate;
- scan the registered project;
- inspect Git and health details;
- edit the next action;
- disable and re-enable scanning;
- archive and restore the project;
- render dark and light desktop views;
- render the project card on a mobile viewport;
- show the registered project on the Essential dashboard.

The acceptance browser captured no uncaught page errors, console errors, or API responses with status 500. The scanner did not write to, execute, test, or otherwise modify any discovered project.

## Candidate examples

The pending list includes `A股杜邦分析-数据`, `A股估值分析 AI Agent`, `hara`, `Pixelle-Video`, `PostFlow`, `火柴人僵尸算术`, and other real directory names. Names are displayed exactly as discovered and can be edited after a user confirms import.

## Screenshots

- `docs/screenshots/project-inventory/01-work-candidates-dark.png`
- `docs/screenshots/project-inventory/02-inventory-desktop-dark.png`
- `docs/screenshots/project-inventory/03-project-detail-health-dark.png`
- `docs/screenshots/project-inventory/04-inventory-desktop-light.png`
- `docs/screenshots/project-inventory/05-inventory-mobile-light.png`
- `docs/screenshots/project-inventory/06-dashboard-project-metrics-dark.png`

Screenshots were reviewed and contain no password, API key, token, cookie, or credential content.
