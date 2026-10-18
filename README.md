<h1 align="center">idea-queue</h1>

<p align="center">
  Comment on what Claude wrote without interrupting it.<br>
  Run it all later, as a plan.
</p>

<p align="center">
  <a href="https://github.com/gravityXX/idea-queue/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/gravityXX/idea-queue/ci.yml?branch=main&style=flat-square&label=CI&color=555"></a>
  <img alt="Version" src="https://img.shields.io/github/package-json/v/gravityXX/idea-queue?filename=.claude-plugin%2Fplugin.json&style=flat-square&label=version&color=555">
  <img alt="License" src="https://img.shields.io/github/license/gravityXX/idea-queue?style=flat-square&color=555">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/comment-flow-dark.svg">
    <img alt="Copy a sentence from a markdown preview, then type +? and a question in Claude Code: the comment is pinned to report.md line 42" src="assets/comment-flow-light.svg" width="840">
  </picture>
</p>

## Comment on a document

Copy a sentence from any markdown preview, then type a mark and your comment. idea-queue finds the sentence in the file and pins the comment to its line.

```text
+? question      +! change      +- drop      ++ go deeper
```

## Park an idea

Start a message with `+`. It waits in the queue instead of reaching Claude, even mid-task.

```text
+ cache the parsed config
```

## Plan and run

`/queue plan` hands everything over at once, grouped by file. Claude answers the questions and turns the rest into steps, which `/queue run` runs one by one.

```text
docs/report.md:
  [question] line 42, on "Revenue grew by 12% in Q3.": where does this come from
  [change]   line 57, on "Costs by region": make this a table
```

## Install

```text
/plugin marketplace add gravityXX/idea-queue
/plugin install idea-queue@idea-queue
```

> [!NOTE]
> Needs Claude Code 2.1.301 or newer. The plugin API it builds on is in early access.

## Commands

| Command          | What it does                                   |
| ---------------- | ---------------------------------------------- |
| `/queue`         | Show the queue and the plan                    |
| `/queue plan`    | Turn the queue into steps                      |
| `/queue run`     | Run the steps, or the entries, one by one      |
| `/queue run all` | Send everything in one message, no plan        |
| `/queue stop`    | Stop after the current step                    |
| `/queue pop [N]` | Put an entry in the prompt box, ready to send  |
| `/queue edit N`  | Rework an entry and queue it again             |
| `/queue clear`   | Empty the queue (`/queue undo` brings it back) |

`/queue help` lists every command; Tab completes them.

<details>
<summary>More ways to comment</summary>

Name the place yourself, right after the mark:

```text
+? @docs/report.md:42 why this order
+! @report.md#results shorter
+- #appendix
```

On Claude's own reply in the terminal, select the lines with the mouse (fullscreen mode) instead of copying. With nothing copied, a comment takes the last command output, so `+? why did this fail` arrives with its error.

In an editor, tags in a markdown file count too: `<!-- ? question -->`, `<!-- ! change -->`, `<!-- - drop -->`, `<!-- + go deeper -->`.

</details>

<details>
<summary>Settings, platforms and privacy</summary>

`/config` has one setting, `whenTurnEnds`: what happens to the queue when Claude finishes a turn. `wait` (default) keeps it until you run `/queue plan` or `/queue run`, `plan` turns it into a plan at once, `send` sends it to be done at once.

The clipboard is read with `powershell.exe` on WSL, `pbpaste` on macOS, `wl-paste`, `xclip` or `xsel` on Linux and `powershell` on Windows. It is read only for a comment that names no place, never for a plain `+` idea.

The queue stays on your machine, one per project. Nothing reaches Claude until you run `/queue plan` or `/queue run`.

</details>

## License

Apache 2.0, see [LICENSE](LICENSE).
