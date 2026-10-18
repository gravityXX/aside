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

`hooks/` is built in layers. A file imports from its own layer or the ones below it, never from above, and no files import each other in a circle:

- `hooks/register.tsx` - every hook the plugin has, each handing its event to the module that does the work.
- `hooks/ui/` - what the person sees: the band above the prompt, the list pane, the framed `/aside` output.
- `hooks/features/` - what the plugin does: `capture` (a typed `+` to a stored entry), `queue` (the listing and the commands on entries), `plan` (handing the queue over, the steps), `commands` (`/aside`, its help and Tab).
- `hooks/context.ts` - the settings and the session's state, made once per load and passed to the hooks.
- `hooks/io/` - the only files that reach the engine's store and the machine: `store` and `host`.
- `hooks/core/` - plain functions on text, with no `$`: entries, markdown, the listing, the prompts.

- `tests/` - the tests, one file per area of what the plugin does: `typing`, `comments`, `commands`, `plan` and `ui`, plus `matching` for the rules that find a fragment, a heading or a tag in a file. `tests/world.tsx` sets up the machine beneath the plugin and the helpers the tests act through.
- `assets/make_svgs.py` - draws the step pictures in the README, light and dark: `python3 assets/make_svgs.py`.

Two rules of the engine shape the code: outside `register.tsx`, a function that takes `$` is a `function` declaration, and an atom is read only in the file that makes it, `io/store.ts`. `claude plugin validate` says when either is broken.

## Release

Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:` and so on. CI checks both.

Note what changes for users under `## Unreleased` at the top of `CHANGELOG.md`. CI works out the version from the commits since the last tag (`fix:` bumps the patch version, `feat:` and breaking changes the minor one) and commits the bump to the pull request: the version in `.claude-plugin/plugin.json`, and the number and date in place of `Unreleased`. Pull your branch before pushing to it again. Once the pull request is merged, the Release workflow tags `vX.Y.Z` and publishes a GitHub release with that section.
