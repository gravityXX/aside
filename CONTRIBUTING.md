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

Note a change under a new version in `CHANGELOG.md` and bump the version in `.claude-plugin/plugin.json`.
