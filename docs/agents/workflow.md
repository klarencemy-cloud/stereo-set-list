# Agent workflow

Two lanes, built only from the skills in `.agents/skills` (Matt Pocock's set plus `/bug`). No custom agents: the skills start their own subagents.

## Lane 1: bugs

```
/bug <symptom or #issue>
```

One command, one session. It reads the issue, builds a check that goes red on the bug (`diagnosing-bugs`), fixes it on a `fix/<slug>` branch with a regression test, runs `npm test` and `npm run build`, runs `code-review`, then opens a PR with `pr`. It never merges. If it can't build a failing check it stops and asks you. It never runs `/triage`; you run that yourself.

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

`.claude/` is gitignored, so `.claude/skills` is not in the repo. Each clone links it to `.agents/skills`, from the repo root:

```powershell
# Needs admin or Developer Mode:
New-Item -ItemType SymbolicLink -Path .claude\skills -Target ..\.agents\skills
# Otherwise a junction works with no privileges:
New-Item -ItemType Junction -Path .claude\skills -Target (Resolve-Path .agents\skills).Path
```

Delete or move any existing `.claude/skills` folder first. Anything left in it stops loading once it's replaced. Check it worked by typing `/` in Claude Code and looking for `/bug`, `/implement` and `/to-spec`.
