# Changelog

## 0.7.1 - 2026-10-18

- `/aside` lists the queue in columns: a count of what waits, then number, kind and text, with a comment's file, line and quote on the line below. The plan and the file tags read the same way.

## 0.7.0 - 2026-10-18

- Renamed from idea-queue to aside: the plugin is `aside`, the command is `/aside` (was `/queue`), the plan tool is `mcp__aside__plan`. A queue kept under the old name does not carry over.

## 0.6.1 - 2026-10-18

- Tab completes `/queue` subcommands, then entry numbers (`pop`, `edit`, `remove`, `move`) and plan step numbers (`run`), each with a dim description.

## 0.6.0 - 2026-10-18

Fewer commands, each with one meaning.

- `/queue` alone shows the queue and the plan; it no longer hands anything over.
- `/queue plan` organizes the queue into steps; `/queue run` runs them, and with no plan runs the queue entry by entry; `/queue run all` sends everything at once.
- `/queue send` and `/queue each` are gone: `run all` and `run` do what they did.
- `/queue pop` puts the entry in the prompt box ready to send, without its `+`; `/queue pop N` takes entry N.
- Enter on a `+` message is answered at once, like a plain prompt: the box empties straight away, and the clipboard, the search and the store run right after, one message at a time. Where each entry points is said in a dim transcript line instead of a toast.

## 0.5.1 - 2026-10-18

- An idea names the task it came with only when it was queued while Claude was working; one queued at an idle prompt names none.

## 0.5.0 - 2026-10-17

What the Claude Code feature requests for a prompt queue asked for and 0.4.0 lacked.

- `/queue TEXT` queues TEXT, as `+ TEXT` would.
- `/queue send` hands the queue over as it is, to be done now; `/queue each` runs every entry as its own prompt.
- `/queue edit N` puts an entry back in the prompt box; `/queue move N M` reorders.
- A comment takes a freshly copied fragment first, then the text selected in Claude's reply in the terminal, then an older clipboard, then the last Bash or edit output of the turn.
- `/queue edit N` brings the reworked entry back to its place with what it pointed at; `/queue` merges the steps still to do of the saved plan into the new one.
- Setting `whenTurnEnds` (`wait`, `plan`, `send`) hands the queue over by itself when Claude finishes a turn.

## 0.4.0 - 2026-10-17

First public release.

- Queue ideas with `+` and comments with `+?`, `+!`, `+-`, `++`, mid-task included.
- Comments pin themselves to the copied fragment, found in the session's markdown files or the project.
- Anchors `@file`, `@file:42`, `@file#heading`, `#heading`, and `<!-- ? -->` tags in files.
- `/queue` turns everything into a plan of prompts; `/queue run` runs the steps in order, `/queue stop` stops.
- Clipboard on WSL, Linux, macOS and Windows; project search with GNU grep or a built-in walk.
