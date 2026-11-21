# How to use the agent workflow

A day-to-day guide. Bugs and features run in **separate sessions at the same time**, so fixing bugs never blocks feature work. You only step in to answer planning questions and to merge PRs.

> `/bug` and `docs/agents/workflow.md` are on the `chore/agent-team-workflow` branch, and the fixes for them (including `/bug all` and the Windows setup script) are on `temp/second-branch`. Merge those first, or some commands below won't exist yet.

---

## 1. One-time setup

**Windows (desktop app):** from the repo root, run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-skills.ps1
```

This links `.claude/skills` to `.agents/skills` so Claude Code can find the skills.

**Cloud sessions:** you don't need to do anything. The link is committed.

**Check it works:** open a new session and type `/`. You should see `/bug`, `/grill-with-docs`, `/implement`, `/triage` and the rest. If they're missing, see [When something goes wrong](#8-when-something-goes-wrong).

---

## 2. The two lanes at a glance

| | Bug lane | Feature lane |
|---|---|---|
| For | Something is broken | New features and small revisions |
| Where | Cloud sessions (claude.ai/code), one per bug | A desktop app session |
| How involved you are | Start it, then come back to a PR | You answer planning questions, then it builds |
| Ends with | A PR on `fix/<slug>` | A commit on a branch, or a draft PR |

Rules:
- Run **2–3 sessions at most**. More is hard to keep track of.
- Name each session after its issue, e.g. `bug #12 metronome drift`.
- Work moves between sessions only through git (branches and PRs). Don't copy and paste context between sessions.
- **Nothing merges automatically.** You review and merge every PR.

---

## 3. Bug lane

### Start a fix

```text
/bug the metronome drifts after 2 minutes on iPhone
```
If you describe a symptom, `/bug` first offers to file a GitHub issue. If you say no, the PR says "No issue".

```text
/bug #12
```
Use this for an issue you already have.

```text
/bug all
```
This fixes every open issue labelled `ready-for-agent`, one after another, with one PR each. At the end it lists each issue with its PR link or the reason it was skipped.

### What it does, in order

1. Reads the issue or your description.
2. Creates a `fix/<slug>` branch from `main`, before changing anything.
3. **Proves the bug** with a failing check (a test, a script or a repro). If it can't, it stops and tells you what it tried.
4. Fixes the bug test-first and keeps a regression test.
5. Runs `npm test` and `npm run build`, and shows you the output.
6. Runs code review, at most 2 rounds. Any findings it didn't fix are listed in the PR.
7. Opens the PR with `Closes #N` and an explanation of the cause.

### Your part

- Read the PR and check the cause makes sense.
- Merge it, or comment and ask for changes.
- After a batch of fixes, run `/retro` in that session so the lessons are saved.

---

## 4. Feature lane

First decide whether it's **small** or **big**. If it needs more than one session, or splits into more than about 3 separate pieces after grilling, it's big.

### Small change (a revision or a tweak)

```text
/grill-with-docs I want the setlist page to show total gig length
```
It asks you questions one at a time until the change is clear. Answer them. This is the planning step.

```text
/implement
```
It builds the change test-first, runs the tests and code review, and commits to the current branch.

### Big feature

```text
/grill-with-docs <your idea>
```
Agree the design.

```text
/to-spec
```
Writes the agreed design up as a spec issue on GitHub.

```text
/to-tickets
```
Splits the spec into small GitHub issues.

```text
/implement-spec
```
Builds every ticket in parallel worktrees and opens one draft PR.

Instead of `/implement-spec`, you can do one ticket at a time with `/implement #N`. Run `/clear` between tickets.

### Your part

- Answer the grilling questions honestly. This is where the plan gets made.
- Review the draft PR, then merge it.
- Before opening any PR, `npm test` and `npm run build` must pass. This is a CLAUDE.md rule.

---

## 5. Triage

`/triage` works on GitHub issues that **already exist**. It doesn't create an issue from a description. Type `/triage` and then say what you want in plain words:

```text
/triage show me anything that needs my attention
```
Lists issues that haven't been sorted yet.

```text
/triage let's look at #12
```
Reads the issue, checks whether it's already fixed, tries to reproduce it, asks you questions if it's vague, then labels it.

```text
/triage move #12 to ready-for-agent
```
Just applies the label.

```text
/triage what's ready for agents to pick up?
```

**To get a new problem into the queue:**
1. File it. Ask Claude "file a GitHub issue: \<problem\>", or create it on GitHub yourself.
2. Run `/triage let's look at #N` to label it `ready-for-agent`.
3. Later, `/bug #N` or `/bug all` picks it up.

**Triage or just `/bug`?**
- One bug you want fixed now: use `/bug <symptom>` and skip triage.
- Several problems to hand off at once: file them, triage them, then run `/bug all`.

Labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `triage-labels.md`.

---

## 6. Other skills worth knowing

| Command | Use it when |
|---|---|
| `/ask-matt` | You're not sure which skill fits. It points you to the right one. |
| `/grill-me` | You want to think an idea through without touching the code. |
| `/retro` | At the end of a piece of work, before `/clear`. It saves what was learned. |
| `/handoff` | A session is getting long and you want to continue in a fresh one. |
| `/wayfinder` | For very large efforts that need a plan across several specs. |
| `/clear` | Between unrelated tasks in the same session. |

---

## 7. A typical day

1. **Morning (5 min):** check the issues with `/triage show me anything that needs my attention`, and label what's clear as `ready-for-agent`.
2. **Start the bug lane:** open a cloud session and run `/bug all`, or one session per bug with `/bug #N`. Then leave it alone.
3. **Feature work at the desktop:** `/grill-with-docs` your planned feature, then `/implement` it, or go through `/to-spec` for a big one.
4. **When PRs arrive:** review and merge them. Run `/retro` after a batch.

---

## 8. When something goes wrong

| Problem | What to do |
|---|---|
| `/bug` stops with "couldn't reproduce" (no failing check) | Add exact repro steps to the issue (device, browser, clicks) and run it again. If it can only be checked by hand, label it `ready-for-human`. |
| `/bug` or other skills don't show up | On Windows, re-run `scripts/setup-skills.ps1`, then start a new session. In the cloud, check that the branch you're on has `.claude/skills` committed. |
| The PR lists review findings it didn't fix | Decide yourself: fix them in the same PR, or file a follow-up issue. |
| A review finding looks wrong | Reproduce it first (a throwaway test is fine). Several past findings described bugs that couldn't actually happen (CLAUDE.md rule). |
| Two sessions edited the same file | Merge one PR first, then tell the other session to merge `main` into its branch. |
| A feature keeps growing during `/implement` | Stop and run `/to-spec`, then `/to-tickets`. It was a big change. |
