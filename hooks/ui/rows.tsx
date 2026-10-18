import type { Elements } from 'claude-code'

import type { ListingSection } from '../core/listing'

// The colour of each kind and step state, from the theme, so it suits light and dark alike.
const WORD_COLOURS: Record<string, string> = {
  idea: 'suggestion',
  question: 'warning',
  change: 'autoAccept',
  drop: 'error',
  'dig deeper': 'success',
  running: 'warning',
  done: 'success',
}

// The sections of a listing in columns: number, kind or state in its colour, then the text,
// wrapped in its own column, and what it is about. Each line is drawn trimmed and blank ones
// are left out, as they are when the listing is read back from the printed text.
export const listingRows = ({ Box, Text }: Elements['terminal'], sections: readonly ListingSection[]) =>
  sections.map((section, i) => {
    const width = Math.max(0, ...section.rows.map(row => row.word.length))

    return (
      <Box flexDirection="column" marginTop={i === 0 ? 0 : 1}>
        <Box>
          {i === 0 ? <Text bold color="claude">aside  </Text> : null}
          <Text bold>{section.title}</Text>
        </Box>
        {section.rows.map((row, n) => (
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
