# Changesets

This repository uses Changesets to manage package versions, package-specific changelogs, and npm releases.

## Creating a release note

Run the following command after changing a publishable package:

```sh
pnpm changeset
```

Choose the affected package or packages, select the semver bump, and write a short summary. Changesets will update the matching `CHANGELOG.md` files during the version step.

## Releasing

The release workflow uses Changesets to either:

- open or update a versioning pull request on `main`, or
- publish already-versioned packages from `main`

Trusted publishing is configured in npm for the GitHub Actions release workflow, so no long-lived npm token is required once trust is attached to each package.
