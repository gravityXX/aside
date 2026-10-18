# aside

<kbd>aside</kbd> is a prompt queue for <kbd>Claude Code</kbd>. Queue prompts, ideas and comments while Claude works, without interrupting it, and send them once it finishes or whenever you are ready.

<p>
  <a href="https://github.com/gravityXX/aside/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/gravityXX/aside/ci.yml?branch=main&style=flat-square&label=CI&color=555"></a>
  <img alt="Version" src="https://img.shields.io/github/package-json/v/gravityXX/aside?filename=.claude-plugin%2Fplugin.json&style=flat-square&label=version&color=555">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-555?style=flat-square"></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/how-it-works-dark.svg">
  <img alt="While Claude works on your task, your ideas and comments go to a queue instead of to Claude. When it is done you answer it as usual, and /aside plan hands the queue over as steps." src="assets/how-it-works-light.svg">
</picture>

## How it works

### 1. Note it while Claude works

**To comment on something, copy it first** (<kbd>Ctrl</kbd>+<kbd>C</kbd> or <kbd>&#x2318;</kbd>+<kbd>C</kbd>), from anywhere: <kbd>VS Code</kbd>, a <kbd>terminal</kbd>, a <kbd>web page</kbd>. Then start a message with `+`. It goes to the queue, not to Claude. **No paste needed:** <kbd>aside</kbd> takes whatever is on your clipboard.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/step-1-dark.svg">
  <img alt="Copy a sentence from a markdown preview with Ctrl+C, then type +? and a question in Claude Code: the comment is queued, pinned to docs/report.md line 42 with the copied sentence. The marks: + idea, +? question, +! change, +- drop, ++ dig deeper." src="assets/step-1-light.svg">
</picture>

### 2. Answer Claude as usual

Your reply goes to Claude. By default the queue just waits, in a line above the prompt.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/step-2-dark.svg">
  <img alt="Claude asks whether to update the docs. Above the prompt, the queue line shows 1 idea and 4 comments with an organize button. You answer as usual; the queue keeps waiting." src="assets/step-2-light.svg">
</picture>

### 3. Plan or run when ready

Nothing reaches Claude until you say so: look at the list, then plan, run or pop.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/step-3-dark.svg">
  <img alt="/aside shows the list, /aside plan has Claude turn it into steps, /aside run runs them, /aside pop 2 puts entry 2 in the prompt box." src="assets/step-3-light.svg">
</picture>

## Install

```text
/plugin marketplace add gravityXX/aside
/plugin install aside@aside
```

Requires <kbd>Claude Code</kbd> 2.1.301 or newer. The plugin API <kbd>aside</kbd> builds on is in early access and may change between releases.

## Commands

<table>
  <tr>
    <th colspan="2">Queue</th>
    <th colspan="2">Entries</th>
  </tr>
  <tr>
    <td><code>/aside</code></td><td>Show the queue and the plan</td>
    <td><code>/aside pop [N]</code></td><td>Put the newest one (or N) in the box</td>
  </tr>
  <tr>
    <td><code>/aside plan</code></td><td>Turn the queue into steps</td>
    <td><code>/aside edit N</code></td><td>Rework one and queue it again</td>
  </tr>
  <tr>
    <td><code>/aside run [N]</code></td><td>Run the steps, or step N</td>
    <td><code>/aside move N M</code></td><td>Move N to place M</td>
  </tr>
  <tr>
    <td><code>/aside run all</code></td><td>Send the queue as is, no plan</td>
    <td><code>/aside remove N</code></td><td>Remove one</td>
  </tr>
  <tr>
    <td><code>/aside stop</code></td><td>Stop after the current step</td>
    <td><code>/aside clear</code></td><td>Empty the queue</td>
  </tr>
  <tr>
    <td><code>/aside help</code></td><td>List every command</td>
    <td><code>/aside undo</code></td><td>Bring back what plan, run or clear took</td>
  </tr>
</table>

`N` is a number as `/aside` shows it; in brackets, `[N]`, you can leave it out. Tab completes every command.

## More

<details>
<summary>Other ways to comment</summary>

<br>

**Copy from anywhere.** <kbd>VS Code</kbd>, a <kbd>terminal</kbd>, a <kbd>markdown preview</kbd>, a <kbd>web page</kbd>, a <kbd>PDF</kbd>: whatever lands on the clipboard counts. Text found in a markdown file of the project (five words or more) is pinned to its line. Anything else is kept as a quote.

**Name the place yourself,** right after the mark:

```text
+? @docs/report.md:42 why this order
+! @report.md#results shorter
+- #appendix
```

**Select instead of copying.** On Claude's own reply in the <kbd>terminal</kbd> (fullscreen mode), select the lines with the mouse.

**Ask about a failure.** With nothing copied or selected, a comment carries the last tool output of the turn, an error first, so `+? why did this fail` arrives with its error.

**Leave tags in a file.** In markdown files Claude wrote or edited this session, these count as comments too. `/aside scan FILE` adds any other file.

```markdown
<!-- ? question -->
<!-- ! change -->
<!-- - drop -->
<!-- + dig deeper -->
```

</details>

<details>
<summary>Settings, platforms and privacy</summary>

<br>

**Settings.** `/config` has two. `whenTurnEnds`: what happens to the queue when Claude finishes a turn. `wait` (default) keeps it until you run `/aside plan` or `/aside run`, `plan` turns it into a plan at once, `send` sends it to be done at once. Neither hands it over while a saved plan still has steps to do. `order`: which entry comes first in the list and in a run, `oldest` (default, first in, first out) or `newest` (last in, first out).

**Clipboard.** Read with `powershell.exe` on WSL, `pbpaste` on macOS, `wl-paste`, `xclip` or `xsel` on Linux and `powershell` on Windows. Only for a comment that names no line or heading, never for a plain `+` idea.

**Privacy.** The queue stays on your machine, one per project. Nothing reaches Claude until you run `/aside plan` or `/aside run`, or `whenTurnEnds` hands it over.

</details>

<br>

<p><sub><a href="LICENSE">LICENSE</a> &#xB7; <a href="CHANGELOG.md">CHANGELOG</a> &#xB7; <a href="CONTRIBUTING.md">CONTRIBUTING</a></sub></p>
