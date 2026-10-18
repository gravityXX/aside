import type { EngineInterface as Engine, MatchedHook } from 'claude-code'

import { parseListingText } from '../core/listing'
import { listingRows } from './rows'

// The list /aside printed, drawn in a frame with colours. It is drawn from the row's own
// text, so an older listing keeps showing what it said; any other output is left as it is.
type OutputRender = Parameters<MatchedHook<'ui.render', { readonly component: 'CommandOutput' }>>

export async function drawListingFrame($: Engine, e: OutputRender[1], next: OutputRender[2]) {
  const sections = e.props.command === 'aside' && !e.props.isErrored ? parseListingText(e.props.text.replace(/^aside: /, '')) : null
  if (e.surface !== 'terminal' || sections === null) {
    return next(e)
  }

  const ui = $.ui.resolve(e)
  const { Box } = ui

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={1}>
      {listingRows(ui, sections)}
    </Box>
  )
}
