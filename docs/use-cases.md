# Use cases

What <kbd>aside</kbd> does in each situation, with diagrams of how it works. Installing it and every command in one list are in the [README](../README.md).

- [Note an idea while Claude works](#note-an-idea-while-claude-works)
- [Comment on what Claude wrote](#comment-on-what-claude-wrote)
- [Look at the queue and tidy it](#look-at-the-queue-and-tidy-it)
- [Turn the queue into a plan](#turn-the-queue-into-a-plan)
- [Run the plan](#run-the-plan)
- [Answer a step that asks you](#answer-a-step-that-asks-you)
- [Let aside act when Claude answers](#let-aside-act-when-claude-answers)
- [Keep ideas for no project](#keep-ideas-for-no-project)
- [Work in several sessions at once](#work-in-several-sessions-at-once)

## Note an idea while Claude works

Start a message with `+` and press Enter, while Claude works or between replies. The message never reaches Claude: it goes into this project's queue, a line in the transcript says so, and the line above the prompt counts it. A draft that ends with ` +` is queued whole. When every line of a message starts with `+`, each line is an entry of its own; otherwise the whole message is one.

![While Claude builds the parser, you type + dark mode and press Enter: it never reaches Claude, and a line in the transcript says it is queued, 1 waiting. A draft that ends with + is queued whole too, 2 waiting, and the line above the prompt counts 2 ideas, with a list button.](../assets/use-capture-light.svg#gh-light-mode-only)
![While Claude builds the parser, you type + dark mode and press Enter: it never reaches Claude, and a line in the transcript says it is queued, 1 waiting. A draft that ends with + is queued whole too, 2 waiting, and the line above the prompt counts 2 ideas, with a list button.](../assets/use-capture-dark.svg#gh-dark-mode-only)

`tidy` is on by default: Haiku fixes the spelling and wording of what you typed once it is stored, never of what you copied. Set it to `off` in `/config` to keep entries as typed.

## Comment on what Claude wrote

Copy a fragment of Claude's work and type a comment on it: `+?` a question, `+!` a change, `+-` something to drop and `++` something to dig deeper into. <kbd>aside</kbd> looks for a fragment of five words or more in the project's markdown files, so the comment knows its file and line. Text it cannot find stays a plain quote, and the transcript says why.

![Where a comment points. +? @docs/report.md:42 why points to line 42 of that file; +! @report.md#results shorter to its Results heading; Ctrl+C then +? where is this from to the file and line you copied from; +? why did this fail, with nothing copied, to the last tool output, an error first; and a ? tag written in a markdown file to its place there.](../assets/use-comment-light.svg#gh-light-mode-only)
![Where a comment points. +? @docs/report.md:42 why points to line 42 of that file; +! @report.md#results shorter to its Results heading; Ctrl+C then +? where is this from to the file and line you copied from; +? why did this fail, with nothing copied, to the last tool output, an error first; and a ? tag written in a markdown file to its place there.](../assets/use-comment-dark.svg#gh-dark-mode-only)

A fresh copy comes first. In fullscreen mode, with the clipboard unchanged since the last comment, the lines you selected in Claude's reply win. A comment can also be a tag in a markdown file, such as `<!-- ? is this the same for Poland -->`: <kbd>aside</kbd> reads the tags of the files Claude wrote or edited this session, and of any file you name with `/aside scan FILE`.

## Look at the queue and tidy it

`/aside` shows the queue, the tags in files and the plan in a frame, numbered. While Claude works it opens them in a pane instead, as does the <kbd>list</kbd> button above the prompt.

![/aside shows the list in a frame, 1 idea and 1 comment with its file, line and quote; /aside pop 2 puts entry 2 in the prompt box.](../assets/step-3-light.svg#gh-light-mode-only)
![/aside shows the list in a frame, 1 idea and 1 comment with its file, line and quote; /aside pop 2 puts entry 2 in the prompt box.](../assets/step-3-dark.svg#gh-dark-mode-only)

- **`/aside pop [N]`** puts the newest entry, or entry N, in the prompt box, ready to send, and takes it off the queue.
- **`/aside edit N`** takes entry N off the queue into the prompt box, as typed. If the next entry you queue has the same mark, it goes back to place N, still pointing where it did; anything else goes at the end.
- **`/aside move N M`**, **`/aside remove N ...`** and **`/aside clear`** reorder and empty the queue.
- **`/aside undo`** brings back what the last clear took, or what the last plan or run took until Claude has answered it.
- **`/aside find TEXT`** finds every entry, tag, step and idea of a queue that holds all the words, in any case and with or without accents, each with the number its own command takes.
- **`/aside import FILE`** queues the items of a markdown list in FILE, each an entry, leaving out ticked items and those already queued; `/aside g import FILE` and `/aside q work import FILE` put them on those queues.
- **`/aside export [FILE]`** saves what `/aside` shows as Markdown, to `aside.md` or `FILE`.

## Turn the queue into a plan

`/aside plan` hands the queue and the new tags to Claude as one prompt, and Claude saves them as steps with the plan tool. Related entries become one step; an entry Claude finds unclear goes back to the queue as it was, and Claude's question about it shows under the saved plan.

![/aside plan hands the queue to Claude: + dark mode, +? why so slow and + fix the login bug. Claude organizes them into steps and saves the plan, step 1 dark mode and step 2 why so slow, shown in a frame; the unclear login bug goes back to the queue as it was, and Claude's question about it shows under the plan.](../assets/use-plan-light.svg#gh-light-mode-only)
![/aside plan hands the queue to Claude: + dark mode, +? why so slow and + fix the login bug. Claude organizes them into steps and saves the plan, step 1 dark mode and step 2 why so slow, shown in a frame; the unclear login bug goes back to the queue as it was, and Claude's question about it shows under the plan.](../assets/use-plan-dark.svg#gh-dark-mode-only)

A plan with steps still to do is merged with the new entries. While a step runs, Claude organizes the queue once that step ends, into steps after the plan's own, and a run with steps left waits for <kbd>continue</kbd>. After the last step of a run, the new steps wait for `/aside run`; with every step done, they make a new plan.

With the `planModel` setting on `sonnet`, `haiku` or `opus`, one call to that model organizes the queue outside the conversation instead. It adds nothing to the conversation and works while Claude does, but sees only the queue. The plan is saved only if the queue and the plan are still as that model was given them, and it leaves nothing for `/aside undo`.

## Run the plan

`/aside run` sends the steps to Claude one at a time. Each step's prompt says where it stands in the plan, and Claude ends its reply with a `Result:` line, which the plan keeps. The last step of a run gets what every step said, and its reply ends with a summary of the run.

![/aside run sends the steps to Claude one after another: step 1, step 2 and step 3, each reply ending with a Result line, such as config cached, which the plan keeps. The last step's reply ends with a summary of the run: what was done, what is open and what comes next.](../assets/use-run-light.svg#gh-light-mode-only)
![/aside run sends the steps to Claude one after another: step 1, step 2 and step 3, each reply ending with a Result line, such as config cached, which the plan keeps. The last step's reply ends with a summary of the run: what was done, what is open and what comes next.](../assets/use-run-dark.svg#gh-dark-mode-only)

- **`/aside run 3 1`** runs only those steps, in that order.
- **With no step left to do**, `/aside run` runs the queue instead, each entry and each new tag a step of its own, and `/aside run 3 1` runs those entries.
- **`/aside run all`** sends the whole queue as one prompt, with no plan.
- **`/aside stop`** lets the step running now finish, as the last one; a step not started yet does not start.
- **`/aside log`** lists the plans run to their end once another took their place, the last 5 with what each step did, and `/aside log N` any of the 20 it keeps.

## Answer a step that asks you

A step that needs your answer or decision, such as a yes before a push, makes Claude call the wait tool. The step then waits for you: answer as usual, and Claude goes on with that same step, for as many turns as it takes. <kbd>continue</kbd> ends the step, with the time of all its turns and what the last one said, and runs the next step of the run, if there is one.

![A step that asks you waits. Step 2 asks for a yes, and the line above the prompt says waits for you. Your answer, yes, build it, goes to that same step, which builds it while the line says step 2 running. continue then ends step 2 and runs step 3.](../assets/use-waiting-light.svg#gh-light-mode-only)
![A step that asks you waits. Step 2 asks for a yes, and the line above the prompt says waits for you. Your answer, yes, build it, goes to that same step, which builds it while the line says step 2 running. continue then ends step 2 and runs step 3.](../assets/use-waiting-dark.svg#gh-dark-mode-only)

- **The line above the prompt** says `step 2 running` while Claude works and `step 2 waits for you` in between, with a <kbd>continue</kbd> button.
- **The last step of a run** sums the run up only once <kbd>continue</kbd> ends it, in one more short turn.
- **`/aside stop`** on a step that waits ends it as it stands, and the run stops there.
- **A turn you interrupt** after the step has asked leaves it waiting, with its time and its last result. A step interrupted before it asks stops the plan and is to do again.

## Let aside act when Claude answers

By default the queue just waits. The `afterClaudeAnswers` setting makes <kbd>aside</kbd> hand it over by itself once Claude finishes a reply: `plan` organizes it into steps, as `/aside plan` does, and `run all` sends it as one prompt. It never does so after its own prompts, while a step runs or waits, or while the plan has steps to do.

## Keep ideas for no project

Some ideas belong to no project. `+g` puts one on the global list and `+@work` in the queue named `work`, made by its first idea. They wait in every project: the line above the prompt counts them, as in `1 global, 2 @work`, but `/aside`, plan and run leave them out until you bring an idea into the project's queue.

![Three queues: the global list, +g, this project's queue and a named queue, +@work. /aside g here 1 brings an idea from the global list into this project's queue and /aside g add 1 sends one back; /aside q work here 1 and /aside q work add 1 do the same with the queue named work. They wait in every project, counted above the prompt.](../assets/use-queues-light.svg#gh-light-mode-only)
![Three queues: the global list, +g, this project's queue and a named queue, +@work. /aside g here 1 brings an idea from the global list into this project's queue and /aside g add 1 sends one back; /aside q work here 1 and /aside q work add 1 do the same with the queue named work. They wait in every project, counted above the prompt.](../assets/use-queues-dark.svg#gh-dark-mode-only)

- **`/aside q`** lists the global list and every named queue, with its count and newest idea.
- **`/aside g`** and **`/aside q work`** show one, and take the commands the queue does: `remove`, `edit`, `pop`, `move` and `clear`. Their `undo` brings back what this session's last `clear` of that list took.
- **`/aside q work rename office`** moves a queue to another name, merging it with any ideas already there.
- **`/aside q work local`** keeps a queue for this project alone, so other projects no longer see it, and `global` shares it again; the `newQueues` setting says which a queue made by its first idea is.

## Work in several sessions at once

Every session on the machine shares one store. Each project, the folder a session started in, has its own queue and plan, and every session in that folder sees them; the global list and the named queues are shared by all projects.

![Three sessions: A and B in project X, C in project Y. They share Claude Code's store on this machine, which holds each project's queue and plan, and the global list and named queues, one key per idea, which every project shares.](../assets/use-sessions-light.svg#gh-light-mode-only)
![Three sessions: A and B in project X, C in project Y. They share Claude Code's store on this machine, which holds each project's queue and plan, and the global list and named queues, one key per idea, which every project shares.](../assets/use-sessions-dark.svg#gh-dark-mode-only)

- **Ideas added at once** to the global list and the named queues never overwrite each other, as each idea there is stored on its own. A project's queue is one list, so two of its sessions adding at the very same moment can lose one of the ideas.
- **A step runs in the session that started it.** In another session, `/aside run` takes the plan over and sends that step again there, and `/aside stop` lets it go, to do again; what its turn does in the first session is then not kept.
- **A step that waits** can be ended with `/aside continue` from any session, after `/clear` too, and the run goes on in that session; only the session it asked in takes your answer as the step's.
