---
name: bug
description: Take a bug from symptom or issue to an open PR: diagnose, fix with a regression test, verify, review.
disable-model-invocation: true
---

Take the bug the user gave (`/bug <symptom or #issue>`) from report to open PR. This skill is user-invoked, so it only chains **model-invoked** skills (`diagnosing-bugs`, `tdd`, `code-review`, `pr`). Never call another user-invoked skill, and never run `/triage`: the user does that themselves.

The issue tracker is GitHub; read `docs/agents/issue-tracker.md` for the `gh` conventions.

## Steps

1. **Read the report.** If the argument is `#N`, run `gh issue view N --json number,title,body,labels,comments` and state the title. If it is a bare symptom, treat it as the report and say so. Read `GLOSSARY.md` if it exists. Done when you can state the symptom in one sentence in the user's words.

2. **Diagnose.** Call the Skill tool with "diagnosing-bugs". Phase 1 must produce a check that goes red on _this_ bug (usually a failing test). If you cannot build one, stop: list what you tried and ask the user. Do not hypothesise or edit code without it. Done when you have run the check and shown it failing.

3. **Branch.** Create `fix/<slug>` from `main`, where `<slug>` is 2-5 lowercase words naming the symptom (add the issue number if there is one, e.g. `fix/42-setlist-duplicates`). Never work on `main`.

4. **Fix, test first.** Call the Skill tool with "tdd". Land the diagnosing-bugs check as a regression test in `tests/` (server tests use `memoryKV()`), watch it fail, apply the smallest fix, watch it pass. If diagnosing-bugs found no correct seam for a test, say so in the PR instead of faking one. Remove every `[DEBUG-...]` probe. Commit the work in small commits on the branch.

5. **Verify.** Run `npm test` and `npm run build` (the build includes the type-check). Both must pass; show the real output. If either fails, fix it or report it. Never claim green without running them.

6. **Review.** Call the Skill tool with "code-review", with `main` as the fixed point and the issue (if any) as the spec. Fix findings that reproduce; per CLAUDE.md, reproduce a finding before fixing it. Re-run step 5 after any change.

7. **PR.** Call the Skill tool with "pr" to write the body, push the branch, and open the PR with `gh pr create`. Put `Closes #N` in the body when there is an issue. Name the confirmed cause in the PR, so the next debugger learns. Stop here: **never merge, never enable auto-merge.** Give the user the PR link.

## Rules

- Commit and push only on `fix/<slug>`, never to `main`.
- Do not apply or change triage labels; that is `/triage`.
- Follow the user's own rules in `CLAUDE.md` and memory over anything above, including any "no attribution lines" rule for commits and PRs.
