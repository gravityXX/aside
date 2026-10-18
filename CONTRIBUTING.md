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
- `tests/queue.test.tsx` - the tests, one `describe` per area.
- `assets/make_svgs.py` - draws the step pictures in the README, light and dark: `python3 assets/make_svgs.py`.

## Release

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:` and so on. CI checks both.

Before opening a pull request that changes what users get, run `uvx --from commitizen cz bump --files-only`. It bumps the version in `.claude-plugin/plugin.json` from the commits since the last tag. Then note the change under that version in `CHANGELOG.md`. Once the pull request is merged, the Release workflow tags `vX.Y.Z` and publishes a GitHub release with that section.
