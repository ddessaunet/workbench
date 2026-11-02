import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Pr, Repo, RepoFeature } from '../types'
import { parseFeatures } from './features'
import { parsePrs, searchArgv } from './github'
import { reviewPrompt, startPrompt } from './prompts'
import { parseRoots, remoteSlug } from './repos'

const PANE = 'workbench'
const ROWS = 8
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const repos = atom({ plugin: 'workbench', key: 'repos' } as const, [])
const features = atom({ plugin: 'workbench', key: 'features' } as const, [])
const prs = atom({ plugin: 'workbench', key: 'prs' } as const, null)
const started = atom({ plugin: 'workbench', key: 'started' } as const, {})
const refreshedAt = atom({ plugin: 'workbench', key: 'refreshedAt' } as const, null)
const isRefreshing = atom({ plugin: 'workbench', key: 'isRefreshing' } as const, false)
const error = atom({ plugin: 'workbench', key: 'error' } as const, null)
const filter = atom({ plugin: 'workbench', key: 'filter' } as const, 'all')
const isShippedOpen = atom({ plugin: 'workbench', key: 'isShippedOpen' } as const, false)

function startedKey(feature: RepoFeature): string {
  return `${feature.repoPath}#${feature.id}`
}

function repoName(slug: string): string {
  return slug.slice(slug.indexOf('/') + 1)
}

function ago(then: number | null, now: number): string {
  if (then === null) return 'not yet'
  const minutes = Math.round((now - then) / 60000)

  return minutes < 1 ? 'just now' : `${minutes} min ago`
}

async function isRepo($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.exists(`${path}/.git`)
}

async function childDirs($: EngineInterface, path: string): Promise<string[]> {
  try {
    const entries = await $.fs.list(path)

    return entries
      .filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.'))
      .map(entry => `${path}/${entry.name}`)
  } catch {
    return []
  }
}

// Git repositories at a root, or one or two levels under it
// (`~/repositories/personal/pms-arr-setup`). Worktrees live under a repo's
// `.claude/`, which is hidden, so they are never listed twice.
async function findRepos($: EngineInterface, roots: string[]): Promise<Repo[]> {
  const paths: string[] = []

  for (const root of roots) {
    if (await isRepo($, root)) {
      paths.push(root)
      continue
    }
    for (const child of await childDirs($, root)) {
      if (await isRepo($, child)) {
        paths.push(child)
        continue
      }
      for (const grandchild of await childDirs($, child)) {
        if (await isRepo($, grandchild)) paths.push(grandchild)
      }
    }
  }

  const repos: Repo[] = []
  for (const path of paths) {
    const remote = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd: path })
    repos.push({
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      slug: remote.exitCode === 0 ? remoteSlug(remote.stdout) : null,
    })
  }

  return repos
}

async function loadFeatures($: EngineInterface, list: Repo[]): Promise<RepoFeature[]> {
  const found: RepoFeature[] = []
  for (const repo of list) {
    const file = `${repo.path}/.claude/features.md`
    if (!(await $.fs.exists(file))) continue
    const text = await $.fs.read(file)
    for (const feature of parseFeatures(typeof text === 'string' ? text : '')) {
      found.push({ ...feature, repoPath: repo.path })
    }
  }

  return found
}

async function refresh($: EngineInterface, roots: string): Promise<void> {
  if (await read($, isRefreshing)) return
  await update($, isRefreshing, () => true)

  try {
    const home = (await $.env.get('HOME')) ?? ''
    const found = await findRepos($, parseRoots(roots, home))
    await update($, repos, () => found)
    const list = await loadFeatures($, found)
    await update($, features, () => list)

    const since = new Date((await $.clock.now()) - WEEK_MS).toISOString().slice(0, 10)
    const gh = await $.process.run(searchArgv(since), { timeoutMs: 30000 })
    if (gh.exitCode === 0) {
      const parsed = parsePrs(gh.stdout)
      await update($, prs, () => parsed)
      await update($, error, () => null)
    } else {
      const reason = gh.stderr.trim().split('\n')[0] || `exit ${gh.exitCode}`
      await update($, error, () => `gh: ${reason}`)
    }
  } catch (err) {
    await update($, error, () => (err instanceof Error ? err.message : String(err)))
  } finally {
    const now = await $.clock.now()
    await update($, refreshedAt, () => now)
    await update($, isRefreshing, () => false)
  }
}

async function start($: EngineInterface, feature: RepoFeature): Promise<void> {
  const repo = (await read($, repos)).find(one => one.path === feature.repoPath)
  if (!repo) return
  await $.prompt.submit({ text: startPrompt(feature, repo) })
  const now = await $.clock.now()
  const next = await update($, started, map => ({ ...map, [startedKey(feature)]: now }))
  await $.store.set('started', next)
}

async function unstart($: EngineInterface, feature: RepoFeature): Promise<void> {
  const next = await update($, started, map => {
    const { [startedKey(feature)]: _, ...rest } = map

    return rest
  })
  await $.store.set('started', next)
}

async function review($: EngineInterface, pr: Pr): Promise<void> {
  const repo = (await read($, repos)).find(one => one.slug === pr.repo)
  await $.prompt.submit({ text: reviewPrompt(pr, repo) })
}

