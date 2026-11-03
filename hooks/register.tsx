import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Pr, Repo, RepoFeature } from '../types'
import {
  appendFeature,
  markDone,
  itemFields,
  NEW_LIST,
  parseFeatures,
  removeFeature,
  slug,
} from './features'
import { mergeArgv, mergeMethod, mergeSettingsArgv, parsePrs, searchArgv } from './github'
import { draftPrompt, reviewPrompt, startPrompt } from './prompts'
import { parseRoots, remoteSlug } from './repos'

const PANE = 'workbench'
const ROWS = 8
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// A refresh marked as running for longer than this is taken as gone: a hot
// reload cancels its work, but the mark is session state and survives it.
const STALE_MS = 5 * 60 * 1000

const repos = atom({ plugin: 'workbench', key: 'repos' } as const, [])
const features = atom({ plugin: 'workbench', key: 'features' } as const, [])
const prs = atom({ plugin: 'workbench', key: 'prs' } as const, null)
const started = atom({ plugin: 'workbench', key: 'started' } as const, {})
const refreshedAt = atom({ plugin: 'workbench', key: 'refreshedAt' } as const, null)
const refreshingSince = atom({ plugin: 'workbench', key: 'refreshingSince' } as const, null)
const error = atom({ plugin: 'workbench', key: 'error' } as const, null)
const filter = atom({ plugin: 'workbench', key: 'filter' } as const, 'all')
const isShippedOpen = atom({ plugin: 'workbench', key: 'isShippedOpen' } as const, false)
const adding = atom({ plugin: 'workbench', key: 'adding' } as const, null)
const removing = atom({ plugin: 'workbench', key: 'removing' } as const, null)
const merging = atom({ plugin: 'workbench', key: 'merging' } as const, null)
const expanded = atom({ plugin: 'workbench', key: 'expanded' } as const, null)

function startedKey(feature: RepoFeature): string {
  return `${feature.repoPath}#${feature.id}`
}

function repoName(slug: string): string {
  return slug.slice(slug.indexOf('/') + 1)
}

