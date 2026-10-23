// The list pane. It lists anew at each draw, so what it shows follows the queue and the plan
// without anyone telling it to.

import type { EngineInterface as Engine, MatchedHook } from 'claude-code'

import type { Context } from '../context'
import type { Listed } from '../core/listing'
import { describeError } from '../core/text'
import { foundListed } from '../features/find'
import { queueListed, queuesListed } from '../features/global'
import { logListed } from '../features/history'
import { handOverQueue } from '../features/plan'
import { currentListing, LIST_PANE } from '../features/queue'
import { readBand } from '../io/store'
import { resolveQueue } from '../io/queues'
import { isDrawnOn, listingRows } from './rows'

// How often the list pane is drawn again while a step runs or waits.
const PANE_TICK = 10_000

// The list the band's button opens: drawn again whenever the queue or the plan changes.
type PaneRender = Parameters<MatchedHook<'ui.render', { readonly component: 'Pane'; readonly requestId: 'aside' }>>

// What the pane lists for the view it shows, listed anew at each draw.
async function paneListed($: Engine, ctx: Context): Promise<Listed> {
  const view = ctx.session.paneView ?? { kind: 'queue' }
  switch (view.kind) {
    case 'named':
      // By the name typed, found again at each draw, so the pane follows the queue when it
      // moves between this project and every project.
      return queueListed($, ctx, await resolveQueue($, view.typed, ctx.settings.newQueues === 'local'))
    case 'queues':
      return queuesListed($)
    case 'find':
      return foundListed($, ctx, view.query)
    case 'log':
      return logListed($, view.n)
    case 'queue':
      return { sections: await currentListing($, ctx) }
  }
}

// The pane back on the queue, from a view a command asked for.
function showQueueInPane($: Engine, ctx: Context) {
  ctx.session.paneView = { kind: 'queue' }
  $.ui.invalidate('ui.render')
}

export async function drawPane(ctx: Context, $: Engine, e: PaneRender[1], next: PaneRender[2]) {
  if (!isDrawnOn(e.surface)) {
    return next(e)
  }
  const now = await readBand($)
  const listed = await paneListed($, ctx)
  const sections = typeof listed === 'string' ? [] : listed.sections
  const isQueue = (ctx.session.paneView?.kind ?? 'queue') === 'queue'
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
      {typeof listed === 'string' ? (
        <Text dimColor>{listed}</Text>
      ) : sections.some(section => section.rows.length > 0) ? (
        listingRows(ui, sections)
      ) : (
        <Text dimColor>The queue is empty.</Text>
      )}
      {typeof listed !== 'string' && listed.note ? <Text dimColor>{listed.note}</Text> : null}
      <Box marginTop={1}>
        {isQueue && canPlan ? <Button key="plan" label="plan" onPress={() => void planFromPane()} /> : null}
        {isQueue ? null : <Button key="queue" label="queue" onPress={() => showQueueInPane($, ctx)} />}
        <Text> </Text>
        <Button key="close" label="close" onPress={() => void $.ui.close({ id: LIST_PANE })} />
      </Box>
    </Box>
  )
}
