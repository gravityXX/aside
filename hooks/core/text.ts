// Lower case, without diacritics, ł as l: how two spellings of a word are compared.
const foldText = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase()

export const splitWords = (s: string): string[] => foldText(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

export const slugify = (s: string) => splitWords(s).join('-')

export const shortenText = (text: string, room = 40): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= room ? line : `${line.slice(0, room - 1).trimEnd()}…`
}

export const relativePath = (path: string, root: string): string =>
  path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path

const PLURALS = { idea: 'ideas', comment: 'comments', tag: 'tags', step: 'steps', entry: 'entries' } as const

export const formatCount = (n: number, noun: keyof typeof PLURALS): string => `${n} ${n === 1 ? noun : PLURALS[noun]}`