function listFile(repo: Pick<Repo, 'path'>): string {
  return `${repo.path}/.claude/features.md`
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isRunning(since: number | null, now: number): boolean {
  return since !== null && now - since < STALE_MS
}

// The first problem of a refresh, and how many more there were.
function summary(problems: string[]): string | null {
  const [first] = problems
  if (first === undefined) return null

  return problems.length > 1 ? `${first} (+${problems.length - 1} more)` : first
}

function ago(then: number | null, now: number): string {
  if (then === null) return 'not yet'
  const minutes = Math.round((now - then) / 60000)

  return minutes < 1 ? 'just now' : `${minutes} min ago`
}

// A Box draws no bottom border alone, so where the surface carries Svg a rule
// is a drawing: wider than any pane, which the surface caps at its width.
function svgRule(height: number, opacity: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="${height}"`,
    ` viewBox="0 0 2000 ${height}" preserveAspectRatio="none">`,
    `<rect width="2000" height="${height}" fill="#808080" fill-opacity="${opacity}"/></svg>`,
  ].join('')
}

const ROW_RULE = svgRule(1, 0.2)
const SECTION_RULE = svgRule(2, 0.6)

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
async function findRepos($: EngineInterface, roots: string[], problems: string[]): Promise<Repo[]> {
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

  // One repo's trouble is noted and the rest go on: it is listed without a
  // slug, so its review requests start without its path.
  const repos: Repo[] = []
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    let slug: string | null = null
    try {
      const remote = await $.process.run(['git', 'remote', 'get-url', 'origin'], { cwd: path })
      slug = remote.exitCode === 0 ? remoteSlug(remote.stdout) : null
    } catch (err) {
      problems.push(`${name}: ${message(err)}`)
    }
    repos.push({ path, name, slug, hasList: await $.fs.exists(listFile({ path })) })
  }

  return repos
}

// A list that cannot be read is noted and skipped, not the end of the refresh.
async function loadFeatures($: EngineInterface, list: Repo[], problems: string[]): Promise<RepoFeature[]> {
  const found: RepoFeature[] = []
  for (const repo of list) {
    if (!repo.hasList) continue
    try {
      for (const feature of parseFeatures(await $.fs.read(listFile(repo)))) {
        found.push({ ...feature, repoPath: repo.path })
      }
    } catch (err) {
      problems.push(`${repo.name}: ${message(err)}`)
    }
  }

  return found
}

async function refresh($: EngineInterface, roots: string): Promise<void> {
  const startedAt = await $.clock.now()
  if (isRunning(await read($, refreshingSince), startedAt)) return
  await update($, refreshingSince, () => startedAt)
  const problems: string[] = []

  try {
    const home = (await $.env.get('HOME')) ?? ''
    const found = await findRepos($, parseRoots(roots, home), problems)
    await update($, repos, () => found)
    const list = await loadFeatures($, found, problems)
    await update($, features, () => list)

    const since = new Date(startedAt - WEEK_MS).toISOString().slice(0, 10)
    try {
      const gh = await $.process.run(searchArgv(since), { timeoutMs: 30000 })
      if (gh.exitCode === 0) {
        const parsed = parsePrs(gh.stdout)
        await update($, prs, () => parsed)
      } else {
        problems.push(`gh: ${gh.stderr.trim().split('\n')[0] || `exit ${gh.exitCode}`}`)
      }
    } catch (err) {
      problems.push(`gh: ${message(err)}`)
    }
  } catch (err) {
    problems.push(message(err))
  } finally {
    await update($, error, () => summary(problems))
    const now = await $.clock.now()
    await update($, refreshedAt, () => now)
    await update($, refreshingSince, () => null)
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

// Merge asks for a second press, then merges the way the repo allows and
// refreshes, so the row leaves once GitHub has it merged.
async function merge($: EngineInterface, pr: Pr, roots: string): Promise<void> {
  if ((await read($, merging)) !== pr.url) {
    await update($, merging, () => pr.url)
    return
  }
  await update($, merging, () => null)
  const name = `${pr.repo}#${pr.number}`

  try {
    const settings = await $.process.run(mergeSettingsArgv(pr.repo), { timeoutMs: 30000 })
    const method = settings.exitCode === 0 ? mergeMethod(settings.stdout) : null
    if (!method) {
      const why = settings.stderr.trim().split('\n')[0] || 'the repo allows no merge method'
      await update($, error, () => `Merge ${name}: ${why}`)
      return
    }
    const merged = await $.process.run(mergeArgv(pr.url, method), { timeoutMs: 60000 })
    if (merged.exitCode !== 0) {
      await update($, error, () => `Merge ${name}: ${merged.stderr.trim().split('\n')[0] || `exit ${merged.exitCode}`}`)
      return
    }
  } catch (err) {
    await update($, error, () => `Merge ${name}: ${message(err)}`)
    return
  }
  await refresh($, roots)
}

// With the filter on one repo, Add goes straight to its form; else to the picker.
async function openAdd($: EngineInterface, shown: string): Promise<void> {
  const repo = (await read($, repos)).find(one => one.name === shown)
  await update($, adding, () => ({ repoPath: repo?.path ?? null, title: '', brief: '' }))
}

// Keeps one Add field's text as it is typed, so either field's Enter, or the
// Add button, adds both.
async function setDraft($: EngineInterface, field: 'title' | 'brief', value: string): Promise<void> {
  await update($, adding, held => (held ? { ...held, [field]: value } : held))
}

// Reads one repo's list again after the pane wrote it, keeping the repos' order.
async function reloadRepo($: EngineInterface, repo: Repo): Promise<void> {
  const listed = { ...repo, hasList: true }
  const problems: string[] = []
  const list = await loadFeatures($, [listed], problems)
  if (problems.length > 0) await update($, error, () => summary(problems))
  const all = await update($, repos, held => held.map(one => (one.path === repo.path ? listed : one)))
  await update($, features, held =>
    all.flatMap(one => (one.path === repo.path ? list : held.filter(f => f.repoPath === one.path))),
  )
}

// The one write the pane makes into a repo: an item at the end of its list.
async function addItem($: EngineInterface, repo: Repo): Promise<void> {
  const form = await read($, adding)
  const item = form && itemFields(form.title, form.brief)
  if (!item) {
    await update($, error, () => 'Add: the title is empty.')
    return
  }
  const id = slug(item.title)
  if ((await read($, features)).some(f => f.repoPath === repo.path && f.id === id)) {
    await update($, error, () => `${repo.name} already has "${item.title}".`)
    return
  }

  try {
    const file = listFile(repo)
    const text = (await $.fs.exists(file)) ? await $.fs.read(file) : null
    await $.fs.write(file, appendFeature(text, item.title, item.brief))
    await reloadRepo($, repo)
    await update($, adding, () => null)
    await update($, error, () => null)
  } catch (err) {
    await update($, error, () => message(err))
  }
}

// Done and Remove rewrite the item in its repo's list, then forget it was started.
async function editItem(
  $: EngineInterface,
  feature: RepoFeature,
  edit: (text: string, id: string) => string | null,
): Promise<void> {
  const repo = (await read($, repos)).find(one => one.path === feature.repoPath)
  if (!repo) return

  try {
    const next = edit(await $.fs.read(listFile(repo)), feature.id)
    if (next === null) {
      await update($, error, () => `"${feature.title}" is no longer open in ${repo.name}'s list.`)
    } else {
      await $.fs.write(listFile(repo), next)
    }
    await reloadRepo($, repo)
    await update($, removing, () => null)
    await unstart($, feature)
  } catch (err) {
    await update($, error, () => message(err))
  }
}

// Remove asks for a second press before it deletes the item and its brief.
async function remove($: EngineInterface, feature: RepoFeature): Promise<void> {
  const key = startedKey(feature)
  if ((await read($, removing)) !== key) {
    await update($, removing, () => key)
    return
  }
  await editItem($, feature, removeFeature)
}

async function createList($: EngineInterface, repo: Repo): Promise<void> {
  try {
    const file = listFile(repo)
    if (!(await $.fs.exists(file))) await $.fs.write(file, NEW_LIST)
    await reloadRepo($, repo)
  } catch (err) {
    await update($, error, () => message(err))
  }
}

async function draft($: EngineInterface, repo: Repo): Promise<void> {
  await $.prompt.submit({ text: draftPrompt(repo) })
  await update($, adding, () => null)
}

// The pane opens and polling starts once per load, when something can draw
// it. A reload starts over, its timers dropped with the old module.
let hasBegun = false

async function begin($: EngineInterface, roots: string, minutes: number): Promise<void> {
  if (hasBegun) return
  hasBegun = true
  const kept = await $.store.get('started')
  if (kept && typeof kept === 'object') {
    await update($, started, () => kept as Record<string, number>)
  }
  void $.ui.open({ id: PANE, title: 'Workbench' })
  void refresh($, roots)
  $.clock.every(Math.max(1, minutes) * 60000, () => void refresh($, roots))
}

export const register: Register = (on, options) => {
  const roots = typeof options.roots === 'string' ? options.roots : '~/repositories'
  const minutes = typeof options.refresh_minutes === 'number' ? options.refresh_minutes : 2

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'workbench',
      description: 'Open the workbench pane: features, your PRs and review requests',
    })
    // The desktop app hosts the session as the SDK does, so isInteractive is
    // false there: its surface attaches after the start, or already has when a
    // reload runs this again. A `-p` run has neither: no scans, no polling.
    if (e.isInteractive || (await $.session.surfaces()).length > 0) await begin($, roots, minutes)

    return next(e)
  })

  on('session.attach', async ($, e, next) => {
    await begin($, roots, minutes)

    return next(e)
  })

  on('command.run', { command: 'workbench' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'Workbench' })
    void refresh($, roots)

    return { text: opened.isPlaced ? 'Workbench opened.' : `Workbench not drawn: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Link } = elements
    // The mobile app draws no fields (its elements still name them, drawing
    // nothing): it gets the filter as buttons, and no Add field.
    const hasFields = e.surface !== 'mobile'
    const Select = hasFields && 'Select' in elements ? elements.Select : undefined
    const Input = hasFields && 'Input' in elements ? elements.Input : undefined
    // The terminal's table names Svg too, drawing nothing.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const now = await $.clock.now()
    const repoList = await read($, repos)
    const shown = await read($, filter)
    const startedMap = await read($, started)
    const lists = await read($, prs)
    const problem = await read($, error)
    const isShipped = await read($, isShippedOpen)
    const form = await read($, adding)
    const removingKey = await read($, removing)
    const mergingUrl = await read($, merging)
    const openRow = await read($, expanded)
    const addTo = form?.repoPath ? repoList.find(repo => repo.path === form.repoPath) : undefined

    const nameOf = (path: string) => repoList.find(repo => repo.path === path)?.name ?? path
    const inFilter = (name: string) => shown === 'all' || shown === name
    const open = (await read($, features)).filter(f => !f.isDone && inFilter(nameOf(f.repoPath)))
    const upNext = open.filter(f => startedMap[startedKey(f)] === undefined)
    const going = open.filter(f => startedMap[startedKey(f)] !== undefined)
    const mine = (lists?.mine ?? []).filter(pr => inFilter(repoName(pr.repo)))
    const toReview = (lists?.review ?? []).filter(pr => inFilter(repoName(pr.repo)))
    const shipped = (lists?.merged ?? []).filter(pr => inFilter(repoName(pr.repo)))

    const names = new Set<string>()
    for (const repo of repoList) if (repo.hasList) names.add(repo.name)
    for (const pr of [...(lists?.mine ?? []), ...(lists?.review ?? [])]) names.add(repoName(pr.repo))
    // A filtered repo that has since gone stays pickable, so the filter shows the truth.
    if (shown !== 'all') names.add(shown)
    const filterNames = ['all', ...[...names].sort()]
    const filterLabel = (name: string) => (name === 'all' ? 'All repos' : name)

    // A faint line between rows, a heavier one under a section's header; the
    // terminal draws them in box-drawing characters across the pane.
    const rule = (isSection: boolean) =>
      Svg ? (
        <Svg source={isSection ? SECTION_RULE : ROW_RULE} alt="" height={isSection ? 2 : 1} />
      ) : (
        <Text dimColor wrap="truncate-end">{(isSection ? '━' : '─').repeat(e.props.bodyColumns)}</Text>
      )
    const separated = (rows: RenderElement[]) => rows.flatMap((one, i) => (i === 0 ? [one] : [rule(false), one]))

    const header = (label: string, count: number) => (
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold>{label} </Text>
          <Text dimColor>{count}</Text>
        </Box>
        {rule(true)}
      </Box>
    )

    const itemButtons = (f: RepoFeature) => (
      <Box columnGap={1}>
        <Button key={`done-${startedKey(f)}`} label="Done" dimColor onPress={() => editItem($, f, markDone)} />
        <Button
          key={`remove-${startedKey(f)}`}
          label={removingKey === startedKey(f) ? 'Really remove' : 'Remove'}
          dimColor={removingKey !== startedKey(f)}
          onPress={() => remove($, f)}
        />
      </Box>
    )

    const ciMark = (pr: Pr) =>
      pr.isDraft ? <Text dimColor>draft</Text>
      : pr.ci === 'passing' ? <Text color="success">✓</Text>
      : pr.ci === 'failing' ? <Text color="error">✗</Text>
      : pr.ci === 'pending' ? <Text color="warning">●</Text>
      : null

    // With one repo picked, every row is in it: the repo name says nothing.
    const isFiltered = shown !== 'all'
    const prLabel = (pr: Pr) => (isFiltered ? `#${pr.number}` : `${repoName(pr.repo)}#${pr.number}`)

    // A PR row leads with its link, in a column as wide as the widest drawn,
    // so the titles after it line up.
    const drawnPrs = [...mine.slice(0, ROWS), ...toReview.slice(0, ROWS), ...(isShipped ? shipped.slice(0, ROWS) : [])]
    const leadWidth = Math.max(0, ...drawnPrs.map(pr => prLabel(pr).length))
    const prLead = (pr: Pr) => (
      <Box width={leadWidth} flexShrink={0}>
        <Link href={pr.url} label={prLabel(pr)} />
      </Box>
    )

    // One line per row, whatever the width: a toggle when the row has details
    // (its slot kept empty when not, so leads line up), the lead, the title in
    // what is left, and the status. Pressed, the details open beneath it, one
    // row at a time.
    const row = (
      key: string,
      lead: RenderElement | null,
      title: string,
      status: RenderElement | null,
      details: RenderElement | null,
      isDim = false,
    ) => {
      const isOpen = details !== null && openRow === key

      return (
        <Box key={key} flexDirection="column">
          <Box columnGap={1}>
            <Box minWidth={1} marginRight={2} flexShrink={0}>
              {details && (
                <Button
                  key={`expand-${key}`}
                  label={isOpen ? '▾' : '▸'}
                  dimColor={!isOpen}
                  onPress={() => update($, expanded, held => (held === key ? null : key))}
                />
              )}
            </Box>
            {lead}
            <Box flexGrow={1} flexShrink={1}>
              <Text dimColor={isDim} wrap="truncate-end">{title}</Text>
            </Box>
            {status}
          </Box>
          {isOpen && <Box paddingLeft={4}>{details}</Box>}
        </Box>
      )
    }

    // A feature's details: its brief, then where it is and what to do with it.
    const featureDetails = (f: RepoFeature, actions: RenderElement) => (
      <Box flexDirection="column">
        {f.brief ? <Text wrap="wrap">{f.brief}</Text> : <Text dimColor>No brief yet.</Text>}
        <Box columnGap={1} flexWrap="wrap">
          {!isFiltered && <Text dimColor>{nameOf(f.repoPath)}</Text>}
          {actions}
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column">
        {Select ? (
          <Select
            key="filter"
            label="Repo"
            options={filterNames.map(name => ({ value: name, label: filterLabel(name) }))}
            value={shown}
            onSelect={value => update($, filter, () => value)}
          />
        ) : (
          <Box flexWrap="wrap" columnGap={1}>
            {filterNames.map(name => (
              <Button
                key={`filter-${name}`}
                label={filterLabel(name)}
                dimColor={shown !== name}
                onPress={() => update($, filter, () => name)}
              />
            ))}
          </Box>
        )}

        <Box marginTop={1} columnGap={1}>
          <Text bold>Up next </Text>
          <Text dimColor>{upNext.length}</Text>
          <Button key="add-open" label="Add" dimColor onPress={() => openAdd($, shown)} />
        </Box>
        {rule(true)}
        {form && !addTo && (
          <Box flexWrap="wrap" columnGap={1}>
            <Text dimColor>Add to</Text>
            {[...repoList]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(repo => (
                <Button
                  key={`add-to-${repo.path}`}
                  label={repo.hasList ? repo.name : `${repo.name} (new)`}
                  onPress={() => update($, adding, held => ({ title: '', brief: '', ...held, repoPath: repo.path }))}
                />
              ))}
            <Button key="add-cancel" label="Cancel" dimColor onPress={() => update($, adding, () => null)} />
          </Box>
        )}
        {addTo && (
          <Box flexDirection="column">
            <Box columnGap={1}>
              <Text>{`Add to ${addTo.name}`}</Text>
              {!addTo.hasList && <Text dimColor>creates .claude/features.md</Text>}
            </Box>
            {Input ? (
              <Box flexDirection="column">
                <Input
                  key="add-title"
                  label="Title"
                  autoFocus
                  value={form?.title ?? ''}
                  submitLabel="add"
                  placeholder="Retry stuck requests"
                  onInput={value => setDraft($, 'title', value)}
                  onSubmit={async value => {
                    await setDraft($, 'title', value)
                    await addItem($, addTo)
                  }}
                />
                <Input
                  key="add-brief"
                  label="Brief"
                  rows={3}
                  value={form?.brief ?? ''}
                  submitLabel="add"
                  placeholder="What it is and why (optional)"
                  onInput={value => setDraft($, 'brief', value)}
                  onSubmit={async value => {
                    await setDraft($, 'brief', value)
                    await addItem($, addTo)
                  }}
                />
              </Box>
            ) : (
              <Text dimColor>Typing an item needs the desktop app or a terminal.</Text>
            )}
            <Box columnGap={1}>
              {Input && <Button key="add-submit" label="Add" onPress={() => addItem($, addTo)} />}
              <Button key={`draft-${addTo.path}`} label="Draft with Claude" onPress={() => draft($, addTo)} />
              {!addTo.hasList && (
                <Button
                  key={`create-${addTo.path}`}
                  label="Create empty list"
                  onPress={() => createList($, addTo)}
                />
              )}
              <Button key="add-cancel" label="Cancel" dimColor onPress={() => update($, adding, () => null)} />
            </Box>
          </Box>
        )}
        {upNext.length === 0 && <Text dimColor>Nothing queued. Press Add to queue one.</Text>}
        {separated(upNext.slice(0, ROWS).map(f =>
          row(
            `next-${startedKey(f)}`,
            null,
            f.title,
            null,
            featureDetails(
              f,
              <Box columnGap={1}>
                <Button key={`start-${startedKey(f)}`} label="Start" onPress={() => start($, f)} />
                {itemButtons(f)}
              </Box>,
            ),
          ),
        ))}

        {header('In progress', going.length + mine.length)}
        {separated([
          ...going.map(f =>
            row(
              `going-${startedKey(f)}`,
              null,
              f.title,
              <Text dimColor>{ago(startedMap[startedKey(f)] ?? null, now)}</Text>,
              featureDetails(
                f,
                <Box columnGap={1}>
                  <Button
                    key={`unstart-${startedKey(f)}`}
                    label="Back to queue"
                    dimColor
                    onPress={() => unstart($, f)}
                  />
                  {itemButtons(f)}
                </Box>,
              ),
            ),
          ),
          // Your own PR is merged where another's is reviewed; a draft has neither.
          ...mine.slice(0, ROWS).map(pr =>
            row(
              `mine-${pr.url}`,
              prLead(pr),
              pr.title,
              ciMark(pr),
              pr.isDraft ? null : (
                <Box columnGap={1}>
                  <Button
                    key={`merge-${pr.url}`}
                    label={mergingUrl === pr.url ? 'Really merge' : 'Merge'}
                    dimColor={mergingUrl !== pr.url}
                    onPress={() => merge($, pr, roots)}
                  />
                </Box>
              ),
            ),
          ),
        ])}

        {header('Needs your review', toReview.length)}
        {toReview.length === 0 && <Text dimColor>No review requests.</Text>}
        {separated(toReview.slice(0, ROWS).map(pr =>
          row(
            `review-${pr.url}`,
            prLead(pr),
            pr.title,
            null,
            <Box columnGap={1}>
              <Text dimColor>{pr.author}</Text>
              <Button key={`do-review-${pr.url}`} label="Review" onPress={() => review($, pr)} />
            </Box>,
          ),
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
        {rule(true)}
        {isShipped &&
          separated(shipped.slice(0, ROWS).map(pr =>
            row(
              `shipped-${pr.url}`,
              prLead(pr),
              pr.title,
              null,
              null,
              true,
            ),
          ))}

        <Box marginTop={1} columnGap={1}>
          <Text dimColor>
            {isRunning(await read($, refreshingSince), now)
              ? 'Refreshing…'
              : `Updated ${ago(await read($, refreshedAt), now)}`}
          </Text>
          <Button key="refresh" label="Refresh" dimColor onPress={() => refresh($, roots)} />
        </Box>
        {problem && <Text color="error">{problem}</Text>}
      </Box>
    )
  })
}
