# CLAUDE.md

## What this repo is

`workbench`: one Claude Code plugin holding the tools the owner uses for daily
development across all their repositories. [README.md](README.md) says what it does
and how to install it. The plugin's root is the repo's root, and
`.claude-plugin/marketplace.json` makes the repo its own marketplace.

## How a hooks module differs from ordinary TypeScript

The engine runs `hooks/register.tsx` in an environment of its own: no DOM, no Node,
no npm packages. These bite:

1. **`$` never crosses an import.** A function that takes `$` must live in
   `register.tsx`; the module does not load otherwise (`claude plugin validate`
   misses this, `claude plugin test` catches it). Other files hold pure code only:
   parsing, formatting, prompt text.
2. **The state contract is self-contained.** `types/index.d.ts` declares every
   `$.state` value and the types they use; it may not import. Code files import
   their types from `../types`.
3. **Elements come from the surface**, `$.ui.resolve(e)`, and each surface draws
   them its own way; tests mount the pane on `terminal` and `desktop` both.
4. **The plugin cannot start a session.** Buttons that start work send a prompt
   (`$.prompt.submit`) and Claude starts the session. Keep those prompts in
   `hooks/prompts.ts`.
5. **Never write into another repo's checkout**, except its `.claude/features.md`
   from the pane: Add and Create empty list, and Done and Remove on a row. What the
   pane tracks about a feature (started, when) still goes in `$.store`, not in
   `features.md`.
6. **Reviews report before they post.** The review prompt asks for findings first;
   nothing is posted on a PR without the owner's word.

## Conventions

- Commit subjects are lowercase and imperative; bodies explain why.
- Run `claude plugin validate .` and `claude plugin test .` before committing.
  Tests live beside the code (`hooks/*.test.ts(x)`).
- New tools go in this same plugin, as more hooks in `register.tsx` and helpers
  beside it, unless they need a separate install.
