# idea-queue

Park ideas and comments while Claude works, then turn them into an ordered plan of prompts and run it step by step.

While a task runs, new ideas keep coming: something to fix next, a question about the report an agent just wrote, a section you would drop. Typing them in interrupts the task or piles new threads onto it. idea-queue keeps them out of the conversation until you ask for them.

```text
+ add a dark mode toggle                 an idea, queued, Claude never sees it
+? where does this number come from      a question about the fragment you just copied
/queue                                   Claude groups everything into a plan of prompts
/queue run                               the steps run one after another
```

## Install

```text
/plugin marketplace add gravityXX/idea-queue
/plugin install idea-queue@idea-queue
```

idea-queue is a hooks-module plugin and needs Claude Code 2.1.301 or newer. That plugin API is in early access and may change between releases.

## Queue ideas

A message that starts with `+` is stored instead of sent, mid-task included. The task keeps running and the line below your message says what was queued.

```text
+ rename the config loader
+ cache the parsed config
```

When every line starts with `+`, each line is its own entry. Otherwise the whole message is one entry. A pasted diff is not mistaken for an idea. `/queue add tests for the parser` queues the same way, for when a command is closer to hand. Text that happens to look like a command (`/queue run 3`) is queued with `/queue + run 3`.

## Comment on what Claude wrote

Agents often leave a report or a plan in a markdown file that you read in a preview, which you cannot edit. Select a fragment there, copy it, and type a comment with a mark:

| Mark | Meaning      | Example                          |
| ---- | ------------ | -------------------------------- |
| `+?` | question     | `+? where does this number come from` |
| `+!` | change       | `+! make this a table`           |
| `+-` | drop         | `+- drop this section`           |
| `++` | dig deeper   | `++ compare with last year`      |

idea-queue reads the clipboard, finds the fragment in the markdown files written in the session (by Claude or its subagents) or anywhere under the project, and pins the comment to that file and line. The match runs on words, so markup, line wraps and list numbers do not get in the way. When no file holds the copied text, the comment keeps it as a loose quote and says so. A comment on Claude's own reply works without copying: select the lines with the mouse in the terminal (fullscreen mode). A clipboard unchanged since the previous comment counts as stale, and then the selection wins. With nothing copied, a comment takes the last tool output of the turn, a failure first, so `+? why did this fail` arrives with the error it is about.

Pin a comment yourself, without the clipboard, right after the mark:

```text
+? @docs/report.md:42 why this order
+! @report.md#results shorter
+- #appendix
```

In an editor you can also leave tags in the file. `/queue` reads them from the files written in the session, or from any file after `/queue scan FILE`:

```markdown
<!-- ? is this the same for Poland -->
<!-- ! do this as a table -->
<!-- - drop this -->
<!-- + expand -->
```

## Plan and run

Two words do the work:

- `/queue plan` hands everything over in one message. Claude answers the questions straight away, merges related items into one step, keeps unrelated ones apart, orders them, writes a self-contained prompt for each step and saves the steps with the plugin's `plan` tool. Nothing runs yet.
- `/queue run` sends the steps one by one: each step starts when the one before has finished. With no plan, every entry is a step of its own. The band above the prompt shows `step 2/4 running` with a stop button. `/queue stop` lets the current step finish and stops there. An interrupted step stops the plan.

For two or three small things a plan is a needless stop: `/queue run all` sends everything in one message, to be done at once.

## Commands

| Command            | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `/queue`           | Show the queue, the tags found in files and the plan            |
| `/queue plan`      | Have Claude organize the queue into steps                       |
| `/queue run`       | Run the plan step by step; with no plan, entry by entry         |
| `/queue run N`     | Run step N of the plan alone                                    |
| `/queue run all`   | Send everything in one message, no plan                         |
| `/queue stop`      | Stop after the current step                                     |
| `/queue TEXT`      | Queue TEXT, as `+ TEXT` would                                   |
| `/queue pop [N]`   | Put the last entry, or entry N, in the prompt box, ready to send |
| `/queue edit N`    | Put entry N in the prompt box to rework it and queue it again   |
| `/queue move N M`  | Move entry N to place M                                         |
| `/queue remove N`  | Remove entry N                                                  |
| `/queue clear`     | Empty the queue                                                 |
| `/queue undo`      | Bring back what `plan`, `run` or `clear` last took              |
| `/queue scan FILE` | Read the tags of a file Claude did not write in this session    |
| `/queue help`      | Show this list                                                  |

`/queue` runs at once even while Claude works, so `stop` lands in time. The prompts it sends wait for the turn to end.

## Settings

`/config` lists one setting, `whenTurnEnds`: what happens to the queue when Claude finishes a turn.

- `wait` (default) - keep it until you run `/queue plan` or `/queue run`; a toast says what waits.
- `plan` - hand it over as a plan at once.
- `send` - hand it over to be done at once.

The plugin's own turns (a plan, a step) never set it off, and neither does a turn that ends while the saved plan still has steps to do: run or finish those first.

Each project keeps its own queue and plan, across sessions. Each idea remembers the task that was running and the git branch, so the plan knows what "fix this too" refers to.

## Platforms

| Platform      | Clipboard                                  | Project search          |
| ------------- | ------------------------------------------ | ----------------------- |
| WSL           | `powershell.exe` (the Windows clipboard)   | GNU grep                |
| Linux         | `wl-paste` (Wayland), `xclip` or `xsel`    | GNU grep                |
| macOS         | `pbpaste`                                  | built-in walk           |
| Windows       | `powershell`                               | built-in walk           |

Where GNU grep is missing, the plugin walks the project itself, skipping dot folders and `node_modules`. That is slower on very large trees. Without a clipboard tool, comments still work with `@file`, `#heading` and tags.

## Privacy

- The clipboard is read only for a comment (`+?`, `+!`, `+-`, `++`) that names no place of its own, never for a plain `+` idea.
- The queue is stored on your machine, in the plugin's own store under the Claude Code configuration folder.
- Nothing reaches the model until you run `/queue plan` or `/queue run`.

## Development

```sh
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

`claude --plugin-dir .` loads the plugin from this folder for one session and reloads it on save. The tests use the engine's own test kit and need no account. For a type check, start a session with the plugin loaded once, then run `npx -p typescript tsc -p .` against the types Claude Code writes to `.claude-plugin/types/`.

## License

Apache 2.0, see [LICENSE](LICENSE).
