import type { EngineInterface as Engine, MatchedHook } from 'claude-code'

import type { Context } from '../context'
import { formatCount } from '../core/text'
import { runPlan, stopPlan } from '../features/plan'
import { readBand } from '../io/store'
import { toggleListPane } from './pane'

type Action = 'stop' | 'list' | 'run plan'

// The press does the work itself: $.command.run from here skips this plugin's own command
// hook, and a stop is applied at once rather than when the turn ends.
async function pressBand($: Engine, ctx: Context, action: Action) {
  if (action === 'list') {
    await toggleListPane($)
    return
  }
  const said = action === 'stop' ? await stopPlan($) : await runPlan($, ctx)
  if (said !== undefined) $.ui.toast(said)
}

// The line above the prompt: what waits, where the plan is, and a button for the next move.
type BandRender = Parameters<MatchedHook<'ui.render', { readonly component: 'AbovePrompt' }>>

export async function drawBand(ctx: Context, $: Engine, e: BandRender[1], next: BandRender[2]) {
  const now = await readBand($)
  const waiting = now.ideas + now.comments + now.tags
  const left = now.steps - now.done
  if (e.props.hasSurvey || (waiting === 0 && left === 0 && now.running === undefined)) {
    return next(e)
  }

  const parts: string[] = []
  if (now.running !== undefined) parts.push(`step ${now.running}/${now.steps} running`)
  else if (left > 0) parts.push(`plan: ${left} of ${now.steps} steps left`)
  if (now.ideas) parts.push(formatCount(now.ideas, 'idea'))
  if (now.comments + now.tags) parts.push(formatCount(now.comments + now.tags, 'comment'))
  const action: Action = now.running !== undefined ? 'stop' : waiting > 0 ? 'list' : 'run plan'

  const { Box, Button, Text } = $.ui.resolve(e)

  return (
    <Box>
      <Text dimColor>aside: {parts.join(', ')} · </Text>
      <Button key="queue" label={action} onPress={() => void pressBand($, ctx, action)} />
    </Box>
  )
}
