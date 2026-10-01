# Contributing

## Development

If you have been assigned to fix an issue or develop a new feature, please follow these steps to get started:

- Fork this repository.
- Install dependencies and watch for changes during development:

  ```sh
  pnpm install
  pnpm dev
  ```

- Implement your changes and tests to files in the `src/` directory of the relevant project(s) and their corresponding test files.
  - If your changes are to the packages in this monorepo, you'll find them in the `packages/` directory.
  - If your changes are to the examples, you'll find them in the `examples/` directory.
- Run the CI checks locally to ensure everything is passing:

  ```sh
  pnpm test:pr
  ```

- Git stage your required changes and commit (see below commit guidelines).
- Submit PR for review.

## Releases

Package releases are managed with [Changesets](https://changesets.dev) v3 and GitHub Actions trusted publishing.

- Create a changeset for any user-facing package change:

  ```sh
  pnpm changeset
  ```

- Changesets maintains a separate `CHANGELOG.md` for each published package. Private packages (`@nozzleio/test-support` and the example apps) are never versioned or published.
- The Changeset Status workflow comments on each PR with the changesets it adds, or a link to add one. It does not block merging.
- On every push to `main`, the release workflow (`.github/workflows/release.yml`) runs the CI checks and then does one of two things:
  - **Version:** while unreleased changesets exist, it opens or updates the `ci: version packages` PR.
  - **Publish:** once that PR is merged, it publishes the package tarballs packed from the CI job's build to npm, then pushes git tags and creates GitHub releases. Only this job gets `id-token: write`, and it does not build anything.
- Publishing uses npm trusted publishing (GitHub Actions OIDC) through pnpm's native `publish`, so no npm token is needed. The `packageManager` pnpm version must stay on `11.1.3` or newer.
- npm trusted publishers should reference `.github/workflows/release.yml` with no GitHub environment.

This project is friendly towards contributors using AI tools to assist in code generation and improvements. If you are using AI assisted tooling, please point it to the [AGENTS.md](./AGENTS.md) file for guidelines on code style, testing, and overall development workflow.

### Commit Guidelines

This project uses conventional commits. See https://www.conventionalcommits.org/ for more details.

Your commit messages should be structured as follows:

```txt
<type>[optional scope]: <description>
[optional body]
[optional footer(s)]
```

If you are an AI agent, the use of the commit body is required.

These are the commonly used types.

- feat: a new feature
- fix: a bug fix
- docs: documentation only changes
- style: changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- refactor: a code change that neither fixes a bug nor adds a feature
- perf: a code change that improves performance
- test: adding missing tests or correcting existing tests
- chore: changes to the build process or auxiliary tools and libraries such as documentation generation

The above list is not exhaustive. Other types can be used as appropriate.

The scope is optional and can be anything specifying the place of the commit change. For this monorepo, try to use the package name, `examples`, or `root`, as the scope when applicable.

- `feat(table-core): add new sorting feature`
- `fix(examples): correct typo in README`
- `docs(root): update contributing guidelines`

### Running examples

The examples for this monorepo are located in the `examples/` directory. These examples are divided into subdirectories based on the framework used (e.g., React, Vue, Svelte).

To run an example, navigate to the desired example directory and follow the instructions in its README file. Most examples can be started with the following commands:

```sh
cd examples/<framework>/<example-name>
pnpm dev
```

Replace `<framework>` and `<example-name>` with the appropriate values for the example you wish to run.
