# Changesets

This repository uses Changesets to manage package versions, package-specific changelogs, and npm releases.

## Creating a release note

Run the following command after changing a publishable package:

```sh
pnpm changeset
```

Choose the affected package or packages, select the semver bump, and write a short summary. Changesets will update the matching `CHANGELOG.md` files during the version step.

## Releasing

On every push to `main`, the release workflow runs the CI checks and then either:

- opens or updates the `ci: version packages` pull request while unreleased changesets exist, or
- publishes the already-versioned packages to npm once that pull request is merged, using tarballs packed from the CI job's build, and then creates git tags and GitHub releases.

Private packages are not versioned or published. Trusted publishing is configured in npm for the GitHub Actions release workflow, so no long-lived npm token is required once trust is attached to each package.
