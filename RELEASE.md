# Release Guide

Ranger for DayZ ships Windows builds through GitHub Releases. Do not commit generated files from `dist/` or `release/`.

## Release Assets

The Windows release workflow builds an NSIS installer and uploads the installer/update artifacts to the GitHub Release for the tag.

Release builds use the committed `build/icon.ico`. When changing `public/icon.svg`, run `npm.cmd run prepare-icon` locally and commit the regenerated icon before tagging a release.

Expected assets include:

- `Ranger-for-DayZ-Setup-<version>-x64.exe`
- `Ranger-for-DayZ-Setup-<version>-x64.exe.blockmap`
- `latest.yml`

`latest.yml` and the `.blockmap` file are required for automatic updates.

## Local Packaging

```powershell
npm.cmd install
npm.cmd run package
```

The local installer is written to `%TEMP%\ranger-for-dayz-release` by default. This keeps electron-builder's temporary package folders outside OneDrive-backed project folders, where Windows file indexing/sync can hold short-lived locks.

To choose another local output folder:

```powershell
$env:RFDZ_RELEASE_DIR = "C:\Builds\ranger-for-dayz-release"
npm.cmd run package
```

Local builds are unsigned by default.

To build a portable app for quick testing:

```powershell
npm.cmd run package:portable
```

To build a local NSIS installer that is wired to the GitHub update feed for private-repo update testing:

```powershell
npm.cmd run package:update-test
```

This writes to `%TEMP%\ranger-for-dayz-release` by default and does not upload anything.

## GitHub Release Flow

1. Update `version` in `package.json`.
2. Run verification locally:

   ```powershell
   npm.cmd run build
   npm.cmd run lint
   npm.cmd test
   npm.cmd run package
   ```

3. Commit the version change.
4. Create and push a version tag:

   ```powershell
   git tag v0.0.3
   git push origin main --tags
   ```

5. The GitHub Actions `Release` workflow builds the installer, configures the package metadata from `GITHUB_REPOSITORY`, and uploads draft release assets.
6. Review the draft release notes and publish the release when ready.

Automatic updates read from the published GitHub Release assets. Users only receive a new version after the release is published.

## Auto-Update Test Flow

Automatic update checks only work from packaged Windows installer builds. Vite previews, `npm.cmd start`, and portable/manual builds without update metadata will report that automatic updates are unavailable or will not find a feed.

GitHub draft releases are not visible to the updater. The newer version being tested must be a published GitHub Release with the installer, `.blockmap`, and `latest.yml` assets.

While this repository is private, launch the installed app from a PowerShell session that has a GitHub token with read access to the private repository:

```powershell
$env:GH_TOKEN = "<token>"
& "$env:LOCALAPPDATA\Programs\Ranger for DayZ\Ranger for DayZ.exe"
```

Do not commit or embed this token. Public releases do not need a token once the repository is public.

Recommended test sequence:

1. Build or download an installer for the older version. For private-repo testing before the app is public, prefer `npm.cmd run package:update-test` so the installed app knows to use private GitHub release metadata.
2. Install the older version.
3. Bump `version` in `package.json` and `package-lock.json` to the next version.
4. Commit, tag, and push the new version tag.
5. Let the release workflow create the draft release assets.
6. Publish the new release.
7. Launch the older installed app with `GH_TOKEN` set while the repository is private.
8. In the app, open About, click Check, wait for the download to finish, then click Install.

## Signing

Current release plan: publish unsigned Windows installers so the project can stay cost-free.

Users may see Windows SmartScreen or "Unknown Publisher" warnings when installing a release, especially while the app is new. This is expected for an unsigned Windows app. Release notes should tell users to download installers only from this repository's GitHub Releases page.

Do not use a self-signed certificate for public releases. It would still require users to manually trust the certificate and can make the install path feel less clear.

Possible future no-cost path: apply for SignPath Foundation after the project is public and has enough open-source project context. Paid code signing and Microsoft Trusted Signing are intentionally out of scope for now.
