# Changelog

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
