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

### Commit Guidelines

This project uses conventional commits. See https://www.conventionalcommits.org/ for more details.

Your commit messages should be structured as follows:

```txt
<type>[optional scope]: <description>
[optional body]
[optional footer(s)]
```

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
