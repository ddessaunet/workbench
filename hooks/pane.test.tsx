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
    expect((await ui.find({ type: 'Text', text: /CI failing/ }))?.text).toBe('CI failing')
    expect((await ui.find({ type: 'Text', text: /payment retries/ }))?.text).toBe(
      'Add payment retries',
    )
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: `start-${REPO}#retry-stuck-requests` })
  expect(prompts[0]).toContain(`in ${REPO},`)
  expect(prompts[0]).toContain('Add a retry action.')
  expect(Object.keys(store.get('started') as object)).toEqual([`${REPO}#retry-stuck-requests`])
  expect((await ui.find({ type: 'Text', text: /started/ }))?.text).toBe('started just now')

  await ui.press({ key: 'do-review-https://github.com/team/portal/pull/12' })
  expect(prompts[1]).toContain('team/portal#12')
  await ui.unmount()
})
