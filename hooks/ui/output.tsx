import type { Elements, EngineInterface as Engine, MatchedHook } from 'claude-code'

import type { Context } from '../context'
import { parseListingText } from '../core/listing'
import type { ListingSection } from '../core/listing'
import { listingRows } from './rows'

// A listing in the rounded frame /aside output is drawn in.
const frame = (ui: Elements['terminal'], sections: readonly ListingSection[]) => {
  const { Box } = ui

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="promptBorder" paddingX={1}>
      {listingRows(ui, sections)}
    </Box>
  )
}

// The list /aside printed, drawn in a frame with colours. It is drawn from the row's own
// text, so an older listing keeps showing what it said; any other output is left as it is.
type OutputRender = Parameters<MatchedHook<'ui.render', { readonly component: 'CommandOutput' }>>

export async function drawListingFrame($: Engine, e: OutputRender[1], next: OutputRender[2]) {
  const sections = e.props.command === 'aside' && !e.props.isErrored ? parseListingText(e.props.text.replace(/^aside: /, '')) : null
  if (e.surface !== 'terminal' || sections === null) {
    return next(e)
  }

  return frame($.ui.resolve(e), sections)
}

// The text of a tool's result: a string, or the text blocks of one.
const resultText = (output: unknown): string | undefined => {
  if (typeof output === 'string') {
    return output
  }
  const texts = Array.isArray(output) ? output.map(block => (block as { text?: unknown }).text).filter(text => typeof text === 'string') : []

  return texts.length > 0 ? texts.join('\n') : undefined
}

// The plan the plan tool saved, read from its row's own result, which lists it as /aside
// does; null while it runs, when it was refused, and for any other tool.
const savedPlan = (ctx: Context, tool: string, output: unknown, isDone: boolean): ListingSection[] | null => {
  const text = tool === ctx.session.planTool && isDone ? resultText(output) : undefined

  return text === undefined ? null : parseListingText(text)
}

// The plan tool's row in the transcript: the plan it saved, in the frame /aside draws.
type ToolRender = Parameters<MatchedHook<'ui.render', { readonly component: 'ToolUse' }>>

export async function drawPlanTool(ctx: Context, $: Engine, e: ToolRender[1], next: ToolRender[2]) {
  const { tool, output, isRunning, isErrored, isInterrupted } = e.props
  const sections = savedPlan(ctx, tool, output, !isRunning && !isErrored && !isInterrupted)
  if (e.surface !== 'terminal' || sections === null) {
    return next(e)
  }

  return frame($.ui.resolve(e), sections)
}

// Under that row the engine would print the same plan again as plain text: it draws nothing.
type ResultRender = Parameters<MatchedHook<'ui.render', { readonly component: 'ToolResult' }>>

export async function hidePlanToolResult(ctx: Context, $: Engine, e: ResultRender[1], next: ResultRender[2]) {
  const { tool, output, isErrored } = e.props
  if (e.surface !== 'terminal' || savedPlan(ctx, tool, output, !isErrored) === null) {
    return next(e)
  }
  const { Box } = $.ui.resolve(e)

  return <Box />
}
