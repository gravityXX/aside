# Changelog

## Unreleased

- `/aside run N [M ...]` counts what `/aside` shows: the steps of the plan while it has steps to do, else the entries of the queue. `/aside run 11 10` runs entries 11 and 10 one after another, in that order, and leaves the rest of the queue; `/aside run 3 1` runs those two steps of the plan. A number out of range is refused with what it counts.

## 0.13.0 - 2026-10-18

- The line above the prompt keeps its `list` button while a step runs, with `stop` beside it, and shows `run plan` beside `list` whenever the plan has steps left. The list pane offers no `plan` while a step runs.

## 0.12.0 - 2026-10-18

- Each step of a plan tells Claude where it stands: the titles of the steps done and still to do, and that the next one is sent by itself. A step that needs your answer pauses the plan with the plugin's new `wait` tool: the step finishes, the next one waits, and `/aside run` goes on from there.

## 0.11.0 - 2026-10-18

- `/aside remove` takes several numbers at once: `/aside remove 1 2 3` removes those three entries, or none when one of the numbers is out of range.
- `/aside undo` no longer brings back what Claude has already done: once the turn with a planning prompt, a `run all` or the steps of `/aside run` ends with an answer, there is nothing left to undo. A clear stays undoable until the next plan, run or clear.

## 0.10.1 - 2026-10-18

- `/aside undo` brings back the tags in files that a plan or run took, so the next `/aside plan` takes them again. Each plan, run or clear replaces what undo brings back, and a hand-over that failed leaves nothing to bring back twice.
- The tests are split by what they check (typing, comments, commands, the plan, the band and pane, matching in files) and check what the person sees, not how the plugin does it.
- The code under `hooks/` is split into layers by what each part does, with `register.tsx` as the list of the plugin's hooks. `/aside help` lists one command per line, and `/aside constructor ...` is queued as text like any other word that is no command, where it used to show the help or fail; nothing else changes in use.

## 0.10.0 - 2026-10-18

- The button on the line above the prompt reads `list` instead of `organize`: it opens a pane with the queue and the plan, drawn as `/aside` draws them and kept up to date while it is open. Its `plan` button organizes the queue, as `organize` did; `close` or Escape closes it.
- No more "Waiting in the queue" toast when Claude answers: the line above the prompt already shows what waits.

## 0.9.0 - 2026-10-18

- The setting `whenTurnEnds` is now `afterClaudeAnswers`, and its value `send` is now `run all`, as the command it stands for. A value set under the old name is not carried over: set `afterClaudeAnswers` again in `/config`.

## 0.8.1 - 2026-10-18

- `/aside plan` only organizes: Claude is told to use no tool but the plan tool and to leave questions for their steps, instead of answering them at once.
- The band's `organize` and `run plan` buttons work again. They called `/aside` through the engine, which skips the plugin's own command hook, and ended in "no command.run hook answered it".

## 0.8.0 - 2026-10-18

- A new setting, `order`: `oldest` (default) keeps the queue first in, first out; `newest` makes it last in, first out. `/aside` lists, numbers and runs the queue in that order, and `pop` alone always takes the newest entry. The setting can change at any time without losing the order you set with `move`.
- A mark at the end of a message queues it too, after a space or a line break: `why is this so slow +?` is `+? why is this so slow`. A draft you have already typed goes to the queue without retyping it.
- The `/aside` list is tighter: the kind column is only as wide as the kinds it shows, and the line under a comment reads `↳ where · what`. The line above the prompt starts with `aside:`, as the list does.
- A new setting, `tidy`, on by default: once an entry is queued, a small model (Haiku) fixes the spelling, punctuation and wording of what you typed, in its own language. The copied quote is never sent or changed, and the entry keeps its text as typed when no reply comes in time.
- In the terminal the `/aside` list is drawn in a frame, each kind and step state in a theme colour, and long text wraps in its own column. The model and other surfaces still get the plain text.

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
