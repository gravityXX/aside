import type { EngineInterface as Engine, MatchedHook } from 'claude-code'

import type { Context } from '../context'
import { describeError } from '../core/text'
import { handOverQueue } from '../features/plan'
import { currentListing, LIST_PANE } from '../features/queue'
import { readBand } from '../io/store'
import { isDrawnOn, listingRows } from './rows'

// How often the list pane is drawn again while a step runs or waits.
const PANE_TICK = 10_000

// The list the band's button opens: drawn again whenever the queue or the plan changes.
type PaneRender = Parameters<MatchedHook<'ui.render', { readonly component: 'Pane'; readonly requestId: 'aside' }>>

export async function drawPane(ctx: Context, $: Engine, e: PaneRender[1], next: PaneRender[2]) {
  if (!isDrawnOn(e.surface)) {
    return next(e)
  }
  const now = await readBand($)
  const sections = await currentListing($, ctx)
  // A step's time moves on with the clock, not with the store: while one runs or waits, the
  // pane is drawn again a little later. Closed, it is not drawn, and the ticks stop.
  ctx.session.paneTick?.cancel()
  delete ctx.session.paneTick
  if (sections.some(section => section.rows.some(row => row.word === 'running' || row.word === 'waiting'))) {
    ctx.session.paneTick = $.clock.after(PANE_TICK, () => $.ui.invalidate('ui.render'))
  }
  // While a step runs, the plan button adds the queue to the plan, as /aside plan does.
  const canPlan = now.ideas + now.comments + now.tags > 0
  // The pane closes at once, as a planner may think a while; how the hand-over went, a
  // failure included, is told as a toast.
  const planFromPane = async () => {
    await $.ui.close({ id: LIST_PANE }).catch(() => undefined)
    $.ui.toast(await handOverQueue($, ctx, 'pane').catch(error => `Could not organize the queue (${describeError(error)}).`))
  }

  const ui = $.ui.resolve(e)
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="column">
      {sections.some(section => section.rows.length > 0) ? listingRows(ui, sections) : <Text dimColor>The queue is empty.</Text>}
      <Box marginTop={1}>
        {canPlan ? <Button key="plan" label="plan" onPress={() => void planFromPane()} /> : null}
        <Text> </Text>
        <Button key="close" label="close" onPress={() => void $.ui.close({ id: LIST_PANE })} />
      </Box>
    </Box>
  )
}
