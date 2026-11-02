import type { Repo } from '../types'

// `roots` is the option as typed: comma-separated folders, `~` for home.
export function parseRoots(roots: string, home: string): string[] {
  return roots
    .split(',')
    .map(root => root.trim())
    .filter(root => root !== '')
    .map(root => (root === '~' ? home : root.replace(/^~\//, `${home}/`)))
    .map(root => root.replace(/\/+$/, ''))
}

// The `owner/name` of a GitHub remote, ssh or https; null for anything else.
export function remoteSlug(url: string): string | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())

  return match ? `${match[1]}/${match[2]}` : null
}
