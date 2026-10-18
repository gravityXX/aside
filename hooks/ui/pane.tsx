import type { EngineInterface as Engine, MatchedHook } from 'claude-code'

import type { Context } from '../context'
import { currentListing } from '../features/queue'
import { handOverQueue } from '../features/plan'
import { readBand } from '../io/store'
import { listingRows } from './rows'

// The id register.tsx names in the pane's ui.render matcher.
const LIST_PANE = 'aside'

// Opens the list pane, or closes it when it is open: the band's list button.
export async function toggleListPane($: Engine) {
  if ((await $.ui.panes()).some(pane => pane.id === LIST_PANE)) {
    await $.ui.close({ id: LIST_PANE })
    return
  }
  const opened = await $.ui.open({ id: LIST_PANE, title: 'aside', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) $.ui.toast('/aside shows the list')
}

// The list the band's button opens: drawn again whenever the queue or the plan changes.
type PaneRender = Parameters<MatchedHook<'ui.render', { readonly component: 'Pane'; readonly requestId: 'aside' }>>

export async function drawPane(ctx: Context, $: Engine, e: PaneRender[1], next: PaneRender[2]) {
  if (e.surface !== 'terminal') {
    return next(e)
  }
  const now = await readBand($)
  const sections = await currentListing($, ctx)
  const planFromPane = async () => {
    await $.ui.close({ id: LIST_PANE })
    $.ui.toast(await handOverQueue($, ctx, 'plan'))
  }

  const ui = $.ui.resolve(e)
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="column">
      {sections.some(section => section.rows.length > 0) ? listingRows(ui, sections) : <Text dimColor>The queue is empty.</Text>}
      <Box marginTop={1}>
        {now.ideas + now.comments + now.tags > 0 ? <Button key="plan" label="plan" onPress={() => void planFromPane()} /> : null}
        <Text> </Text>
        <Button key="close" label="close" onPress={() => void $.ui.close({ id: LIST_PANE })} />
      </Box>
    </Box>
  )
}
