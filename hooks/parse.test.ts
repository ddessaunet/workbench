import { expect, test } from 'claude-code/testing'

import { parseFeatures, slug } from './features'
import { parsePrs, searchArgv } from './github'
import { parseRoots, remoteSlug } from './repos'

test('a features list reads items, briefs and done marks', async () => {
  const text = [
    '# Features',
    '',
    '- [ ] Retry stuck requests',
    '  Add a retry action on /requests/.',
    '  Only for requests stuck over a day.',
    '- [x] Split requests page',
    'Some prose that ends the item above.',
    '  not a brief',
    '* [ ] Diun image alerts',
  ].join('\n')

  expect(parseFeatures(text)).toEqual([
    {
      id: 'retry-stuck-requests',
      title: 'Retry stuck requests',
      brief: 'Add a retry action on /requests/.\nOnly for requests stuck over a day.',
      isDone: false,
    },
    { id: 'split-requests-page', title: 'Split requests page', brief: '', isDone: true },
    { id: 'diun-image-alerts', title: 'Diun image alerts', brief: '', isDone: false },
  ])
})

test('a slug keeps letters and digits only', async () => {
  expect(slug('  Add #88: PR screenshots!  ')).toBe('add-88-pr-screenshots')
})

test('roots expand ~ and drop blanks and trailing slashes', async () => {
  expect(parseRoots('~/repositories/, /srv/code ,, ~', '/home/me')).toEqual([
    '/home/me/repositories',
    '/srv/code',
    '/home/me',
  ])
})

test('a GitHub remote gives owner/name, ssh or https', async () => {
  expect(remoteSlug('git@github.com:ddessaunet/pms-arr-setup.git\n')).toBe('ddessaunet/pms-arr-setup')
  expect(remoteSlug('https://github.com/NRE-Product/nre-reach-app')).toBe('NRE-Product/nre-reach-app')
  expect(remoteSlug('git@gitlab.com:someone/thing.git')).toBe(null)
})

test('the search covers open, review-requested and merged PRs', async () => {
  const argv = searchArgv('2026-10-23')
  expect(argv.slice(0, 3)).toEqual(['gh', 'api', 'graphql'])
  expect(argv).toContain('merged=is:pr is:merged author:@me merged:>=2026-10-23 sort:updated-desc')
})

test('PRs map CI states and skip empty nodes', async () => {
  const node = (n: number, state: string | null, isDraft = false) => ({
    number: n,
    title: `PR ${n}`,
    url: `https://github.com/o/r/pull/${n}`,
    isDraft,
    repository: { nameWithOwner: 'o/r' },
    author: { login: 'someone' },
    commits: { nodes: [{ commit: { statusCheckRollup: state === null ? null : { state } } }] },
  })
  const stdout = JSON.stringify({
    data: {
      mine: { nodes: [node(1, 'SUCCESS'), node(2, 'FAILURE'), node(3, 'PENDING', true), {}] },
      review: { nodes: [node(4, null)] },
      merged: { nodes: [] },
    },
  })

  const prs = parsePrs(stdout)
  expect(prs.mine.map(pr => [pr.number, pr.ci, pr.isDraft])).toEqual([
    [1, 'passing', false],
    [2, 'failing', false],
    [3, 'pending', true],
  ])
  expect(prs.review[0]?.ci).toBe(null)
  expect(prs.review[0]?.author).toBe('someone')
  expect(prs.merged).toEqual([])
})
