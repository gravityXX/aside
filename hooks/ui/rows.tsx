import type { Elements, RenderSurface } from 'claude-code'

import type { ListingSection } from '../core/listing'

// Where aside draws: the terminal and Claude Code Desktop. VS Code attaches no surface yet and
// the mobile app draws nothing a plugin draws, so there the engine draws its own.
const SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']

export const isDrawnOn = (surface: RenderSurface) => SURFACES.includes(surface)

// The elements aside draws with; Box and Text are the same on every surface.
export type Drawing = Pick<Elements['terminal'], 'Box' | 'Text'>

// The colour of each kind, from the theme, so it suits light and dark alike.
const WORD_COLOURS: Record<string, string> = {
  idea: 'suggestion',
  question: 'warning',
  change: 'autoAccept',
  drop: 'error',
  'dig deeper': 'success',
}

// A step's mark on the plan's line, in its state's colour: done, running, waiting for the
// person, still to do.
const STEP_MARKS: Record<string, { mark: string; colour?: string }> = {
  done: { mark: '✓', colour: 'success' },
  running: { mark: '▶', colour: 'warning' },
  waiting: { mark: '?', colour: 'suggestion' },
  'to do': { mark: '○' },
}

// A section of steps, as planSection makes it: every row a step's state.
const isPlanSection = (section: ListingSection) => section.rows.length > 0 && section.rows.every(row => row.word in STEP_MARKS)

// The plan as a line of steps, top to bottom: each step's mark, its number and title, and
// under it, on the line that joins it to the next, what it took and what it said. A double
// line marks where a step paused the run, or the step that waits for the person.
const planRows = ({ Box, Text }: Drawing, section: ListingSection) => {
  const pausedAfter = /^Plan paused after step (\d+)/.exec(section.title)?.[1]

  return section.rows.map((row, n) => {
    const { mark, colour } = STEP_MARKS[row.word]!
    const isLast = n === section.rows.length - 1
    const isWaiting = row.word === 'waiting'
    const join = row.label === pausedAfter || isWaiting ? '║' : isLast ? ' ' : '│'
    const under = [...row.lines.slice(1), ...row.about.map(about => `↳ ${about}`)].map(line => line.trim()).filter(line => line !== '')
    if (row.label === pausedAfter) under.push('paused here: /aside continue')
    if (isWaiting) under.push('waits for you here: /aside continue ends it')

    return (
      <Box flexDirection="column" marginTop={n === 0 ? 1 : 0}>
        <Box>
          <Box width={3} flexShrink={0}>
            <Text color={colour} dimColor={colour === undefined}>{mark}</Text>
          </Box>
          <Box width={4} flexShrink={0}>
            <Text dimColor>{row.label}</Text>
          </Box>
          <Box flexShrink={1}>
            <Text dimColor={row.word === 'done'}>{row.lines[0]?.trim() ?? ''}</Text>
          </Box>
          {/* The state in a box of its own, so a long title wraps and the word stays whole. */}
          {row.word === 'running' || isWaiting ? (
            <Box flexShrink={0} marginLeft={1}>
              <Text color={colour}>{row.word}</Text>
            </Box>
          ) : null}
        </Box>
        {under.map(line => (
          <Box>
            <Box width={7} flexShrink={0}>
              <Text dimColor>{join}</Text>
            </Box>
            <Box flexShrink={1}>
              <Text dimColor>{line}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}

// The sections of a listing: the queue and the tags in columns, number, kind in its colour,
// then the text, wrapped in its own column, and what it is about; the plan as a line of
// steps. Each line is drawn trimmed and blank ones are left out, as they are when the
// listing is read back from the printed text.
export const listingRows = (ui: Drawing, sections: readonly ListingSection[]) =>
  sections.map((section, i) => {
    const { Box, Text } = ui
    const width = Math.max(0, ...section.rows.map(row => row.word.length))

    return (
      <Box flexDirection="column" marginTop={i === 0 ? 0 : 1}>
        <Box>
          {i === 0 ? <Text bold color="claude">aside  </Text> : null}
          <Text bold>{section.title}</Text>
        </Box>
        {isPlanSection(section)
          ? planRows(ui, section)
          : section.rows.map((row, n) => (
              <Box marginTop={n === 0 ? 1 : 0}>
                <Box width={5} flexShrink={0}>
                  <Text dimColor>{row.label.padStart(3)}</Text>
                </Box>
                <Box width={width + 2} flexShrink={0}>
                  <Text color={WORD_COLOURS[row.word] ?? 'text'}>{row.word}</Text>
                </Box>
                <Box flexDirection="column" flexShrink={1}>
                  {row.lines
                    .map(line => line.trim())
                    .filter(line => line !== '')
                    .map(line => (
                      <Text dimColor={row.word === 'done'}>{line}</Text>
                    ))}
                  {row.about.map(about => (
                    <Text dimColor>{`↳ ${about}`}</Text>
                  ))}
                </Box>
              </Box>
            ))}
      </Box>
    )
  })
