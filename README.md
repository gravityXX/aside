# aside

<kbd>aside</kbd> is a prompt queue for <kbd>Claude Code</kbd>. Queue prompts, ideas and comments while Claude works, without interrupting it, and send them once it finishes or whenever you are ready.

<p>
  <a href="https://github.com/gravityXX/aside/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/gravityXX/aside/ci.yml?branch=main&style=flat-square&label=CI&color=555"></a>
  <img alt="Version" src="https://img.shields.io/github/package-json/v/gravityXX/aside?filename=.claude-plugin%2Fplugin.json&style=flat-square&label=version&color=555">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-555?style=flat-square"></a>
</p>

![While Claude works on your task, your ideas and comments go to a queue instead of to Claude. When it is done you answer it as usual, and /aside plan hands the queue over as steps, which Claude sums up after the last one.](assets/how-it-works-light.svg#gh-light-mode-only)
![While Claude works on your task, your ideas and comments go to a queue instead of to Claude. When it is done you answer it as usual, and /aside plan hands the queue over as steps, which Claude sums up after the last one.](assets/how-it-works-dark.svg#gh-dark-mode-only)

## How it works

### 1. Note it while Claude works

**To comment on something, copy it first** (<kbd>Ctrl</kbd>+<kbd>C</kbd> or <kbd>&#x2318;</kbd>+<kbd>C</kbd>), from anywhere: <kbd>VS Code</kbd>, a <kbd>terminal</kbd>, a <kbd>web page</kbd>. Then start a message with `+`, or end one with it. It goes to the queue, not to Claude. **No paste needed:** <kbd>aside</kbd> takes whatever is on your clipboard.

![Copy a sentence from a markdown preview with Ctrl+C, then type +? and a question in Claude Code: the comment is queued, pinned to docs/report.md line 42 with the copied sentence. The marks: + idea, +? question, +! change, +- drop, ++ dig deeper.](assets/step-1-light.svg#gh-light-mode-only)
![Copy a sentence from a markdown preview with Ctrl+C, then type +? and a question in Claude Code: the comment is queued, pinned to docs/report.md line 42 with the copied sentence. The marks: + idea, +? question, +! change, +- drop, ++ dig deeper.](assets/step-1-dark.svg#gh-dark-mode-only)

> [!NOTE]
> What you type in a hurry is tidied as it is queued: spelling, punctuation, wording. What you copied stays exactly as copied. To keep entries as typed, set `tidy` to `off` in `/config`. The other settings are under [More](#more).

### 2. Answer Claude as usual

Your reply goes to Claude. By default the queue just waits, in a line above the prompt. Its <kbd>list</kbd> button opens a pane with the queue, the tags in files and the plan, and <kbd>plan</kbd> to organize them. Beside it, <kbd>run plan</kbd> shows while the plan has steps left, <kbd>continue</kbd> after a step paused it, and <kbd>stop</kbd> while a step runs. `/aside` opens the same pane while Claude works.

![Claude asks whether to update the docs. Above the prompt, the queue line shows 1 idea and 4 comments with a list button. You answer as usual; the queue keeps waiting.](assets/step-2-light.svg#gh-light-mode-only)
![Claude asks whether to update the docs. Above the prompt, the queue line shows 1 idea and 4 comments with a list button. You answer as usual; the queue keeps waiting.](assets/step-2-dark.svg#gh-dark-mode-only)

### 3. Look at it when ready

Nothing reaches Claude until you say so. `/aside` shows the queue in a frame, and `/aside pop N` puts one entry in the prompt box, ready to send.

![/aside shows the list in a frame, 1 idea and 1 comment with its file, line and quote; /aside pop 2 puts entry 2 in the prompt box.](assets/step-3-light.svg#gh-light-mode-only)
![/aside shows the list in a frame, 1 idea and 1 comment with its file, line and quote; /aside pop 2 puts entry 2 in the prompt box.](assets/step-3-dark.svg#gh-dark-mode-only)

### 4. Plan and run

`/aside plan` has Claude turn the queue into steps, shown in a frame. Anything unclear goes back to the queue with Claude's question.

`/aside run` sends one step at a time, each ending with a one-line result. A step that needs you pauses the plan: answer, then press <kbd>continue</kbd>. After the last step, Claude sums the run up.

![/aside plan has Claude save the queue as steps and /aside run sends them one after another. Above the prompt: step 2 of 3 running, with list and stop buttons. The plan shows step 1 done with its result under it, step 2 running and step 3 to do; after the last step Claude ends with a summary of the run.](assets/step-4-light.svg#gh-light-mode-only)
![/aside plan has Claude save the queue as steps and /aside run sends them one after another. Above the prompt: step 2 of 3 running, with list and stop buttons. The plan shows step 1 done with its result under it, step 2 running and step 3 to do; after the last step Claude ends with a summary of the run.](assets/step-4-dark.svg#gh-dark-mode-only)

## Install

```text
/plugin marketplace add gravityXX/aside
/plugin install aside@aside
```

Requires <kbd>Claude Code</kbd> 2.1.301 or newer. The plugin API <kbd>aside</kbd> builds on is in early access and may change between releases. Claude Code turns it on per account, so where `/aside` is an unknown command, sign in again with `/login`: a machine that has not reached your account for a while keeps it off.

<kbd>aside</kbd> works in <kbd>Claude Code</kbd> in a terminal, on Linux, macOS, Windows and WSL, with its line above the prompt, the list pane and the frames. Through Remote Control from a phone or the web, entries you start with `+` are queued, and what aside draws shows in the terminal of the machine the session runs on. <kbd>Claude Code Desktop</kbd> runs a Claude Code of its own, which refuses <kbd>aside</kbd> until it reaches 2.1.301; there, add entries with `/aside TEXT`, since Desktop's message box turns a line that starts with `+ ` into a list item. Claude Code loads no plugins like it in cloud sessions or in Desktop sessions inside WSL, and in VS Code draws none of its parts yet.

## Commands

```text
/aside                 show the queue and the plan
/aside plan            have Claude turn the queue into steps
/aside run             run the plan step by step, or the queue entry by entry
/aside run 3 1         run only those steps, or those entries
/aside run all         send the queue as is, no plan
/aside continue        go on after a step paused to ask you
/aside stop            stop after the current step

/aside TEXT            queue TEXT, as + would
/aside pop [N]         put the newest entry, or entry N, in the prompt box
/aside edit N          rework entry N and queue it again
/aside move N M        move entry N to place M
/aside remove N ...    remove one entry, or several
/aside clear           empty the queue
/aside undo            bring back what the last plan, run or clear took
/aside scan FILE       read the tags of a file Claude did not write
/aside export [FILE]   save the list as Markdown, to aside.md or FILE
/aside help            list every command
```

`N` is a number as `/aside` shows it, and `[N]` may be left out. `FILE` is one word ending in `.md`. While Claude works, `/aside` opens the list in a pane. Tab completes every command.

## More

> [!IMPORTANT]
> **The queue stays on your machine**, one per project. Nothing reaches Claude's conversation until you run `/aside plan` or `/aside run`, or `afterClaudeAnswers` does. With `tidy` on, the text you type goes to Haiku to be corrected; what you copied never does. With `planModel` on a model, `/aside plan` sends the queue to that model in place of the conversation.

<details>
<summary>What aside reads, runs and sends</summary>

<br>

- **Keeps** the queue, the plan and what `/aside undo` brings back, one set per project, in Claude Code's store for the plugin (`~/.claude/plugins/store/`). It writes a file only when you run `/aside export`, and never over one it did not write.
- **Reads** `<!-- ? -->` tags in markdown files Claude wrote or edited this session, or that you `/aside scan`; for a comment, the clipboard, the lines you selected in Claude's reply, the last tool output and the project's markdown files; the project's git branch.
- **Runs** a clipboard reader (`powershell.exe` on WSL and Windows, `pbpaste` on macOS, `wl-paste`, `xclip` or `xsel` on Linux), `git rev-parse --abbrev-ref HEAD`, and `grep -rlizP` over the project's markdown files.
- **Sends** the entries to Claude only on `/aside plan`, `/aside run` or `afterClaudeAnswers`, with what you copied, and to the model `planModel` names instead on `/aside plan`; while `tidy` is on, the text you typed goes to Haiku through Claude Code, never what you copied.

aside opens no network connection of its own and installs nothing.

</details>

<details>
<summary>Other ways to comment</summary>

<br>

```text
why is this so slow +?           the whole draft, as a question
+? why did this fail             nothing copied: the last tool output, an error first
+? @docs/report.md:42 why        line 42 of that file
+! @report.md#results shorter    the Results heading
+- #appendix                     a heading in a file Claude wrote this session
<!-- ? why -->                   a tag in a markdown file
```

In a tag, `!` is a change, `-` a drop and `+` dig deeper. Tags count in markdown files Claude wrote or edited this session; `/aside scan FILE` adds any other. In fullscreen mode, lines you select in Claude's reply count as copied.

</details>

<details>
<summary>Settings</summary>

<br>

Change these in `/config`:

- `afterClaudeAnswers`: `wait` (default), `plan` or `run all`. What aside does once Claude answers.
- `planModel`: `session` (default), `sonnet`, `haiku` or `opus`. Who organizes the queue on `/aside plan`: Claude in this conversation, knowing the work so far, or one call to that model outside it, which adds nothing to the conversation and runs while Claude works, but sees only the queue.
- `order`: `oldest` (default) or `newest`. Which entry comes first in the list and in a run.
- `tidy`: `on` (default) or `off`. Whether a small model fixes the spelling and wording of what you type.

</details>

## Contributing

Found a bug or have an idea? [Open an issue](https://github.com/gravityXX/aside/issues/new) and say what you did, what you expected and what happened, with your Claude Code version (`claude --version`) and your system.

To change something yourself, fork the repository, work on a branch and open a pull request. [CONTRIBUTING.md](CONTRIBUTING.md) shows how to run and test the plugin from your copy, and [docs/guidelines.md](docs/guidelines.md) how the code is laid out, written and reviewed. A pull request needs a passing CI run.

## Support

aside is free, and I put time and effort into it. If it saves you time, star the repository so others can find it, or [sponsor its development and more useful skills to come](https://github.com/sponsors/gravityXX).

Thank you to everyone who reports a problem, suggests an idea or sends a fix. Enjoy your queue.

<br>

<p><sub><a href="LICENSE">LICENSE</a> &#xB7; <a href="CHANGELOG.md">CHANGELOG</a> &#xB7; <a href="CONTRIBUTING.md">CONTRIBUTING</a> &#xB7; <a href="https://github.com/sponsors/gravityXX">SPONSOR</a></sub></p>
