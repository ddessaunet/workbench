import type { Feature, Pr, Repo } from '../types'

// The pane cannot open a session itself: only Claude can, through the app.
// So each button hands the session it sits in one of these prompts.

export function startPrompt(feature: Feature, repo: Repo): string {
  const brief = feature.brief || '(no brief written yet: ask me what it should do first)'

  return [
    `Start a new session for this feature from my workbench, in ${repo.path},`,
    `in its own worktree, titled "${feature.title}". Give it the brief below,`,
    'and have it open a PR when the work is done.',
    '',
    `Feature: ${feature.title}`,
    brief,
  ].join('\n')
}

export function reviewPrompt(pr: Pr, repo: Repo | undefined): string {
  const where = repo ? `, in ${repo.path}` : ''

  return [
    `Start a new session to review pull request ${pr.repo}#${pr.number} (${pr.url})${where}.`,
    "It should read the diff against the repo's own CLAUDE.md and conventions, look for",
    'bugs first, and report its findings to me before posting anything on the PR.',
  ].join('\n')
}
