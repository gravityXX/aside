# Guidelines

How the code in this repository is designed, written, tested and released. Read it before implementing a change, changing the architecture or reviewing one. How to run things is in [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Using this file

1. A rule holds always. A rule that starts with **Prefer** holds unless the code around it has a reason not to.
2. Breaking a rule needs a comment at that spot saying why.
3. A review cites a rule by its number, such as 3.4.
4. When the code and this file disagree, fix one of them in the same pull request. A new rule comes with its reason.

## 2. Architecture

### Layers

`hooks/` is built in layers. A file imports from its own layer or the ones below it, never from above:

- **`hooks/register.tsx`** - every hook the plugin has, each handing its event to the function that does the work.
- **`hooks/ui/`** - what the person sees: the band above the prompt (`band`), the list pane (`pane`), the framed `/aside` output (`output`) and the rows they share (`rows`).
- **`hooks/features/`** - what the plugin does: `capture` (a typed `+` to a stored entry), `queue` (the listing and the commands on entries), `plan` (handing the queue over, the steps), `background` (the work a step's turn leaves going), `global` (the global list and the named queues: ideas for no project), `history` (the log of plans run to their end), `find` (`/aside find`), `importing` (`/aside import`) and `commands` (`/aside`, its help and Tab). Within the layer `commands` imports the others, `plan` imports `queue` and `history`, `background` imports nothing of it, `find` and `history` import `queue`, and `global` imports `capture`, `importing` and `queue`. The list pane (`ui/pane.tsx`) lists what `queue`, `global`, `find` and `history` give it.
- **`hooks/context.ts`** - the settings and the session's state, made once per load and passed to the hooks.
- **`hooks/io/`** - the only files that reach the engine's store and the machine: `store`, `queue` (the project queue's changes, one after another, and the take undo brings back), `plan` (the plan's changes, on a chain of their own) and `host`.
- **`hooks/core/`** - plain functions with no `$`: `text`, `markdown`, `entries`, `listing`, `prompts`, `serial` (one chain of work that must not overlap) and `step`, which reads the step running from the flags the store keeps and writes it back, and is the only file that knows both shapes.
- **`types/index.d.ts`** - the shapes of the stored data and the `PluginState` contract. Any layer imports types from it.

1. No files import each other in a circle, within a layer or across layers.
2. `core/` never imports from another layer and never receives `$`.
3. Only `io/` calls `$.store`, `$.fs`, `$.process` and `$.env`. Features call `io/` functions instead.

### Where a new thing goes

| It is | It goes to |
| --- | --- |
| Text in, text out: parsing, formatting, prompts | `core/` |
| Reading or writing the store, files, processes, the clipboard | `io/` |
| Something the plugin does, built from `core/` and `io/` | `features/`, in the file of its area |
| Something drawn: band, pane, frame | `ui/` |
| A new hook | One line in `register.tsx` that hands off to `features/` or `ui/` |
| A command | A row in `COMMANDS` and a `case` in `runCommand` |
| A setting | `userConfig` in `plugin.json`, read once in `createContext` |

4. **Prefer** a file of its own once an area passes about 400 lines, split by what the code does, not by kind of code.

### State

Each value lives where its lifetime fits:

- **`ctx.session`** - this load only: the turn, the clipboard reader, the plan's chained changes. A reload starts it over, so nothing in it may need to outlast one. The project queue's chain has the same lifetime but lives in `io/queue.ts`, as a module variable beside the queue it orders.
- **Atoms** (`band`, `files` in `io/store.ts`) - values a drawing reads. They last the session, survive a reload, and a write redraws every drawing that read them.
- **`$.store`** - the queue, the plan and what undo brings back. It lasts across sessions and every session on the machine shares it.

5. Store keys are made per project root by `projectKeys`; never a bare key. The one exception is the global list and the named queues, ideas outside a project's own queue: one key per idea, under `GLOBAL_IDEA` for the global list and `named:<name>:idea:` for any other queue, or `local:<scope>:<name>:idea:` for one of a single project, its scope a hash of the root, in `io/store.ts`, so sessions in different projects add and take them without writing over each other's, and a session's records for them (`global:editing:`, `cleared:<name>:`, or `cleared:local:<scope>:<name>:` for a local queue), named by the session.
6. What belongs to one session names it, since the store is shared (`Plan.active.sessionId`).
7. Stored data from the last release must still load. A new field is optional; renaming or removing one needs code that reads the old shape.
8. A flag in stored data is `isX?: true`, left out when false.
9. Changes that may overlap go one after another. The project queue is changed through `changeQueue` in `io/queue.ts`, which reads the stored list inside its chain and resolves once the change is written, so two quick entries never overwrite each other and what is read next holds the change. The takes undo brings back (hand-over, run, clear, plan) and the give-backs run on the same chain and read the queue inside it, and so do remove, move, edit, pop and the moves to and from another queue. Features never hold the queue's key: they read the queue through `readQueue`, only to list, count or check it, and only `io/queue.ts` stores it. Slow work that must keep that order, such as git or the clipboard for a typed entry, goes into `changeQueueAfter`'s first step, which runs before the change joins the chain, so the list is never held across it and a hand-over never waits on it. The plan is changed the same way through `changePlan`, so a step that ends and a planner that adds steps never save over each other. A change never waits for another one, on either chain, which would wait for it.
10. The step running is one state, not a set of marks: `StepState` in `types/index.d.ts`, a union of string literals (4.5), each state carrying only the fields it can have. `hooks/core/step.ts` holds both it and `StoredActive`, the flags the store keeps; `loadPlan` reads one into the other and `savePlan` writes it back, so the record itself does not change (2.7). Every writer builds its next state through `stepState`, which lays the keys out in one order: two plans that differ only in key order would make `changePlan` write when nothing moved and `savePlanSteps` drop a planner's whole save.

## 3. The engine

The plugin runs on the Claude Code plugin API: hooks `($, e, next)` added with `on()`, and `$` as the only way out of the module (no DOM, no Node).

### Rules the engine enforces when it loads the module

The engine bundles the hooks module and follows `$` statically from each hook into the functions
it calls, so it refuses to load the module at all when one of these is broken. Its words for it
are `$ itself is passed as an argument (bound, passed, spread, returned or read)` and `$ is
passed to "f", a name bound to a function expression`.

`claude plugin validate .` does **not** catch any of these: it passes a module the engine will
refuse. `claude plugin test .` is where it shows, as every test failing to load the module.

1. Outside `register.tsx`, a function that takes `$` is a `function` declaration called by name. An arrow function or a function expression is refused, even when the caller is in the same file.
2. `$` is never passed to a method or property call (`rows[0].run($)`, `obj.read($)`). A table holds data only, and a `switch` calls the functions.
3. A closure that captures `$` is fine: `$.clock.after(50, () => f($))`, `onPress={() => void g($)}`.
4. The hook given to `on()` is a function literal or the name of a function declaration, never a call that returns one. The pattern is `on('x', ($, e, next) => handler(ctx, $, e, next))`. A second hook on the same event needs a matcher, as the second `prompt.submit` has.
5. A matcher value is a literal written in `register.tsx`. An imported constant shows as `?` in the validator's scan.
6. An atom is read and updated only in the file that makes it. Other files call the functions that file exports, such as `readBand($)`.

### Engine behaviour to design around

7. A reload runs `register` and `session.start` again: module variables and `ctx` start over, `$.store` and atoms stay.
8. A hook that holds the turn (a command, a turn's end) cannot submit a prompt. Submit from a timer, as `submitLater` does.
9. Claude Code prints a command's text only after the running turn ends. What must show mid-turn goes to `$.ui.log` or a pane, which both show at once.
10. A tool's full name depends on where the plugin was loaded from. Use the name `$.tool.register` returns, never a hard-coded `mcp__aside__...`.
11. A `ui.render` hook draws only the surfaces aside supports (`isDrawnOn(e.surface)` in `hooks/ui/rows.tsx`: the terminal and Desktop) and returns `next(e)` for the rest. A drawing test loops over those surfaces, and checks one the engine keeps.
12. Handlers outside `register.tsx` take their types from the engine's: `type Submit = Parameters<Hook<'prompt.submit'>>`, then `e: Submit[1]` and `next: Submit[2]`; `MatchedHook<...>` for a matched hook, `CatchHandler<...>` for `.catch`.
13. Claude Code writes the types to `.claude-plugin/types/` when a session loads the plugin. Load it once after a Claude Code update before type-checking.
14. `<>` draws a column Box around its children, so a fragment inside a row starts a new line. Elements that stand side by side go into the row directly, each one conditional on its own.
15. A pane opens at any width only while the person's press, command or prompt that asked for it lasts. A button that opens a pane returns its promise from `onPress` rather than voiding it, or the open comes after the press has ended and waits undrawn below 144 columns (seen on a 125-column terminal).
16. Work that waits on a long call (a model, a timer) while the person keeps typing reads what it was given first and saves only if that is still there, unchanged; otherwise it saves nothing and says so. What may move on meanwhile by design, as the steps of a running plan a planner adds to, is checked for what it is (the same steps), not for where it stands. One such call runs at a time (`planOutside`).
17. Several sessions share the store. Data more than one session writes at once gets a key per item rather than one list read and written back (the global list), and a command that moves data between two keys writes the place it goes first, so a failure between the writes leaves it in both, and running it again adds nothing twice.
18. An SDK host (`claude -p`, Claude Code Desktop) stamps prompts with origin `sdk`; aside queues only `composer` and `bridge` prompts. Installed plugins' hooks modules load only where the account's rollout switch is on, which a signed-out machine may keep off.

## 4. TypeScript

### Types

1. `strict` and `noUncheckedIndexedAccess` stay on.
2. No `any`. What comes from outside is `unknown` and narrowed, as `parseSteps` does with a tool's input.
3. `!` only where the line before guarantees the value: a length check, a group the pattern must have matched.
4. `type`, not `interface`. The one exception is `PluginState`, which the engine's module declaration extends.
5. A closed set of values is a union of string literals (`Kind`, `StepMode`, `Name`), never a bare `string`.
6. **Prefer** a `switch` that covers every member of the union, so TypeScript flags a new member nobody handles.
7. Inputs are `readonly`. A function returns a new array or object rather than changing the one it was given; a value loaded to be saved back is the exception.
8. Optional settings and fields are read once, at the edge, into typed values (`createContext`, `parseEntries`), not checked again further in.

### Async and errors

9. Every promise is awaited or returned. A deliberate fire-and-forget is written `void f()`, as most buttons do; one that opens a pane returns it (3.15).
10. An engine call that may fail is caught where it is made and turned into `undefined`, `false` or a sentence for the person (`tryReadFile`, `.catch(() => undefined)`). No error reaches the person as a stack.
11. Time comes from `$.clock` (`now`, `after`), never `Date` or `setTimeout`, so tests can drive it.

### Names

12. A boolean reads as a question: `isRunning`, `isOwnTurn`, `isPinned`, `canPlan`.
13. A function is named for what it does for the person: `popEntry`, `handOverQueue`, `refreshBand`. `tryX` returns `undefined` when it fails.
14. A constant that holds fixed data is `UPPER_CASE`: `KINDS`, `STEP_MARKER`, `LIST_PANE`.
15. The product's words mean one thing everywhere: an **entry** is an **idea** or a **comment**; a **tag** is a `<!-- ? -->` comment in a file; the **queue** holds entries; the **global list** holds ideas that belong to no project, and so does a **named queue** (`@work`) for every project, the global list being the one named `global`, while a named queue may instead be one project's alone (`/aside q work local`); a **plan** has **steps**; entries are **handed over** and steps **run**.

### Style

16. As in the files: two spaces, single quotes, no semicolons, trailing commas in multi-line literals. There is no formatter, so match the file.
17. `import type` for types. Imports in groups: the engine, then `types/`, then the repository's files by layer.
18. **Prefer** early returns over nested `if`, and a blank line before the closing `return` of a longer function.
19. A pure helper that takes no `$` may be an arrow constant. A function that takes `$` follows 3.1.

### Comments

20. A comment is a full sentence above a type, a field, a constant or a function: what it is, or why it is so.
21. It says what the code cannot: an engine limit, a race it avoids, a reason the simpler way fails. Never what the next line plainly does.
22. A changed line comes with its comment changed, so no comment goes stale.

## 5. What the person reads

1. A command returns one short sentence, or the listing. It says what happened and, when it helps, what comes next ("/aside run continues.").
2. A command's outcome is its returned text. Something that happens outside a command (a step ends, a band button) is a toast. A queued entry is a line in the transcript (`$.ui.log`), so it stays in the history.
3. Numbers are the ones `/aside` shows, counted from 1 in the order setting.
4. Counts go through `formatCount`: `1 idea`, `2 ideas`.
5. A refusal says why and what would be accepted.
6. The text is plain English. A hyphen, never an em or en dash.
7. A prompt the plugin writes for Claude (`core/prompts.ts`) says that the plugin sent it (`STEP_MARKER`, `COMPOSED_BY`) and tells Claude exactly what to do in this step. A change to a prompt is tested on its full text.

## 6. Tests

1. Tests run with `claude plugin test .` and the engine's kit, `claude-code/testing`. No other runner or library.
2. A test checks what the person or Claude can see: what `/aside` shows (`shown()`), the prompts sent (`sent`), the toasts, the transcript lines (`logged`), the prompt box (`filled`), the panes. Never internal functions or store keys.
3. The exceptions are `matching.test.ts` and `step.test.ts`: the rules in `core/` that find a fragment, a heading or a tag, and those that read the step running from the marks the store keeps and write them back, hold over every case the store can hold rather than over something the person sees, so they are tested directly and over the whole table of them.
4. A test acts through the helpers of `world()`: `type`, `queue`, `aside`, `startTurn`, `answer`, `pressBand`. A helper two files need belongs in `tests/world.tsx`.
5. The machine beneath the plugin (files, clipboard, branch, system, a narrow terminal, a hook that drops prompts) is set through `Machine`. The plugin's own files are never mocked.
6. Time moves only through `clock` and `idle()`; no real waits.
7. A test's name is a sentence about one behaviour, such as "a queued entry never reaches Claude and leaves a line in the transcript, not a toast". It may check several things that make up that behaviour.
8. A test lives in the file of its area: `typing`, `comments`, `commands`, `plan`, `planner`, `background`, `log`, `steplines`, `global`, `ui`, `matching`, `step`. A new area gets a new file.
9. Every `feat:` comes with tests of what it adds. Every `fix:` comes with a test that fails without the fix.
10. **Prefer** exact expectations (`toEqual` on the whole listing) over `toContain`, so a stray line fails the test.

## 7. Commits, versions and CI

### Commits

1. Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org): a type, then a short lower-case subject with no full stop, such as `fix: let undo bring back the tags a hand-over took`. CI checks both with `cz check`.
2. The type is chosen by what changes for users, knowing the release Commitizen makes of it:

| Type | Release | For |
| --- | --- | --- |
| `feat:` | minor | something new users can do or see |
| `fix:` | patch | a bug users hit |
| `refactor:`, `perf:` | patch | the code or its speed, same behaviour |
| `docs:`, `test:`, `ci:`, `build:`, `style:`, `chore:` | none | docs, tests, CI, tooling |
| `type!:` | minor while 0.x, then major | a break in what users rely on: commands, options, stored data |

3. One change per commit. A pull request releases at the strongest type among its commits.
4. Nobody writes the version by hand, neither in `plugin.json` nor in a CHANGELOG heading. The CI bot does it in the pull request.

### CHANGELOG

5. A pull request that releases notes what changes for users under `## Unreleased` at the top of `CHANGELOG.md`. CI refuses it otherwise.
6. A note says what the person can now do, or what no longer goes wrong, in their words, not the code's. A `refactor:` says in one line that nothing changes in use.

### CI and versions

7. CI runs `cz check`, the bump, `claude plugin validate .` and `claude plugin test .`. After the merge, the Release workflow tags `vX.Y.Z` and publishes a GitHub release with that section.
8. Tool versions in CI are pinned (Commitizen, Claude Code, actions by major). Raising one is a `ci:` commit of its own.
9. CI cannot type-check, since the types are written only when a session loads the plugin (3.13). Run `tsc` before opening a pull request.
10. The version stays 0.x while commands and stored data still change (`major_version_zero` in `.cz.toml`). 1.0.0 comes from one pull request that sets it to `false` and has a `!` commit.

## 8. The Python scripts

`assets/make_svgs.py` draws every picture in the README, the timeline and the steps, and those in `docs/use-cases.md`, light and dark. `scripts/check_rules.py` checks that the rule numbers in this file hold together: that each section runs 1, 2, 3 with none skipped or used twice, and that every rule the code, the tests and the docs cite exists. CI runs it, since nothing else keeps a citation honest when a rule is inserted.

1. Python 3.12 or newer, the standard library only. Each runs from the repository root: `python3 assets/make_svgs.py`, `python3 scripts/check_rules.py`.
2. They are formatted with `uvx ruff@0.17.1 format --line-length 120 assets scripts`, linted with `uvx ruff@0.17.1 check assets scripts` and typed so that `uvx mypy@2.4.0 --strict assets/make_svgs.py scripts/check_rules.py` passes.
3. Colours live in `THEMES`: a light and a dark set with the same keys. Layout numbers are named constants (`W`, `ROW`, `PAD`).
4. The SVGs are its output. Change the script, run it and commit both; never edit an SVG by hand.
5. Every picture comes in light and dark and has an `aria-label` that says what it shows.

## 9. Review checklist

1. Is each change in its layer, with imports only downwards and no circle? (2.1 to 2.3)
2. Do `claude plugin validate .` and `claude plugin test .` both pass, and is `$` passed as 3.1 to 3.6 allow? Only the tests catch a `$` the engine will not follow.
3. Are the types tight: no `any`, no unguarded `!`, unions for closed sets? (4.1 to 4.6)
4. Is every promise awaited or voided on purpose, and every engine failure caught? (4.9, 4.10)
5. Is new state in the place its lifetime needs, and does stored data from the last release still load? (2.5 to 2.10)
6. Does the person get a short, true sentence for every outcome, failures included? (5)
7. Do the tests check visible behaviour, and does each fix have a test that fails without it? (6)
8. Do the comments say why, and are they still true? (4.20 to 4.22)
9. Do the commit types and the CHANGELOG note match the release they make? (7)
10. Are the README, `/aside help`, the Tab hints and `docs/use-cases.md` updated when a command or what it does changes?
11. Do the pictures still match the README, `docs/use-cases.md` and the plugin's behaviour, and do the rule numbers still hold together? (8)
12. Have the checks run, with their real output?

```sh
python3 scripts/check_rules.py
claude plugin validate .
claude plugin test .
npx -p typescript@5.9.3 tsc -p .
# when a Python script changed
uvx ruff@0.17.1 format --check --line-length 120 assets scripts && uvx ruff@0.17.1 check assets scripts && uvx mypy@2.4.0 --strict assets/make_svgs.py scripts/check_rules.py
```

## 10. Decisions

Settled choices, with their reason, so they are not reopened by accident:

1. **TypeScript** - the engine loads TypeScript and TSX as they are and describes its whole API in types, so mistakes against it show while writing.
2. **No build step, no npm dependencies** - the engine runs the source directly; there is nothing to install or bundle.
3. **Layers** (0.10.1) - `register.tsx` reads as the list of hooks, `core/` is pure and easy to test, and `io/` is the only door to the machine.
4. **Tests of behaviour** (0.10.1) - they survive a refactor, where the earlier tests of internals broke with it.
5. **Commitizen in CI** - the version follows from the commits, and the bot bumps it in the pull request, never on `main`.
6. **0.x** - commands and stored data still change; 1.0.0 waits until they settle (7.10).
7. **The step's state as a union, read at the store's edge** (0.37.2) - the marks a release stores stay as they are, so a session of an earlier one on the same machine reads the record unchanged (2.6, 3.17), while the features switch over one closed set and TypeScript flags a state nobody handled (4.6). Deriving the state on load, rather than storing it, keeps that out of 2.7's way for good.
8. **A record any 0.x release wrote is read, not migrated** (0.37.2) - every session on the machine shares the store and two versions may run against it at once (2.6, 3.17), so an old shape is read where it is found and the code that reads it stays. With 7.10 keeping the version at 0.x while stored data still changes, the two rules together mean the reading code only grows: a new field is optional (2.7), a flag is left out when false (2.8), and a shape is replaced rather than renamed. The way out, when that cost outgrows the benefit, is one pull request that names a floor release and drops the readings below it; that is a `type!:` change (7.2), not a cleanup, and it comes with the release note to match.
