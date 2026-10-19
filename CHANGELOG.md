# Changelog

## Unreleased

- `/aside log` lists the plans run to their end, the last 5 with what each step did and how long it took, newest first, and `/aside log N` shows any of the 20 it keeps. A plan comes there once another takes its place, so `/aside` keeps showing the one just run.
- `/aside find TEXT` finds the entries, the tags, the steps of the plan and the ideas of the global list and every named queue that hold all its words, in any case and with or without accents, so `zrob` finds `Zrób`. Each comes under the number its own command takes, as in `/aside pop 2` or `/aside q work here 1`.
- `/aside import FILE` queues the items of a markdown list in FILE, each an entry, with the lines indented under it. A mark such as `+?` at an item's start gives its kind; ticked items, front matter, headings, paragraphs and code blocks between items are left out, an item already in the queue is not queued again, and the file stays as it is. `/aside g import FILE` and `/aside q work import FILE` put its ideas on those queues. A message such as `/aside find the bug` or `/aside import notes.md` no longer queues that text.

## 0.25.2 - 2026-10-19

- `/aside help`, its Tab hint and the README say what `/aside undo` brings back: what the last clear took, or a plan or run Claude has not answered yet. They used to promise any plan or run, which Claude's answer had already made final.

## 0.25.1 - 2026-10-19

- A step that asks you something no longer counts as done after its first reply: it waits for your answer, and your answer and the turns that follow belong to it. The line above the prompt says `step 2 running` while Claude works on it and `step 2 waits for you` in between, with <kbd>continue</kbd>, where it used to say `paused after step 2`. `/aside` shows the step as `waiting`, with its time and what it said so far, and `/aside continue` ends it, keeping the time of all its turns and what the last one said, then runs the next step, from any session, after `/clear` too. The last step of a run can wait too, and sums the run up only once `continue` ends it, in one more short turn, rather than in the reply that asked. `/aside stop` on a step that waits ends it as it stands, and a turn cut short never loses a step that `continue` or `stop` ended.

## 0.25.0 - 2026-10-19

- Named queues for ideas that belong to no project, beside the global list: start a message with `+@work`, or end a draft with ` +@work`, and the idea goes to the queue named `work`, made by its first idea. `/aside q` lists the queues with their newest idea, and `/aside q work` shows one and takes every command `/aside g` does: `here`, `add`, `remove`, `edit`, `pop` and `move`. `/aside q work clear` empties a queue and `/aside q work undo` brings back what that queue's last clear took; `/aside q work rename office` moves it all to another name, or into a queue that already holds ideas, merging the two. The global list is the queue named `global`: `+@global` is `+g`, and `/aside g clear` and `undo` work on it as well. The line above the prompt counts two queues, as in `1 global, 2 @work`, and the rest as `+1 queue`. A comment's `@file` is read as before, since it comes after the comment's mark.

## 0.24.0 - 2026-10-19

- `/aside plan` and the pane's <kbd>plan</kbd> button work while a step of the plan runs: they add the queue to the plan as new steps after its own, leaving the steps done, the one running and those to do as they are. Claude in the conversation organizes it once the step ends, and the run then waits for `/aside continue`; with `planModel` on a model, the steps are added at once and the run goes on to them. A step that ends, pauses or stops meanwhile loses none of them, a run of steps named with `/aside run 3 1` leaves them for `/aside run`, and a plan replaced meanwhile gets none.

## 0.23.0 - 2026-10-19

- A global list for ideas that belong to no project: start one with `+g`, or end a draft with ` +g`. `/aside g` shows it, `/aside g here N ...` moves its ideas into this project's queue and `/aside g add N ...` moves ideas there, and `/aside g remove`, `edit`, `pop` and `move` work on it as on the queue. `/aside` and the plan leave it out; the line above the prompt counts it, as in `1 global`. Ideas added in several sessions at once never overwrite each other.

## 0.22.0 - 2026-10-19

- The `planModel` setting picks who organizes the queue on `/aside plan`. `session`, the default, is Claude in this conversation, as before. `sonnet`, `haiku` or `opus` hand it to one call to that model outside the conversation: the plan comes back as the command's answer, or as a toast after Claude answers with `afterClaudeAnswers` on `plan`, nothing is added to the conversation, and it can run while Claude works. The queue stays as it is until the plan is saved, one such call runs at a time, and when that model gives no plan, or the queue or the plan changed while it thought, nothing is saved and aside says why.

## 0.21.0 - 2026-10-19

- `/aside export` saves what `/aside` shows, the queue, the tags in files and the plan, to `aside.md` in the project as Markdown, a heading for each part over its lines as `/aside` shows them, or to the file named, as in `/aside export notes/queue.md`. It writes over an earlier export but never over another file, and the queue stays as it is. A comment's copied text is still found in its own file rather than in an export that quotes it, and an export holds no tags of its own.

## 0.20.1 - 2026-10-19

- On Windows, a file is one file however its path is written: with `\` or `/`, in any letter case, or as `.\docs\report.md`. A tag no longer shows twice when its file is scanned under two of these, a file Claude writes shows by its path in the project rather than in full, in a project at the root of a drive too, and the plan keeps the comments on one file together. Queues, tags handed over and `/aside undo` saved by 0.20.0 read the same way. A Windows path outside the project shows with forward slashes, as in `C:/notes/todo.md`.
- On every system, a file named as `./docs/report.md`, `docs//report.md` or through `..` is the same file as `docs/report.md`, so its tags no longer show twice.

