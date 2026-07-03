# Release Guide

Ranger for DayZ ships Windows builds through GitHub Releases. Do not commit generated files from `dist/` or `release/`.

## Release Assets

The Windows release workflow builds an NSIS installer and uploads the installer/update artifacts to the GitHub Release for the tag.

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

The local installer is written to `release/`. Local builds are unsigned by default.

To build a portable app for quick testing:

```powershell
npm.cmd run package:portable
```

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

5. The GitHub Actions `Release` workflow builds the installer, configures the package metadata from `GITHUB_REPOSITORY`, and publishes draft release assets.
6. Review the draft release notes and publish the release when ready.

Automatic updates read from the published GitHub Release assets. Users only receive a new version after the release is published.

## Signing

Unsigned builds work, but Windows may show SmartScreen or "Unknown Publisher" warnings. Signed releases are strongly preferred before broad public distribution.

The current workflow supports traditional Windows code signing when these repository secrets are configured:

- `WIN_CSC_LINK`: a path, URL, or base64 value for the signing certificate.
- `WIN_CSC_KEY_PASSWORD`: the certificate password.

The workflow passes the same values as `CSC_LINK` and `CSC_KEY_PASSWORD` for electron-builder compatibility. When both secrets exist, it runs `npm.cmd run release:signed`; otherwise it publishes an unsigned draft build.

Do not commit certificates, passwords, or signing tokens to the repository.

Azure Trusted Signing is another good option, especially for CI, but it requires a Microsoft signing account and additional electron-builder `win.azureSignOptions` configuration.
