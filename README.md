# workbench

Daily development tools for Claude Code, as one plugin. The first is a pane beside
the chat that shows, across every repository on this machine:

- **Up next**: the open items of each repo's `.claude/features.md`, with a
  **Start** button that has Claude start a session for one, in that repo, in its own
  worktree. **Add** opens a form for a repo (the filtered one, or one you pick):
  type a title, and a brief on the lines below, and Enter adds it to that repo's
  list. **Create empty list** starts one for a repo that has none, and **Draft with
  Claude** has Claude read the repo and propose items, which it writes once you
  agree. Each row is one line; the **▸** at its start opens the brief and buttons beneath it,
  where **Done** marks the item `[x]` and **Remove**, pressed twice, deletes it and
  its brief.
- **In progress**: items you started, and your open PRs with their CI state.
  Each PR of yours has **Merge**, which, pressed twice, merges it with
  `gh pr merge` the first way its repo allows (squash, then a merge commit, then
  a rebase). Drafts have no Merge.
- **Needs your review**: PRs where your review is requested, with a **Review**
  button that has Claude start a review session.
- **Shipped this week**: your PRs merged in the last seven days.

The pane works in the Claude desktop app's Code tab and in a terminal `claude`.
`/workbench` opens it when it is closed.

## How it works

The plugin is a hooks module (`hooks/register.tsx`) the Claude Code engine loads.
Every two minutes, and on **Refresh**, it:

1. finds the git repositories under the folders in its `roots` option (default
   `~/repositories`, two levels deep), and reads each one's `.claude/features.md`;
2. asks GitHub, in one `gh api graphql` call, for your open PRs, the PRs waiting on
   your review, and your PRs merged this week, in any repository.

A plugin cannot open a desktop session itself, so **Start** and **Review** send the
session the pane sits in a prompt (`hooks/prompts.ts`), and Claude starts the
session. Which items you started is kept in the plugin's own store, not in
`features.md`, so starting work never leaves a change in a repo's checkout. The
only file the pane writes is a repo's `.claude/features.md`, and only from Add,
Create empty list, Done and Remove.

It needs `gh`, signed in (`gh auth status`).

## A repo's feature list

`.claude/features.md` is a markdown checklist. `- [ ]` starts an item, `- [x]`
marks it done, and the indented lines under an item are its brief, which becomes
the new session's prompt. Anything else is ignored.

```markdown
# Features

- [ ] Retry stuck requests
  Add a retry action on /requests/ for requests stuck over a day.
- [x] Split the requests page
```

## Install

From this folder, while developing (read from the folder, so edits reach a session
after `/reload-plugins`):

```bash
claude plugin marketplace add ~/repositories/personal/workbench
```

```bash
claude plugin install workbench@workbench
```

Options (`roots`, `refresh_minutes`) are in `/config`.

## Develop

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

`tsc -p .` type-checks once the engine has loaded the plugin, which writes the API's
types to `.claude-plugin/types/` (ignored by git).
