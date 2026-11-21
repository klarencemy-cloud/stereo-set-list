---
name: bug
description: Take a bug from symptom or issue to an open PR: branch, diagnose, fix with a regression test, verify, review. "/bug all" does every ready-for-agent issue in turn.
disable-model-invocation: true
---

Take the bug the user gave (`/bug <symptom or #issue>`) from report to open PR. This skill is user-invoked, so it only chains **model-invoked** skills (`diagnosing-bugs`, `tdd`, `code-review`, `pr`). Never call another user-invoked skill, and never run `/triage`: the user does that themselves.

The issue tracker is GitHub; read `docs/agents/issue-tracker.md` for the `gh` conventions.

Order: read report -> branch `fix/<slug>` from `main` -> diagnose -> fix -> verify -> review -> PR. **No file edits before the branch exists.**

## Batch mode: `/bug all`

1. List the work: `gh issue list --label ready-for-agent --state open --json number,title`.
2. Run steps 1-7 below for each issue in turn, never in parallel. Each gets its own `fix/<slug>` branch from `main` (go back to `main` first) and its own PR.
3. If you cannot make an issue's check go red, skip it, note why, and go on to the next.
4. End with a summary table: issue -> PR link, or the reason it was skipped.

## Steps

1. **Read the report.** If the argument is `#N`, run `gh issue view N --json number,title,body,labels,comments` and state the title. If it is a bare symptom, treat it as the report and say so, then offer to file a plain issue for it with `gh issue create` (title and body only, **no labels**). If the user declines, write "No issue" in the PR body. Read `GLOSSARY.md` if it exists. Done when you can state the symptom in one sentence in the user's words.

2. **Branch.** Create `fix/<slug>` from `main`, where `<slug>` is 2-5 lowercase words naming the symptom (add the issue number if there is one, e.g. `fix/42-setlist-duplicates`). Never work on `main`, and make no edits (not even a probe or a repro file) before this.

3. **Diagnose.** Call the Skill tool with "diagnosing-bugs". Phase 1 must produce a check that goes red on _this_ bug (usually a failing test). If you cannot build one, stop: list what you tried and ask the user (in batch mode, skip the issue instead). Do not hypothesise or edit code without it. Done when you have run the check and shown it failing.

4. **Fix, test first.** Call the Skill tool with "tdd". The seam is the one `diagnosing-bugs` proved red; treat it as already agreed with the user, so do not ask `tdd` to confirm it. Ask only if a different seam is needed. Land the check as a regression test in `tests/` (server tests use `memoryKV()`), watch it fail, apply the smallest fix, watch it pass. Remove every `[DEBUG-...]` probe. Commit in small commits on the branch.
   - If the red check is not an automated test (a script, a repro URL or a manual flow), keep it in the PR, add the closest automated test you can, and say in the PR which is which.
   - If there is no honest seam for any test, say so in the PR instead of faking one.

5. **Verify.** Run `npm test` and `npm run build` (the build includes the type-check). Both must pass; show the real output. If either fails, fix it or report it. Never claim green without running them.

6. **Review.** Call the Skill tool with "code-review", with `main` as the fixed point and the issue (if any) as the spec. Fix findings that reproduce; per CLAUDE.md, reproduce a finding before fixing it. Re-run step 5 after any change. **At most two review rounds.** After the second, stop and list the findings still open in the PR.

7. **PR.** Call the Skill tool with "pr" to write the body, push the branch, and open the PR with `gh pr create`. Put `Closes #N` in the body when there is an issue. Name the confirmed cause in the PR, so the next debugger learns. Stop here: **never merge, never enable auto-merge.** Give the user the PR link.

## Rules

- Commit and push only on `fix/<slug>` branches, never to `main`.
- Do not apply or change triage labels; that is `/triage`. The only issue you may create is the plain one in step 1.
- Follow the user's own rules in `CLAUDE.md` and memory over anything above, including any "no attribution lines" rule for commits and PRs.
