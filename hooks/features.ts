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
