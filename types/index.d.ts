export type Feature = { id: string; title: string; brief: string; isDone: boolean }

export type RepoFeature = Feature & { repoPath: string }

export type Repo = { path: string; name: string; slug: string | null }

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
      isRefreshing: boolean
      error: string | null
      // A repo's name, or 'all'.
      filter: string
      isShippedOpen: boolean
    }
  }
}
