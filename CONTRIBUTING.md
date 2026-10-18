# Contributing

Issues and pull requests are welcome. Pull requests need a passing CI run (`validate` and `test`) before they can be merged.

## Develop

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`--plugin-dir` loads the plugin from this folder for one session and reloads it on save. The tests use the engine's own test kit and need no account.

For a type check, start a session with the plugin loaded once, so Claude Code writes its types to `.claude-plugin/types/`, then run `npx -p typescript@5.9.3 tsc -p .`.

## Code

How the code is laid out, written, tested and released, with a checklist for reviews: [docs/guidelines.md](docs/guidelines.md).

## Release

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:` and so on. CI checks both.

Note what changes for users under `## Unreleased` at the top of `CHANGELOG.md`. CI works out the version from the commits since the last tag (`fix:`, `refactor:` and `perf:` bump the patch version, `feat:` and breaking changes the minor one, and `docs:`, `test:` or `ci:` alone release nothing) and commits the bump to the pull request: the version in `.claude-plugin/plugin.json`, and the number and date in place of `Unreleased`. Pull your branch before pushing to it again. Once the pull request is merged, the Release workflow tags `vX.Y.Z` and publishes a GitHub release with that section.
