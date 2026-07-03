# Security Policy

Ranger for DayZ is a local desktop app that opens external URLs, launches DayZ, queries public servers, and talks to Steam/Steam Workshop through the local Steam client.

## Reporting A Vulnerability

If this repository has GitHub private vulnerability reporting enabled, please use that. Otherwise, contact the maintainer privately when possible before publishing details.

If no private channel exists yet, open a GitHub issue with a short non-exploitative summary and ask for a private follow-up channel.

## Sensitive Areas

Please be especially careful with changes involving:

- `shell.openExternal` and external URL handling.
- Launch argument construction for DayZ executables.
- Filesystem deletion or mod cleanup paths.
- Steamworks calls and Workshop subscription changes.
- IPC methods exposed through `electron/preload.cjs`.

Do not include personal Steam data, local filesystem paths from other users, access tokens, cookies, or proprietary game/mod files in public issues.
