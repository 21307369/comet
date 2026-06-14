---
name: comet-review-plan
description: "Independently review spec and plan. Invoke with /comet-review-plan. Uses a fresh-context subagent to detect same-source bias. Supports plan-only and spec+plan modes."
---

# Independent Spec and Plan Review (Review Plan)

## Purpose

After the build phase generates a plan and before execution begins, use an **independent subagent with fresh context** to review specs and plans, breaking same-source bias — in the original flow, proposal → design → tasks → plan are produced by the same session, making them "consistently wrong but internally consistent."

## Prerequisites

- Active change exists
- Plan file has been generated (file exists under `docs/superpowers/plans/`)
- Currently in build phase

## Review Modes

| Mode | Scope | When to use |
|------|-------|-------------|
| `spec+plan` (default) | OpenSpec artifacts + Design Doc + Plan | Default. Checks spec internal consistency + plan executability |
| `plan-only` | Plan + relevant code only | When specs have been thoroughly reviewed (e.g., resuming from existing change) |

## Steps

### 1. Determine Review Mode and Inputs

Read `.comet.yaml` to get change information:

```bash
COMET_ENV="${COMET_ENV:-$(find . "$HOME"/.*/skills "$HOME/.config" "$HOME/.gemini" -path '*/comet/scripts/comet-env.sh' -type f -print -quit 2>/dev/null)}"
if [ -z "$COMET_ENV" ]; then
  echo "ERROR: comet-env.sh not found. Ensure the comet skill is installed." >&2
  return 1
fi
. "$COMET_ENV"
```

Collect file paths needed for review:
- **spec+plan mode**: `proposal.md`, `design.md`, `tasks.md`, delta specs (`specs/*/spec.md`), Design Doc (`design_doc` field), Plan file (`plan` field)
- **plan-only mode**: Design Doc, Plan file, tasks.md

### 2. Dispatch Review Subagent

Use the current platform's subagent dispatch mechanism. **The subagent must start in a fresh context** — it must not inherit the main session's conversation history.

**Subagent instructions**:

You are an independent spec and plan review expert. You are unrelated to the agent that generated these documents. Your task is to find problems from a completely fresh perspective.

**Review mode**: `<spec+plan|planOnly>`

**Input files**:
- Change name: `<name>`
- proposal.md: `<path>` (spec+plan mode only)
- design.md: `<path>` (spec+plan mode only)
- tasks.md: `<path>` (spec+plan mode only)
- Delta specs: `<paths>` (spec+plan mode only)
- Design Doc: `<path>`
- Plan file: `<path>`

**Review dimensions** (in priority order):

1. **Directional correctness** (spec+plan mode only):
   - Are proposal.md goals clear and unambiguous?
   - Are design.md architectural decisions reasonable? Was a simpler approach overlooked?
   - Do delta spec acceptance scenarios cover the proposal's core goals?
   - Are there implicit assumptions (prerequisites needed for execution but not stated in docs)?

2. **Completeness**:
   - spec+plan mode: Does every spec acceptance scenario have a corresponding plan task?
   - plan-only mode: Does every Design Doc technical decision have a corresponding implementation step?
   - Are there missing boundary conditions, error handling, or data migration steps?

3. **Executability**:
   - Can each plan task be independently understood from the current documents alone (without conversation context)?
   - Do file paths and interfaces referenced by tasks actually exist? (Read project code to verify)
   - Are task dependency orders reasonable?

4. **Consistency**:
   - Are interface signatures/data flows in the plan consistent with existing project code patterns?
   - Are there contradictory descriptions across documents?
   - Is naming consistent (same concept using different names in different documents)?

5. **Risk identification**:
   - Are there high-risk tasks (concurrency, data migration, external dependencies) lacking fallback plans?
   - Are there tasks whose change scope exceeds expectations (may affect other modules)?

**Output requirements**:

Review results must be written to `openspec/changes/<name>/.comet/review-plan.json` in JSON format.

JSON schema:

```json
{
  "mode": "spec+plan | plan-only",
  "round": 1,
  "status": "pass | fail",
  "findings": [
    {
      "id": 1,
      "severity": "CRITICAL | WARNING | SUGGESTION",
      "dimension": "directional-correctness | completeness | executability | consistency | risk-identification",
      "title": "Brief description",
      "detail": "Specific issue and location",
      "suggestion": "Suggested fix"
    }
  ],
  "summary": "Overall assessment summary"
}
```

**Severity definitions**:
- `CRITICAL`: Directional error or major omission, must fix before execution (e.g., spec goal misunderstood, core acceptance scenario has no corresponding task)
- `WARNING`: May cause execution deviation, recommend fixing (e.g., implicit assumptions not stated, task dependency order unreasonable)
- `SUGGESTION`: Improvement suggestion, does not block execution (e.g., naming inconsistency, optimizable interface design)

**Pass/fail rules**:
- Any `CRITICAL` exists → `status: "fail"`
- Only `WARNING` and/or `SUGGESTION` → `status: "pass"` (but all WARNINGs listed in findings)

**Important**:
- You must actually read project code to verify file paths and interfaces referenced in the plan
- Do not judge based on document content alone — combine with code context
- If a review dimension has no issues, simply omit it from findings
- After writing results to file, return the file path and status

### 3. Process Review Results

After the subagent completes, read `openspec/changes/<name>/.comet/review-plan.json`.

**`status: "pass"`**: Review passed. Report review summary to user (finding counts, WARNING list), then continue with subsequent workflow. User decides whether to adopt WARNING and SUGGESTION items.

**`status: "fail"`**: CRITICAL issues exist. Enter fix loop.

### 4. Fix Loop (Maximum 3 Rounds)

When review result is `fail`:

1. Present CRITICAL findings list to user
2. Modify corresponding spec/plan files in the main session based on findings
3. After modifications, re-dispatch review subagent (Step 2), incrementing `round`
4. Subagent re-reviews, outputting new review-plan.json

**Loop termination conditions**:
- Subagent returns `status: "pass"` → exit loop, continue subsequent workflow
- Reaches 3-round limit → stop loop, list all unresolved CRITICAL findings, follow main skill blocking point rule to pause for user ruling:
  - Option A: "Continue fixing" — one more fix round
  - Option B: "Accept risk and continue" — record acceptance reason, continue subsequent workflow
  - Option C: "Fall back to design phase" — problem is too fundamental, need to redo brainstorming

**Each round's fix requirements**:
- Must address all CRITICAL findings
- WARNING findings may be selectively addressed; unaddressed ones must record reasons in fix notes
- Commit after changes, message format: `review: round <N> fixes for <change-name>`

### 5. Persist Review Results

After review completes, ensure the following file exists:
- `openspec/changes/<name>/.comet/review-plan.json` — final round's review results

Append review record to tasks.md:

```markdown
<!-- review-plan: status=<pass|fail> rounds=<N> date=<YYYY-MM-DD> -->
```

## Exit Conditions

- Review subagent returns `status: "pass"`, or user chose to accept risk
- `review-plan.json` has been written
- tasks.md has review record appended
- All CRITICAL findings have been fixed or user has explicitly accepted them

## Degraded Fallback

- If the current platform lacks subagent dispatch capability, degrade to executing review in the main session (weaker effectiveness due to shared context)
- When degraded, inform user: "Current platform does not support independent subagent; review will execute in main session with reduced independence guarantee"
- Review dimensions and output format remain unchanged in degraded mode
