# Agent workflow

Two lanes, built only from the skills in `.agents/skills` (Matt Pocock's set plus `/bug`). No custom agents: the skills start their own subagents.

## Lane 1: bugs

```
/bug <symptom or #issue>
```

One command, one session. It reads the issue, branches `fix/<slug>` from `main` (no edits before that), builds a check that goes red on the bug (`diagnosing-bugs`), fixes it with a regression test, runs `npm test` and `npm run build`, runs `code-review`, then opens a PR with `pr`. It never merges. If it can't build a failing check it stops and asks you. It never runs `/triage`; you run that yourself. A bare symptom gets an offer to file a plain issue first. It does at most two review rounds. `/bug all` does every open `ready-for-agent` issue in turn, one branch and PR each.

## Lane 2: features

Every skill here is user-invoked, so you type each one.

**Small change** (one session):

```
/grill-with-docs  ->  /implement
```

**Big change** (several sessions):

```
/grill-with-docs  ->  /to-spec  ->  /to-tickets  ->  /implement-spec
```

`/implement-spec` builds the whole spec on one integration branch. To drive tickets by hand instead, run `/implement #<ticket>` per ticket and `/clear` between them.

`/implement` and `/implement-spec` run the tests and `code-review`; the CLAUDE.md rule adds `npm run build` before any PR.

**Rule of thumb:** if the work needs more than one session, or splits into more than about 3 separate pieces after grilling, use `/to-spec` -> `/to-tickets` -> `/implement-spec`. Otherwise `/implement`.

## Which skill does what

| Skill | Kind | What it does |
|---|---|---|
| `/bug` | you type | Symptom or issue to open PR (lane 1) |
| `/grill-with-docs` | you type | Interview that sharpens a plan; writes `GLOSSARY.md` and ADRs as it goes |
| `/to-spec` | you type | Turns the conversation into a spec issue, no interview |
| `/to-tickets` | you type | Splits a spec into tracer-bullet tickets with blocking edges |
| `/implement` | you type | Builds one change or ticket, test-first |
| `/implement-spec` | you type | Builds the whole spec on one integration branch with parallel subagents |
| `/triage` | you type | Moves issues through triage labels. Only you run it |
| `diagnosing-bugs` | model | Builds a failing check, then hypotheses, fix, cleanup |
| `tdd` | model | Red-green loop |
| `code-review` | model | Standards and Spec review of a diff, two parallel subagents |
| `pr` | model | PR body template |
| `ask-matt` | you type | Router: asks which skill fits |

## Sessions

- At most 2-3 sessions open at once. More than that and you stop knowing what each is doing.
- Name each session after its issue (`/rename #42 setlist-duplicates`), so you can find it again.
- One session per issue. `/clear` between tickets.

## Windows setup

`.claude/skills` is a committed symlink to `../.agents/skills`, so cloud sessions get `/bug` and the other skills. Git on Windows checks a symlink out as a plain text file, so each Windows clone needs one step, from the repo root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-skills.ps1
```

It deletes the folder or text-file stand-in at `.claude/skills` (if it isn't a real link), makes a junction to `.agents/skills`, and prints what it did. No admin needed. Anything that was in an old `.claude/skills` folder stops loading. Check it worked by typing `/` in Claude Code and looking for `/bug`, `/grill-with-docs` and `/implement`.

Git will then show `.claude/skills` as modified (the junction versus the committed symlink). Don't commit that.
