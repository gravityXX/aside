import type { EngineInterface as Engine, MatchedHook } from 'claude-code'

import type { Context } from '../context'
import { describeError, formatCount, formatProgress } from '../core/text'
import { runPlan, stopPlan } from '../features/plan'
import { toggleListPane } from '../features/queue'
import { readBand } from '../io/store'
import { isDrawnOn } from './rows'

type Action = 'stop' | 'continue' | 'run plan'

// The press does the work itself: $.command.run from here skips this plugin's own command
// hook, and a stop is applied at once rather than when the turn ends. Continue and run plan
// are both /aside run: it goes on with a paused run, or starts one.
async function pressAction($: Engine, ctx: Context, action: Action) {
  try {
    const said = action === 'stop' ? await stopPlan($) : await runPlan($, ctx)
    if (said !== undefined) $.ui.toast(said)
  } catch (error) {
    $.ui.toast(`Could not ${action === 'stop' ? 'stop' : 'run'} the plan (${describeError(error)}).`)
  }
}

// The line above the prompt: what waits and where the plan is, the list button, and beside it
// the next move for the plan: stop while a step runs, continue while a run is paused, run plan
// while steps are left.
type BandRender = Parameters<MatchedHook<'ui.render', { readonly component: 'AbovePrompt' }>>

export async function drawBand(ctx: Context, $: Engine, e: BandRender[1], next: BandRender[2]) {
  const now = await readBand($)
  const waiting = now.ideas + now.comments + now.tags
  const left = now.steps - now.done
  if (!isDrawnOn(e.surface) || e.props.hasSurvey || (waiting === 0 && left === 0 && now.running === undefined)) {
    return next(e)
  }

  const parts: string[] = []
  const plan = `plan ${formatProgress(now.done, now.steps)}`
  if (now.running !== undefined) parts.push(`${plan} · step ${now.running} running`)
  else if (now.paused !== undefined) parts.push(`${plan} · paused after step ${now.paused}`)
  else if (left > 0) parts.push(plan)
  if (now.ideas) parts.push(formatCount(now.ideas, 'idea'))
  if (now.comments + now.tags) parts.push(formatCount(now.comments + now.tags, 'comment'))
  const action: Action | undefined =
    now.running !== undefined ? 'stop' : now.paused !== undefined ? 'continue' : left > 0 ? 'run plan' : undefined

  const { Box, Button, Text } = $.ui.resolve(e)

  return (
    <Box>
      <Text dimColor>aside: {parts.join(', ')} · </Text>
      {/* Returned, not voided: the press lasts until the pane opens, so the engine counts the open as asked. */}
      <Button key="list" label="list" onPress={() => toggleListPane($)} />
      {/* Siblings, not a fragment: the engine draws <> as a column, which put the button a line lower. */}
      {action === undefined ? null : <Text> </Text>}
      {action === undefined ? null : <Button key="action" label={action} onPress={() => void pressAction($, ctx, action)} />}
    </Box>
  )
}
