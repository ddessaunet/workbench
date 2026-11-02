export type Feature = { id: string; title: string; brief: string; isDone: boolean }

export type RepoFeature = Feature & { repoPath: string }

// `hasList`: the repo has a `.claude/features.md`, even an empty one.
export type Repo = { path: string; name: string; slug: string | null; hasList: boolean }

export type Ci = 'passing' | 'failing' | 'pending' | null

export type Pr = {
  repo: string
  number: number
  title: string
  url: string
  isDraft: boolean
  ci: Ci
  author: string
}

export type Prs = { mine: Pr[]; review: Pr[]; merged: Pr[] }

declare module 'claude-code' {
  interface PluginState {
    workbench: {
      repos: Repo[]
      features: RepoFeature[]
      prs: Prs | null
      // `<repo path>#<feature id>` → when Start was pressed; kept in $.store too.
      started: Record<string, number>
      refreshedAt: number | null
      // When the running refresh began; null when none runs.
      refreshingSince: number | null
      error: string | null
      // A repo's name, or 'all'.
      filter: string
      isShippedOpen: boolean
      // The Add form: null closed, `repoPath` null while a repo is picked.
      adding: { repoPath: string | null } | null
      // The item whose Remove was pressed once, by its started key; a second
      // press removes it.
      removing: string | null
      // Your PR whose Merge was pressed once, by its URL; a second
      // press merges it.
      merging: string | null
      // The row whose details are open, by its key; one at a time.
      expanded: string | null
    }
  }
}
