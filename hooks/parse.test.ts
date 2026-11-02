import { expect, test } from 'claude-code/testing'

import { appendFeature, markDone, parseFeatures, parseItemInput, removeFeature, slug } from './features'
import { mergeArgv, mergeMethod, mergeSettingsArgv, parsePrs, searchArgv } from './github'
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

test('the Add field reads a title, then a brief', async () => {
  expect(parseItemInput('Retry stuck requests')).toEqual({ title: 'Retry stuck requests', brief: '' })
  expect(parseItemInput('  Retry  \n\n  Over a day.\n  Only /requests/. \n')).toEqual({
    title: 'Retry',
    brief: 'Over a day.\nOnly /requests/.',
  })
  expect(parseItemInput(' \n \n')).toBe(null)
})

test('an item is appended where parseFeatures reads it', async () => {
  expect(appendFeature(null, 'Retry', 'Over a day.\nOnly /requests/.')).toBe(
    '# Features\n\n- [ ] Retry\n  Over a day.\n  Only /requests/.\n',
  )
  expect(appendFeature('# Features\n', 'Retry', '')).toBe('# Features\n\n- [ ] Retry\n')
  expect(appendFeature('- [ ] Old', 'New', '')).toBe('- [ ] Old\n- [ ] New\n')
  expect(appendFeature('- [x] Old\n', 'New', '')).toBe('- [x] Old\n- [ ] New\n')

  const text = appendFeature('# Features\n\n- [ ] Old\n  Its brief.\n', 'New', 'Two\nlines')
  expect(parseFeatures(text).map(f => [f.title, f.brief])).toEqual([
    ['Old', 'Its brief.'],
    ['New', 'Two\nlines'],
  ])
})

test('Done marks an open item [x], Remove drops it with its brief', async () => {
  const text = [
    '# Features',
    '',
    '- [x] Retry',
    '- [ ] Retry',
    '  First line.',
    '',
    '  After a blank.',
    '* [ ] Next',
    '  Its brief.',
    'Prose.',
  ].join('\n')

  expect(markDone(text, 'retry')?.split('\n').slice(2, 4)).toEqual(['- [x] Retry', '- [x] Retry'])
  expect(markDone(text, 'next')?.split('\n')[7]).toBe('* [x] Next')
  expect(removeFeature(text, 'retry')).toBe(
    ['# Features', '', '- [x] Retry', '* [ ] Next', '  Its brief.', 'Prose.'].join('\n'),
  )
  expect(removeFeature(text, 'next')?.split('\n').slice(-2)).toEqual(['  After a blank.', 'Prose.'])
  expect(markDone(text, 'missing')).toBe(null)
  expect(removeFeature('- [x] Retry\n', 'retry')).toBe(null)
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

test('a merge takes the first method the repo allows: squash, a merge commit, a rebase', () => {
  const allowed = (squash: boolean, merge: boolean, rebase: boolean) =>
    JSON.stringify({ squashMergeAllowed: squash, mergeCommitAllowed: merge, rebaseMergeAllowed: rebase })
  expect(mergeMethod(allowed(true, true, true))).toBe('squash')
  expect(mergeMethod(allowed(false, true, true))).toBe('merge')
  expect(mergeMethod(allowed(false, false, true))).toBe('rebase')
  expect(mergeMethod(allowed(false, false, false))).toBe(null)
  expect(mergeSettingsArgv('o/r').slice(0, 4)).toEqual(['gh', 'repo', 'view', 'o/r'])
  expect(mergeArgv('https://github.com/o/r/pull/3', 'squash')).toEqual([
    'gh', 'pr', 'merge', 'https://github.com/o/r/pull/3', '--squash',
  ])
})
