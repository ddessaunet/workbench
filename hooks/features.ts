import type { Feature } from '../types'

export function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

// A `.claude/features.md` is a markdown checklist: `- [ ] Title` starts an
// item, `- [x]` marks it done, and the indented lines under it are its brief.
// Anything else (headings, prose) is ignored and ends the item above it.
export function parseFeatures(text: string): Feature[] {
  const items: Feature[] = []
  let current: Feature | null = null

  for (const line of text.split('\n')) {
    const item = /^[-*] \[([ xX])\] (.+)$/.exec(line)
    if (item) {
      const title = (item[2] ?? '').trim()
      current = { id: slug(title), title, brief: '', isDone: item[1] !== ' ' }
      items.push(current)
    } else if (current && /^\s+\S/.test(line)) {
      current.brief = current.brief ? `${current.brief}\n${line.trim()}` : line.trim()
    } else if (line.trim() !== '') {
      current = null
    }
  }

  return items
}

// The lines of the first open item with this id, its brief included, as
// parseFeatures reads them: [start, end). Null when there is none.
function openItemSpan(lines: string[], id: string): [number, number] | null {
  let span: [number, number] | null = null
  let isInItem = false

  for (const [i, line] of lines.entries()) {
    const item = /^[-*] \[([ xX])\] (.+)$/.exec(line)
    if (item) {
      if (span) return span
      isInItem = true
      if (item[1] === ' ' && slug((item[2] ?? '').trim()) === id) span = [i, i + 1]
    } else if (isInItem && /^\s+\S/.test(line)) {
      if (span) span[1] = i + 1
    } else if (line.trim() !== '') {
      if (span) return span
      isInItem = false
    }
  }

  return span
}

// The list with that open item marked `[x]`; null when it is not there.
export function markDone(text: string, id: string): string | null {
  const lines = text.split('\n')
  const span = openItemSpan(lines, id)
  if (!span) return null
  lines[span[0]] = (lines[span[0]] ?? '').replace(/^([-*]) \[ \]/, '$1 [x]')

  return lines.join('\n')
}

// The list without that open item and its brief; null when it is not there.
export function removeFeature(text: string, id: string): string | null {
  const lines = text.split('\n')
  const span = openItemSpan(lines, id)
  if (!span) return null
  lines.splice(span[0], span[1] - span[0])

  return lines.join('\n')
}

// What Create empty list writes.
export const NEW_LIST = '# Features\n'

// The pane's Add field: the first line is the title, the lines below it the
// brief. Null when there is no title.
export function parseItemInput(value: string): { title: string; brief: string } | null {
  const [title, ...brief] = value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')

  return title ? { title, brief: brief.join('\n') } : null
}

// Adds an open item at the end of a list, in the format parseFeatures reads;
// `text` null starts the file. A heading above the item gets a blank line.
export function appendFeature(text: string | null, title: string, brief: string): string {
  let head = text ?? NEW_LIST
  if (head !== '' && !head.endsWith('\n')) head += '\n'
  const last = head.trimEnd().split('\n').pop() ?? ''
  if (last.startsWith('#') && !head.endsWith('\n\n')) head += '\n'

  const lines = brief
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .map(line => `  ${line}`)

  return `${head}${[`- [ ] ${title}`, ...lines].join('\n')}\n`
}
