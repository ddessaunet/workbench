import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'workbench',
  component: 'Pane',
  requestId: 'workbench',
  props: {
    title: 'Workbench',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const REPO = '/home/me/repositories/personal/stack'

const FEATURES = ['- [ ] Retry stuck requests', '  Add a retry action.', '- [x] Old thing'].join('\n')

const GH = JSON.stringify({
  data: {
    mine: {
      nodes: [
        {
          number: 86,
          title: 'add maintainerr',
          url: 'https://github.com/me/stack/pull/86',
          isDraft: false,
          repository: { nameWithOwner: 'me/stack' },
          author: { login: 'me' },
          commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
        },
      ],
    },
    review: {
      nodes: [
        {
          number: 12,
          title: 'Add payment retries',
          url: 'https://github.com/team/portal/pull/12',
          isDraft: false,
          repository: { nameWithOwner: 'team/portal' },
          author: { login: 'teammate' },
          commits: { nodes: [] },
        },
      ],
    },
    merged: { nodes: [] },
  },
})

test('the pane lists features, PRs and reviews, and Start hands Claude a prompt', async ($, on) => {
  // Nothing sits beneath the plugin: each hook here stands for the engine.
  mock.clock(on)
  const prompts: string[] = []
  const store = new Map<string, unknown>()

  on('command.register', () => ({ value: { command: 'workbench' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/me' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({
    value: e.path === `${REPO}/.git` || e.path === `${REPO}/.claude/features.md`,
  }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/home/me/repositories'
        ? [{ name: 'personal', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
        : e.path === '/home/me/repositories/personal'
          ? [{ name: 'stack', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
          : [],
  }))
  on('fs.read', () => ({ value: FEATURES }))
  on('process.run', (_, e) => ({
    value:
      e.argv[0] === 'git'
        ? { exitCode: 0, stdout: 'git@github.com:me/stack.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 0, stdout: GH, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Retry stuck requests/ }))?.text).toBe(
      'Retry stuck requests',
    )
    expect(await ui.find({ type: 'Text', text: /Old thing/ })).toBe(undefined)
    expect((await ui.find({ type: 'Text', text: '✗' }))?.props.color).toBe('error')
    expect((await ui.find({ type: 'Text', text: /payment retries/ }))?.text).toBe(
      'Add payment retries',
    )
    await ui.unmount()
  }

  // A row is one line until its toggle opens its brief and buttons beneath it.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Add a retry action/ })).toBe(undefined)
    expect(await ui.find({ key: `start-${REPO}#retry-stuck-requests` })).toBe(undefined)
    await ui.press({ key: `expand-next-${REPO}#retry-stuck-requests` })
    expect((await ui.find({ type: 'Text', text: /Add a retry action/ }))?.text).toBe('Add a retry action.')
    expect((await ui.find({ key: `start-${REPO}#retry-stuck-requests` }))?.text).toBe('Start')
    await ui.press({ key: `expand-next-${REPO}#retry-stuck-requests` })
    expect(await ui.find({ key: `start-${REPO}#retry-stuck-requests` })).toBe(undefined)
    // The PR's link leads, in a column as wide as the widest label (portal#12).
    const mine = await ui.find({ key: 'mine-https://github.com/me/stack/pull/86' })
    expect(mine?.text.startsWith('stack#86')).toBe(true)
    expect(await ui.find({ type: 'Box', text: /^stack#86$/ })).toMatchObject({ props: { width: 9 } })
    await ui.unmount()
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Link', text: /#12/ }))?.text).toBe('portal#12')
    await ui.select({ key: 'filter', value: 'portal' })
    expect(await ui.find({ type: 'Text', text: /Retry stuck requests/ })).toBe(undefined)
    expect((await ui.find({ type: 'Text', text: /payment retries/ }))?.text).toBe('Add payment retries')
    // Filtered to one repo, rows drop its name.
    expect((await ui.find({ type: 'Link', text: /#12/ }))?.text).toBe('#12')
    await ui.select({ key: 'filter', value: 'all' })
    expect((await ui.find({ type: 'Text', text: /Retry stuck requests/ }))?.text).toBe('Retry stuck requests')
    await ui.unmount()
  }

  // The mobile app draws no Select: the filter falls back to buttons.
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile' })
  await phone.press({ key: 'filter-portal' })
  expect(await phone.find({ type: 'Text', text: /Retry stuck requests/ })).toBe(undefined)
  await phone.press({ key: 'filter-all' })
  await phone.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `expand-next-${REPO}#retry-stuck-requests` })
  await ui.press({ key: `start-${REPO}#retry-stuck-requests` })
  expect(prompts[0]).toContain(`in ${REPO},`)
  expect(prompts[0]).toContain('Add a retry action.')
  expect(Object.keys(store.get('started') as object)).toEqual([`${REPO}#retry-stuck-requests`])
  expect((await ui.find({ key: `going-${REPO}#retry-stuck-requests` }))?.text).toContain('just now')

  await ui.press({ key: 'expand-review-https://github.com/team/portal/pull/12' })
  await ui.press({ key: 'do-review-https://github.com/team/portal/pull/12' })
  expect(prompts[1]).toContain('team/portal#12')
  await ui.unmount()
})

test('Add writes an item into a repo list, Create starts one, Draft hands Claude a prompt', async ($, on) => {
  mock.clock(on)
  const EMPTY = '/home/me/repositories/personal/empty'
  const prompts: string[] = []
  const files = new Map<string, string>([[`${REPO}/.claude/features.md`, FEATURES]])
  const empty = { exitCode: 0, stdout: '{"data":{}}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

  on('command.register', () => ({ value: { command: 'workbench' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/me' }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({ value: e.path === `${REPO}/.git` || e.path === `${EMPTY}/.git` || files.has(e.path) }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/home/me/repositories'
        ? [{ name: 'personal', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
        : e.path === '/home/me/repositories/personal'
          ? [
              { name: 'stack', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
              { name: 'empty', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
            ]
          : [],
  }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('process.run', () => ({ value: empty }))
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'add-open' })
    await ui.press({ key: `add-to-${EMPTY}` })
    expect((await ui.find({ type: 'Text', text: /Add to/ }))?.text).toBe('Add to empty')
    expect((await ui.find({ type: 'Text', text: /creates/ }))?.text).toBe('creates .claude/features.md')
    await ui.press({ key: 'add-cancel' })
    expect(await ui.find({ type: 'Text', text: /Add to/ })).toBe(undefined)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'add-open' })
  await ui.press({ key: `add-to-${EMPTY}` })
  await ui.press({ key: `create-${EMPTY}` })
  expect(files.get(`${EMPTY}/.claude/features.md`)).toBe('# Features\n')
  expect(await ui.find({ type: 'Text', text: /creates/ })).toBe(undefined)

  await $.ui.input({ plugin: 'workbench', key: 'add-item', text: 'New thing\nIts brief.' })
  expect(files.get(`${EMPTY}/.claude/features.md`)).toBe('# Features\n\n- [ ] New thing\n  Its brief.\n')
  expect((await ui.find({ type: 'Text', text: /New thing/ }))?.text).toBe('New thing')
  expect(await ui.find({ type: 'Text', text: /Add to/ })).toBe(undefined)

  await ui.press({ key: 'add-open' })
  await ui.press({ key: `add-to-${REPO}` })
  await $.ui.input({ plugin: 'workbench', key: 'add-item', text: 'Retry stuck requests' })
  expect(files.get(`${REPO}/.claude/features.md`)).toBe(FEATURES)
  expect((await ui.find({ type: 'Text', text: /already has/ }))?.text).toBe(
    'stack already has "Retry stuck requests".',
  )

  await ui.press({ key: `draft-${REPO}` })
  expect(prompts[0]).toContain(`${REPO}/.claude/features.md`)
  expect(await ui.find({ type: 'Text', text: /Add to/ })).toBe(undefined)
  await ui.unmount()
})

test('Done marks an item [x] and Remove, pressed twice, deletes it with its brief', async ($, on) => {
  mock.clock(on)
  const file = `${REPO}/.claude/features.md`
  const list = ['# Features', '', '- [ ] Retry stuck requests', '  Add a retry action.', '- [ ] Second item', '  Its brief.', '- [x] Old thing', ''].join('\n')
  const files = new Map<string, string>([[file, list]])
  const store = new Map<string, unknown>()
  const empty = { exitCode: 0, stdout: '{"data":{}}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

  on('command.register', () => ({ value: { command: 'workbench' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/me' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: e.path === `${REPO}/.git` || files.has(e.path) }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/home/me/repositories'
        ? [{ name: 'personal', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
        : e.path === '/home/me/repositories/personal'
          ? [{ name: 'stack', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
          : [],
  }))
  on('fs.read', (_, e) => ({ value: files.get(e.path) ?? '' }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)

    return { value: undefined }
  })
  on('process.run', () => ({ value: empty }))
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // A heavy rule under each of the four headers, a faint one between the two
  // queued items: characters on the terminal, drawings on the desktop.
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.findAll({ type: 'Text', text: '━'.repeat(60) })).toHaveLength(4)
  expect(await terminal.findAll({ type: 'Text', text: '─'.repeat(60) })).toHaveLength(1)
  await terminal.unmount()
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const rules = await desktop.findAll({ type: 'Svg' })
  expect(rules.map(svg => svg.props.height)).toEqual([2, 1, 2, 2, 2])
  await desktop.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: `expand-next-${REPO}#retry-stuck-requests` })
    expect((await ui.find({ key: `done-${REPO}#retry-stuck-requests` }))?.text).toBe('Done')
    expect((await ui.find({ key: `remove-${REPO}#retry-stuck-requests` }))?.text).toBe('Remove')
    await ui.press({ key: `expand-next-${REPO}#retry-stuck-requests` })
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `expand-next-${REPO}#retry-stuck-requests` })
  await ui.press({ key: `done-${REPO}#retry-stuck-requests` })
  expect(files.get(file)).toBe(list.replace('- [ ] Retry', '- [x] Retry'))
  expect(await ui.find({ type: 'Text', text: /Retry stuck requests/ })).toBe(undefined)

  // Started first, so Remove from In progress also forgets the start.
  await ui.press({ key: `expand-next-${REPO}#second-item` })
  await ui.press({ key: `start-${REPO}#second-item` })
  expect(Object.keys(store.get('started') as object)).toEqual([`${REPO}#second-item`])
  await ui.press({ key: `expand-going-${REPO}#second-item` })
  await ui.press({ key: `remove-${REPO}#second-item` })
  expect(files.get(file)).toBe(list.replace('- [ ] Retry', '- [x] Retry'))
  expect((await ui.find({ key: `remove-${REPO}#second-item` }))?.text).toBe('Really remove')

  await ui.press({ key: `remove-${REPO}#second-item` })
  expect(files.get(file)).toBe(['# Features', '', '- [x] Retry stuck requests', '  Add a retry action.', '- [x] Old thing', ''].join('\n'))
  expect(await ui.find({ type: 'Text', text: /Second item/ })).toBe(undefined)
  expect(store.get('started')).toEqual({})
  await ui.unmount()
})

const ran = (stdout: string) => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

test('a refresh that never ends stops blocking the next ones once it is stale', async ($, on) => {
  // As a hot reload leaves it: marked running in session state, never finishing.
  const clock = mock.clock(on)
  let ghCalls = 0

  on('command.register', () => ({ value: { command: 'workbench' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/me' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', async () => {
    ghCalls += 1
    if (ghCalls === 1) await clock.sleep(60 * 60 * 1000)

    return { value: ran('{"data":{}}') }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(0)
  expect(ghCalls).toBe(1)

  // The 2-minute timer fires at 2 and 4 minutes; the first refresh still holds.
  await clock.advance(4 * 60 * 1000)
  expect(ghCalls).toBe(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Refreshing/ }))?.text).toBe('Refreshing…')

  // At 6 minutes it is past five: taken as gone, and the timer's refresh runs.
  await clock.advance(2 * 60 * 1000)
  expect(ghCalls).toBe(2)
  expect((await ui.find({ type: 'Text', text: /Updated/ }))?.text).toBe('Updated just now')
  await ui.unmount()
  // Let the first one end, so nothing is left waiting when the test does.
  await clock.advance(60 * 60 * 1000)
})

test('a session nothing draws for opens nothing, scans nothing, polls nothing', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []

  on('command.register', () => {
    calls.push('command.register')

    return { value: { command: 'workbench' } }
  })
  on('ui.open', () => {
    calls.push('ui.open')

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: [] }))
  on('fs.list', () => {
    calls.push('fs.list')

    return { value: [] }
  })
  on('process.run', (_, e) => {
    calls.push(e.argv[0] ?? '')

    return { value: ran('{"data":{}}') }
  })

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await clock.advance(10 * 60 * 1000)
  expect(calls).toEqual(['command.register'])
})

test('in the desktop app the pane opens and polls once its surface attaches', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []

  on('command.register', () => {
    calls.push('command.register')

    return { value: { command: 'workbench' } }
  })
  on('ui.open', () => {
    calls.push('ui.open')

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.surfaces', () => ({ value: [] }))
  on('env.get', () => ({ value: '/home/me' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => {
    calls.push('fs.list')

    return { value: [] }
  })
  on('process.run', () => ({ value: ran('{"data":{}}') }))

  // The desktop app hosts the session as the SDK does: no surface at start.
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(calls).toEqual(['command.register'])

  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' })
  await clock.advance(1)
  expect(calls.filter(c => c === 'ui.open')).toHaveLength(1)
  const scans = calls.filter(c => c === 'fs.list').length
  expect(scans).toBeGreaterThan(0)

  // A second client attaching opens no second pane and starts no second timer.
  await $.session.attach({ surface: 'mobile', clientId: 'mobile:phone' })
  await clock.advance(2 * 60 * 1000)
  expect(calls.filter(c => c === 'ui.open')).toHaveLength(1)
  expect(calls.filter(c => c === 'fs.list').length).toBe(scans * 2)
})

test('one repo that cannot be read leaves the others and GitHub shown', async ($, on) => {
  mock.clock(on)
  const BROKEN = '/home/me/repositories/personal/broken'

  on('command.register', () => ({ value: { command: 'workbench' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/me' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.exists', (_, e) => ({
    value: [REPO, BROKEN].some(repo => e.path === `${repo}/.git` || e.path === `${repo}/.claude/features.md`),
  }))
  on('fs.list', (_, e) => ({
    value:
      e.path === '/home/me/repositories'
        ? [{ name: 'personal', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
        : e.path === '/home/me/repositories/personal'
          ? [
              { name: 'broken', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
              { name: 'stack', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
            ]
          : [],
  }))
  on('fs.read', (_, e) => {
    if (e.path.startsWith(BROKEN)) return { deny: 'EACCES: permission denied' }

    return { value: FEATURES }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] !== 'git') return { value: ran(GH) }
    if (e.init?.cwd === BROKEN) return { deny: 'git would not start' }

    return { value: ran('git@github.com:me/stack.git\n') }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Retry stuck requests/ }))?.text).toBe('Retry stuck requests')
  expect((await ui.find({ type: 'Text', text: /payment retries/ }))?.text).toBe('Add payment retries')
  expect((await ui.find({ type: 'Text', text: /^broken: / }))?.text).toMatch(
    /^broken: .*git would not start.* \(\+1 more\)$/,
  )
  await ui.unmount()
})

test('your PR has Merge where another\'s has Review; pressed twice, it merges the way its repo allows', async ($, on) => {
  mock.clock(on)
  const runs: string[][] = []
  let mergeFails = false

  on('command.register', () => ({ value: { command: 'workbench' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('env.get', () => ({ value: '/home/me' }))
  on('store.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    if (e.argv[1] === 'repo') {
      return { value: ran(JSON.stringify({ squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true })) }
    }
    if (e.argv[1] === 'pr') {
      return { value: mergeFails ? { ...ran(''), exitCode: 1, stderr: 'Pull request is not mergeable\n' } : ran('') }
    }

    return { value: ran(GH) }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const URL = 'https://github.com/me/stack/pull/86'
  const REVIEW = 'https://github.com/team/portal/pull/12'
  const merges = () => runs.filter(argv => argv[1] === 'pr')

  for (const surface of ['terminal', 'desktop'] as const) {
    runs.length = 0
    const ui = await $.ui.mount({ ...PANE, surface })
    // Another's PR is reviewed, not merged.
    await ui.press({ key: `expand-review-${REVIEW}` })
    expect((await ui.find({ key: `do-review-${REVIEW}` }))?.text).toBe('Review')
    expect(await ui.find({ key: `merge-${REVIEW}` })).toBe(undefined)
    await ui.press({ key: `expand-review-${REVIEW}` })

    // Yours is merged, not reviewed.
    await ui.press({ key: `expand-mine-${URL}` })
    expect(await ui.find({ key: `do-review-${URL}` })).toBe(undefined)
    expect((await ui.find({ key: `merge-${URL}` }))?.text).toBe('Merge')

    await ui.press({ key: `merge-${URL}` })
    expect((await ui.find({ key: `merge-${URL}` }))?.text).toBe('Really merge')
    expect(merges()).toEqual([])

    await ui.press({ key: `merge-${URL}` })
    expect(merges()).toEqual([['gh', 'pr', 'merge', URL, '--merge']])
    // Then the lists are read again.
    expect(runs.at(-1)?.[2]).toBe('graphql')
    await ui.press({ key: `expand-mine-${URL}` })
    await ui.unmount()
  }

  // GitHub's refusal is shown, and nothing is refreshed for it.
  mergeFails = true
  runs.length = 0
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `expand-mine-${URL}` })
  await ui.press({ key: `merge-${URL}` })
  await ui.press({ key: `merge-${URL}` })
  expect(runs.at(-1)?.[1]).toBe('pr')
  expect(await ui.find({ type: 'Text', text: /Merge me\/stack#86: Pull request is not mergeable/ })).toBeTruthy()
  await ui.unmount()
})