export const register: Register = (on, options) => {
  const roots = typeof options.roots === 'string' ? options.roots : '~/repositories'
  const minutes = typeof options.refresh_minutes === 'number' ? options.refresh_minutes : 2

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'workbench',
      description: 'Open the workbench pane: features, your PRs and review requests',
    })
    const kept = await $.store.get('started')
    if (kept && typeof kept === 'object') {
      await update($, started, () => kept as Record<string, number>)
    }
    void $.ui.open({ id: PANE, title: 'Workbench' })
    void refresh($, roots)
    $.clock.every(Math.max(1, minutes) * 60000, () => void refresh($, roots))

    return next(e)
  })

  on('command.run', { command: 'workbench' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Workbench' })
    void refresh($, roots)

    return { text: opened.isPlaced ? 'Workbench opened.' : `Workbench not drawn: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const now = await $.clock.now()
    const repoList = await read($, repos)
    const shown = await read($, filter)
    const startedMap = await read($, started)
    const lists = await read($, prs)
    const problem = await read($, error)
    const isShipped = await read($, isShippedOpen)

    const nameOf = (path: string) => repoList.find(repo => repo.path === path)?.name ?? path
    const inFilter = (name: string) => shown === 'all' || shown === name
    const open = (await read($, features)).filter(f => !f.isDone && inFilter(nameOf(f.repoPath)))
    const upNext = open.filter(f => startedMap[startedKey(f)] === undefined)
    const going = open.filter(f => startedMap[startedKey(f)] !== undefined)
    const mine = (lists?.mine ?? []).filter(pr => inFilter(repoName(pr.repo)))
    const toReview = (lists?.review ?? []).filter(pr => inFilter(repoName(pr.repo)))
    const shipped = (lists?.merged ?? []).filter(pr => inFilter(repoName(pr.repo)))

    const names = new Set<string>()
    for (const f of await read($, features)) names.add(nameOf(f.repoPath))
    for (const pr of [...(lists?.mine ?? []), ...(lists?.review ?? [])]) names.add(repoName(pr.repo))

    const header = (label: string, count: number) => (
      <Box marginTop={1}>
        <Text bold>{label} </Text>
        <Text dimColor>{count}</Text>
      </Box>
    )

    const ciText = (pr: Pr) =>
      pr.isDraft ? <Text dimColor>draft</Text>
      : pr.ci === 'passing' ? <Text color="success">CI passing</Text>
      : pr.ci === 'failing' ? <Text color="error">CI failing</Text>
      : pr.ci === 'pending' ? <Text color="warning">CI running</Text>
      : <Text dimColor>no CI</Text>

    return (
      <Box flexDirection="column">
        <Box flexWrap="wrap" columnGap={1}>
          {['all', ...[...names].sort()].map(name => (
            <Button
              key={`filter-${name}`}
              label={name === 'all' ? 'All repos' : name}
              dimColor={shown !== name}
              onPress={() => update($, filter, () => name)}
            />
          ))}
        </Box>

        {header('Up next', upNext.length)}
        {upNext.length === 0 && (
          <Text dimColor>Nothing queued. Add items to a repo's .claude/features.md.</Text>
        )}
        {upNext.slice(0, ROWS).map(f => (
          <Box key={`next-${startedKey(f)}`} columnGap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{f.title}</Text>
            </Box>
            <Text dimColor>{nameOf(f.repoPath)}</Text>
            <Button key={`start-${startedKey(f)}`} label="Start" onPress={() => start($, f)} />
          </Box>
        ))}

        {header('In progress', going.length + mine.length)}
        {going.map(f => (
          <Box key={`going-${startedKey(f)}`} columnGap={1}>
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{f.title}</Text>
            </Box>
            <Text dimColor>started {ago(startedMap[startedKey(f)] ?? null, now)}</Text>
            <Button
              key={`unstart-${startedKey(f)}`}
              label="Back to queue"
              dimColor
              onPress={() => unstart($, f)}
            />
          </Box>
        ))}
        {mine.slice(0, ROWS).map(pr => (
          <Box key={`mine-${pr.url}`} columnGap={1}>
            <Link href={pr.url} label={`${repoName(pr.repo)}#${pr.number}`} />
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{pr.title}</Text>
            </Box>
            {ciText(pr)}
          </Box>
        ))}

        {header('Needs your review', toReview.length)}
        {toReview.length === 0 && <Text dimColor>No review requests.</Text>}
        {toReview.slice(0, ROWS).map(pr => (
          <Box key={`review-${pr.url}`} columnGap={1}>
            <Link href={pr.url} label={`${repoName(pr.repo)}#${pr.number}`} />
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{pr.title}</Text>
            </Box>
            <Text dimColor>{pr.author}</Text>
            <Button key={`do-review-${pr.url}`} label="Review" onPress={() => review($, pr)} />
          </Box>
        ))}

        <Box marginTop={1} columnGap={1}>
          <Text bold>Shipped this week </Text>
          <Text dimColor>{shipped.length}</Text>
          <Button
            key="shipped-toggle"
            label={isShipped ? 'Hide' : 'Show'}
            dimColor
            onPress={() => update($, isShippedOpen, open => !open)}
          />
        </Box>
        {isShipped &&
          shipped.slice(0, ROWS).map(pr => (
            <Box key={`shipped-${pr.url}`} columnGap={1}>
              <Link href={pr.url} label={`${repoName(pr.repo)}#${pr.number}`} />
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor wrap="truncate-end">{pr.title}</Text>
              </Box>
            </Box>
          ))}

        <Box marginTop={1} columnGap={1}>
          <Text dimColor>
            {(await read($, isRefreshing)) ? 'Refreshing…' : `Updated ${ago(await read($, refreshedAt), now)}`}
          </Text>
          <Button key="refresh" label="Refresh" dimColor onPress={() => refresh($, roots)} />
        </Box>
        {problem && <Text color="error">{problem}</Text>}
      </Box>
    )
  })
}
