# Contributing

Issues and pull requests are welcome. A pull request needs a passing CI run (`validate` and `test`, on Linux and on Windows) and the maintainer's review before it is merged. On your first pull request, CI starts once the maintainer lets it run. Leave the version in `.claude-plugin/plugin.json` as it is: the maintainer's next release bumps it.

## Develop

```sh
python3 scripts/check_rules.py
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`--plugin-dir` loads the plugin from this folder for one session and reloads it on save. The tests use the engine's own test kit and need no account.

For a type check, Claude Code has to write its types to `.claude-plugin/types/` first, which it does when a session loads the plugin. One command does both, the session ending on the timeout once the types are written:

```sh
timeout 45 script -qec "claude --plugin-dir ." /dev/null </dev/null
npx -p typescript@5.9.3 tsc -p .
```

## Code

How the code is laid out, written, tested and released, with a checklist for reviews: [docs/guidelines.md](docs/guidelines.md).

## Release

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:` and so on. CI checks both.

Note what changes for users under `## Unreleased` at the top of `CHANGELOG.md`. CI works out the version from the commits since the last tag (`fix:`, `refactor:` and `perf:` bump the patch version, `feat:` and breaking changes the minor one, and `docs:`, `test:` or `ci:` alone release nothing) and commits the bump to the pull request: the version in `.claude-plugin/plugin.json`, and the number and date in place of `Unreleased`. A pull request from a fork gets no bump; the maintainer's next release counts its commits. Pull your branch before pushing to it again. Once the pull request is merged, the Release workflow tags `vX.Y.Z` and publishes a GitHub release with that section.
