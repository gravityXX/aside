# Contributing

Issues and pull requests are welcome. Pull requests need a passing CI run (`validate` and `test`) before they can be merged.

## Develop

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`--plugin-dir` loads the plugin from this folder for one session and reloads it on save. The tests use the engine's own test kit and need no account.

For a type check, start a session with the plugin loaded once, so Claude Code writes its types to `.claude-plugin/types/`, then run `npx -p typescript tsc -p .`.

## Layout

- `hooks/queue.ts` - the pure logic: parsing `+` messages, finding a copied fragment in a file, the prompts.
- `hooks/register.tsx` - the hooks: capture, the `/aside` command, plan and run, the band above the prompt.
- `tests/` - the tests, one file per area of what the plugin does: `typing`, `comments`, `commands`, `plan` and `ui`, plus `matching` for the rules that find a fragment, a heading or a tag in a file. `tests/world.tsx` sets up the machine beneath the plugin and the helpers the tests act through.
- `assets/make_svgs.py` - draws the step pictures in the README, light and dark: `python3 assets/make_svgs.py`.

## Release

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:` and so on. CI checks both.

Note what changes for users under `## Unreleased` at the top of `CHANGELOG.md`. CI works out the version from the commits since the last tag (`fix:` bumps the patch version, `feat:` and breaking changes the minor one) and commits the bump to the pull request: the version in `.claude-plugin/plugin.json`, and the number and date in place of `Unreleased`. Pull your branch before pushing to it again. Once the pull request is merged, the Release workflow tags `vX.Y.Z` and publishes a GitHub release with that section.
