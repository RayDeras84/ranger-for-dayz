# Contributing

Thanks for helping improve Ranger for DayZ.

## Development

Use PowerShell on Windows and prefer `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run dev
```

Before opening a pull request, run the checks that apply to your change:

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test
```

Some checks may need repository setup work before they pass. If lint or tests cannot run, explain why in the pull request.

## Guidelines

- Keep renderer code free of Node and Electron imports.
- Add or change native capabilities through all IPC layers together: `electron/main.js`, `electron/preload.cjs`, and `src/launcherApi.js`.
- Preserve fallback behavior for missing Steam, missing DayZ executables, unavailable Workshop items, partial installs, and BattleMetrics/API failures.
- Keep UI changes compact and consistent with the existing desktop app style.
- Do not commit generated folders such as `dist/`, `release/`, `.tmp/`, or `node_modules/`.
- Do not commit DayZ game assets, Workshop mod content, or third-party proprietary assets.

## Pull Requests

Good pull requests include:

- A short summary of the change.
- The checks you ran.
- Screenshots for visible UI changes.
- Notes for any Steam, DayZ, or network behavior you could not verify locally.
