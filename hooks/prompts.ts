import type { Feature, Pr, Repo } from '../types'

// The pane cannot open a session itself: only Claude can, through the app.
// So a feature's prompt is copied for the owner to paste into a new session,
// and the draft and review buttons hand the session they sit in a prompt.

export function sessionPrompt(feature: Feature, repo: Repo): string {
  const brief = feature.brief || '(no brief written yet: ask me what it should do first)'

  return [
    `Work on this feature in ${repo.path}, in its own worktree, and open a PR when it is done.`,
    '',
    `Feature: ${feature.title}`,
    brief,
  ].join('\n')
}

export function draftPrompt(repo: Repo): string {
  const file = `${repo.path}/.claude/features.md`

  return [
    `Draft a feature list for ${repo.path}, here in this session; don't start a new one.`,
    "Read its README, CLAUDE.md, TODO and FIXME comments, and its open issues (gh issue list),",
    'and propose items as a markdown checklist: `- [ ] Title`, with a short brief on the',
    'indented lines below each one. Show me the items first. Once I agree, add the ones I',
    `keep to the end of ${file} (create it with a "# Features" heading if it is missing),`,
    'leaving the items already there untouched.',
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
