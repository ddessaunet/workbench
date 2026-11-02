import type { Ci, Pr, Prs } from '../types'

const FIELDS = `number title url isDraft repository { nameWithOwner } author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`

// One call for all three lists, across every repository on GitHub, so a repo
// that is not cloned here still shows its review requests.
const QUERY = `query($mine: String!, $review: String!, $merged: String!) {
  mine: search(query: $mine, type: ISSUE, first: 30) { nodes { ... on PullRequest { ${FIELDS} } } }
  review: search(query: $review, type: ISSUE, first: 30) { nodes { ... on PullRequest { ${FIELDS} } } }
  merged: search(query: $merged, type: ISSUE, first: 30) { nodes { ... on PullRequest { ${FIELDS} } } }
}`

// `since` is a date, `YYYY-MM-DD`: merged PRs from then on count as shipped.
export function searchArgv(since: string): string[] {
  return [
    'gh', 'api', 'graphql',
    '-f', `query=${QUERY}`,
    '-f', 'mine=is:pr is:open author:@me archived:false sort:updated-desc',
    '-f', 'review=is:pr is:open review-requested:@me archived:false sort:updated-desc',
    '-f', `merged=is:pr is:merged author:@me merged:>=${since} sort:updated-desc`,
  ]
}

function ci(state: unknown): Ci {
  if (state === 'SUCCESS') return 'passing'
  if (state === 'FAILURE' || state === 'ERROR') return 'failing'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'

  return null
}

type Node = {
  number?: number
  title?: string
  url?: string
  isDraft?: boolean
  repository?: { nameWithOwner?: string }
  author?: { login?: string } | null
  commits?: { nodes?: { commit?: { statusCheckRollup?: { state?: string } | null } }[] }
}

function toPrs(nodes: Node[] | undefined): Pr[] {
  return (nodes ?? [])
    .filter(node => typeof node.number === 'number' && node.repository?.nameWithOwner)
    .map(node => ({
      repo: node.repository?.nameWithOwner ?? '',
      number: node.number ?? 0,
      title: node.title ?? '',
      url: node.url ?? '',
      isDraft: node.isDraft ?? false,
      ci: ci(node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state),
      author: node.author?.login ?? '',
    }))
}

export function parsePrs(stdout: string): Prs {
  const data = (JSON.parse(stdout) as { data?: Record<string, { nodes?: Node[] }> }).data ?? {}

  return {
    mine: toPrs(data.mine?.nodes),
    review: toPrs(data.review?.nodes),
    merged: toPrs(data.merged?.nodes),
  }
}