## 0.20.0 - 2026-10-18

- The plan is drawn as a line of steps, in the `/aside` frame, the list pane and the saved plan's row: each step's mark in its state's colour (done, running, to do), and under a step done how long it took and what it said. A double line marks where a step paused the run, and the plan's title gives its time so far.
- The line above the prompt shows how far the plan is, as in `plan ▰▰▱▱ 2/4 · step 3 running`.

## 0.19.0 - 2026-10-18

- aside draws in Claude Code Desktop too: the line above the prompt, the list pane, the framed `/aside` listing and the saved plan. Before, Desktop showed the line, but the pane its `list` button opened stayed empty.
- The README says where aside works: the terminal on every system, Desktop's local and SSH sessions, and Remote Control for `+` entries; and where Claude Code does not load it.

## 0.18.3 - 2026-10-18

- On WSL without `WSL_DISTRO_NAME`, as in an ssh login or a systemd service, comments read the clipboard again: `powershell.exe` is now tried on every system first, and a reader that is not installed is passed over at once.
- A `+` sent from a phone or the web through Remote Control is queued, where it used to go to Claude, and a comment sent that way does not read this machine's clipboard.
- A comment can name a Windows file by its drive, as in `+? @C:\docs\report.md:5`, and `/aside scan` takes an absolute Windows path or a file name with spaces.
- A search where grep found the file but could not read some folder keeps what it found; a heading or tag on a file's first line is found behind a byte-order mark; and with no clipboard reader installed, a comment says so rather than that nothing was copied.

## 0.18.2 - 2026-10-18

- The band's `list` button opens the list pane on a terminal narrower than 144 columns too, during a task or not. It opened only on a wider one, since the pane was opened after the press had ended and the engine took the open for the plugin's own. A pane already open but out of sight is brought back rather than closed, and a toast says why when the pane cannot be shown.
- Toasts and transcript lines no longer repeat "aside" after the plugin's own name.

## 0.18.1 - 2026-10-18

- On Linux, a clipboard reader that runs but fails, such as `wl-paste` with no Wayland session, no longer leaves comments without the clipboard: aside tries the next reader, and asks the first one again next time.
- A typed entry the store cannot take is not lost. It goes back into the prompt box when the box is empty; otherwise the transcript line gives it whole, with the reason. An entry taken out with `/aside edit` stays taken until it is stored again.
- When `/aside`, the end of a turn or the plan and wait tools fail, aside says so in a sentence of its own, with the reason, in place of the engine's words. A hand-over the store refuses leaves the queue as it was, and a plan it refuses saves nothing, so Claude can save it again.
- The list pane's `plan` button says why when the hand-over fails, and the old `queue:` prefix is gone from the transcript.

## 0.18.0 - 2026-10-18

- A run that a step pauses with `wait` is kept. The line above the prompt says `plan paused after step N` with a `continue` button, and `/aside` gives the reason in the plan's title. `/aside continue`, `/aside run` and the button go on with that run as it was to go: `/aside run 3 1 2` paused after step 3 runs steps 1 and 2 next, where it used to start the whole plan over from step 1. `/aside stop` drops the pause, and `/aside run N` starts a new run.

## 0.17.1 - 2026-10-18

- The `stop` and `run plan` buttons sit on the line above the prompt, beside `list`, where they used to drop to the line below it.

## 0.17.0 - 2026-10-18

- Each step of a plan ends its reply with a one-line result, which the plan keeps with the step and `/aside` shows under it. The last step of a run gets what every step done said, those before a pause included, and ends with a summary of the whole run: what each step did, what is still open and what comes next.
- Steps are told to leave the work of later steps alone, to say so when a step is done already, and to pause the plan with `wait` when something blocks them, not only when they need your answer.
- A plan run to its end stays in `/aside` as `Plan done` until the next plan takes its place, and the toast at its end says how long the plan took.

## 0.16.0 - 2026-10-18

- The plan Claude saves shows in the transcript in the frame `/aside` draws, with each step's state in colour, in place of the plan tool's raw input. Claude is asked not to list the steps again in its reply.
- `/aside plan` with steps still to do gives Claude those steps whole, where it used to cut each to 300 characters, so a long step no longer loses its end when the queue is planned again. The steps already done stay at the top of the new plan instead of disappearing.
- Items Claude leaves out of the plan because they look done, contradictory or unclear go back to the queue, and the frame lists them with Claude's question.
- A planning turn that ends with no plan saved, answered or interrupted, puts the queue back. Before, the entries were gone, with nothing for `/aside undo` to bring back.
- `/aside plan` and `/aside run all` wait while a step of the plan runs, as the pane's `plan` button already did, so no prompt lands in the middle of the step.

## 0.15.0 - 2026-10-18

- `/aside` typed while Claude is working opens the list in the pane, which shows at once and keeps up to date. Before, the list only showed once Claude finished, since Claude Code prints a command's output after the turn. Where the terminal has no room for the pane, the list goes into the transcript right away.

## 0.14.0 - 2026-10-18

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
