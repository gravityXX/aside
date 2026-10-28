// The line above the prompt. It reads the band atom and draws it, deciding nothing: what it
// shows was counted in io/store.ts.

import type { MatchedHook } from 'claude-code'

import type { Context } from '../context'
import { describeError, formatCount, formatProgress } from '../core/text'
import { runPlan, stopPlan } from '../features/plan'
import { toggleListPane } from '../features/queue'
import { readBand } from '../io/store'
import type { Kit } from '../kit'
import { isDrawnOn } from './rows'

type Action = 'stop' | 'continue' | 'run plan'

// The press does the work itself: running the command from here would skip this plugin's own
// hook on it, and a stop is applied at once rather than when the turn ends. Continue and run plan
// are both /aside run all: it ends a step that waits and goes on, goes on with a paused run, or
// starts one.
async function pressAction($: Kit, ctx: Context, action: Action) {
  try {
    const said = action === 'stop' ? await stopPlan($, ctx) : await runPlan($, ctx)
    if (said !== undefined) $.ui.toast(said)
  } catch (error) {
    $.ui.toast(`Could not ${action === 'stop' ? 'stop' : 'run'} the plan (${describeError(error)}).`)
  }
}

// The line above the prompt: what waits and where the plan is, the list button, and beside it
// the next move for the plan: stop while a step runs, continue while a step waits for the
// person or a run is paused, run plan while steps are left.
type BandRender = Parameters<MatchedHook<'ui.render', { readonly component: 'AbovePrompt' }>>

export async function drawBand(ctx: Context, $: Kit, e: BandRender[1], next: BandRender[2]) {
  const now = await readBand($)
  const waiting = now.ideas + now.comments + now.tags
  const left = now.steps - now.done
  if (!isDrawnOn(e.surface) || e.props.hasSurvey || (waiting === 0 && left === 0 && now.running === undefined && !now.global && !now.named)) {
    return next(e)
  }

  const parts: string[] = []
  const plan = `plan ${formatProgress(now.done, now.steps)}`
  if (now.running !== undefined) parts.push(`${plan} · step ${now.running} running${now.isBackground ? ' in the background' : ''}`)
  else if (now.waiting !== undefined) parts.push(`${plan} · step ${now.waiting} waits for you`)
  else if (now.paused !== undefined) parts.push(`${plan} · paused after step ${now.paused}`)
  else if (left > 0) parts.push(plan)
  if (now.ideas) parts.push(formatCount(now.ideas, 'idea'))
  if (now.comments + now.tags) parts.push(formatCount(now.comments + now.tags, 'comment'))
  // A reminder of the ideas in the other queues, as one count: /aside q names them.
  const queues = (now.global ? 1 : 0) + (now.named?.length ?? 0)
  const elsewhere = (now.global ?? 0) + (now.named ?? []).reduce((sum, one) => sum + one.count, 0)
  if (elsewhere) parts.push(`${elsewhere} in ${queues === 1 ? 'another queue' : 'other queues'}`)
  const action: Action | undefined =
    now.running !== undefined ? 'stop' : now.waiting !== undefined || now.paused !== undefined ? 'continue' : left > 0 ? 'run plan' : undefined

  const { Box, Button, Text } = $.ui.resolve(e)

  return (
    <Box>
      <Text dimColor>aside: {parts.join(', ')} · </Text>
      {/* Returned, not voided: the press lasts until the pane opens, so the engine counts the open as asked. */}
      <Button key="list" label="list" onPress={() => toggleListPane($, ctx)} />
      {/* Siblings, not a fragment: the engine draws <> as a column, which put the button a line lower. */}
      {action === undefined ? null : <Text> </Text>}
      {action === undefined ? null : <Button key="action" label={action} onPress={() => void pressAction($, ctx, action)} />}
    </Box>
  )
}
