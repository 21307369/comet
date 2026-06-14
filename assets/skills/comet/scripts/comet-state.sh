#!/bin/bash
# Comet State — unified interface for .comet.yaml state management
# Usage: comet-state.sh <subcommand> <change-name> [args...]
#
# Subcommands:
#   init <change-name> <workflow>  — Initialize .comet.yaml with workflow defaults
#   get <change-name> <field>       — Read a field value from .comet.yaml
#   set <change-name> <field> <val> — Update a field value
#   transition <change-name> <event> — Apply a validated state transition
#   check <change-name> <phase> [--recover] — Verify entry requirements for a phase
#   conflict-check <proposed-name> [keywords...] — Scan for related existing documents
#   scale <change-name>             — Assess and set verification mode based on metrics
#   index-init                      — Initialize INDEX.md design registry
#   index-add <name> [keywords...]  — Add change to In Progress table
#   index-update <name> <field> <v> — Update design_doc or plan link in INDEX.md
#   index-complete <name>           — Move from In Progress to Completed
#   index-complete <name>           — Move from In Progress to Completed
#   index-clean-stale               — Remove entries for deleted changes
#   get-preference <field>          — Read global preference from ~/.comet/config.yaml
#
# Workflows: full, hotfix, tweak
# Phases for check: open, design, build, verify, archive

set -euo pipefail

# --- Color output helpers ---

red() { echo -e "\033[31m$1\033[0m" >&2; }
green() { echo -e "\033[32m$1\033[0m" >&2; }
yellow() { echo -e "\033[33m$1\033[0m" >&2; }

# --- Script location ---

# shellcheck disable=SC2034
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Input validation ---

validate_change_name() {
  local name="$1"
  # Reject empty names
  if [ -z "$name" ]; then
    red "ERROR: Change name cannot be empty" >&2
    exit 1
  fi
  # Only allow alphanumeric, hyphens, and underscores
  if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    red "ERROR: Invalid change name: '$name'" >&2
    red "Valid characters: a-z, A-Z, 0-9, -, _" >&2
    exit 1
  fi
  # Reject path traversal attempts
  if [[ "$name" =~ \.\. ]]; then
    red "ERROR: Change name cannot contain '..' (path traversal not allowed)" >&2
    exit 1
  fi
}

validate_enum() {
  local value="$1"
  shift
  local valid_values=("$@")

  for valid in "${valid_values[@]}"; do
    if [ "$value" = "$valid" ]; then
      return 0
    fi
  done

  red "ERROR: Invalid value: '$value'" >&2
  red "Valid values: ${valid_values[*]}" >&2
  exit 1
}

validate_path_field() {
  local value="$1"
  local field="$2"
  # null and empty are acceptable (means "not set")
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    return 0
  fi
  # Reject absolute paths and home-directory references
  case "$value" in
    /*|~*|[A-Za-z]:*|\\*)
      red "ERROR: $field must be a relative path within the repo: '$value'" >&2
      exit 1
      ;;
  esac
  if [[ "$value" =~ \.\. ]]; then
    red "ERROR: $field cannot contain '..' (path traversal not allowed): '$value'" >&2
    exit 1
  fi
}

# --- Helper functions ---

yaml_field() {
  local field="$1"
  local yaml_file="$2"
  if [ -f "$yaml_file" ]; then
    local value
    value=$(grep "^${field}:" "$yaml_file" 2>/dev/null | sed "s/^${field}: *//" || true)
    value=$(strip_inline_comment "$value")
    strip_wrapping_quotes "$value"
  fi
}

strip_inline_comment() {
  local value="$1"
  printf '%s\n' "$value" | awk -v squote="'" '
    {
      out = ""
      quote = ""
      for (i = 1; i <= length($0); i++) {
        c = substr($0, i, 1)
        if (quote == "") {
          if (c == "\"" || c == squote) {
            quote = c
          } else if (c == "#" && (i == 1 || substr($0, i - 1, 1) ~ /[[:space:]]/)) {
            sub(/[[:space:]]+$/, "", out)
            print out
            next
          }
        } else if (c == quote) {
          quote = ""
        }
        out = out c
      }
      print out
    }
  '
}

strip_wrapping_quotes() {
  local value="$1"
  case "$value" in
    \"*\")
      printf '%s\n' "${value:1:${#value}-2}"
      ;;
    \'*\')
      printf '%s\n' "${value:1:${#value}-2}"
      ;;
    *)
      printf '%s\n' "$value"
      ;;
  esac
}

replace_yaml_field() {
  local yaml_file="$1"
  local field="$2"
  local value="$3"
  local tmp_file

  tmp_file=$(mktemp)
  chmod 600 "$tmp_file"
  # Replace the target field, then deduplicate all fields keeping only the
  # last occurrence of each key. Prevents stale earlier values from
  # persisting when a field is set multiple times.
  awk -v field="$field" -v value="$value" '
    index($0, field ":") == 1 { $0 = field ": " value }
    { buf[NR] = $0; keys[NR] = $0; sub(/:.*$/, "", keys[NR]); n = NR }
    END {
      for (i = 1; i <= n; i++) last[keys[i]] = i
      for (i = 1; i <= n; i++) if (last[keys[i]] == i) print buf[i]
    }
  ' "$yaml_file" > "$tmp_file"
  mv "$tmp_file" "$yaml_file"
}

file_nonempty() {
  [ -f "$1" ] && [ -s "$1" ]
}

change_dir_for() {
  local change_name="$1"
  if [ -d "openspec/changes/$change_name" ]; then
    echo "openspec/changes/$change_name"
  elif [ -d "openspec/changes/archive/$change_name" ]; then
    echo "openspec/changes/archive/$change_name"
  else
    echo "openspec/changes/$change_name"
  fi
}

yaml_file_for() {
  local change_name="$1"
  local change_dir
  change_dir=$(change_dir_for "$change_name")
  echo "$change_dir/.comet.yaml"
}

project_context_compression() {
  local value="off"
  local source="default"
  if [ -n "${COMET_CONTEXT_COMPRESSION:-}" ]; then
    value="$COMET_CONTEXT_COMPRESSION"
    source="COMET_CONTEXT_COMPRESSION"
  elif [ -f ".comet/config.yaml" ]; then
    value=$(yaml_field "context_compression" ".comet/config.yaml")
    value="${value:-off}"
    source=".comet/config.yaml"
  fi

  case "$value" in
    off|beta)
      printf '%s\n' "$value"
      ;;
    *)
      red "ERROR: Invalid context_compression from ${source}: '$value'" >&2
      red "Valid values: off, beta" >&2
      exit 1
      ;;
  esac
}

project_auto_transition_default() {
  local value="true"
  local source="default"
  if [ -n "${COMET_AUTO_TRANSITION:-}" ]; then
    value="$COMET_AUTO_TRANSITION"
    source="COMET_AUTO_TRANSITION"
  elif [ -f ".comet/config.yaml" ]; then
    local raw
    raw=$(yaml_field "auto_transition" ".comet/config.yaml" 2>/dev/null || true)
    if [ -n "$raw" ]; then
      value="$raw"
      source=".comet/config.yaml"
    fi
  fi

  case "$value" in
    true|false)
      printf '%s\n' "$value"
      ;;
    *)
      red "ERROR: Invalid auto_transition from ${source}: '$value'" >&2
      red "Valid values: true, false" >&2
      exit 1
      ;;
  esac
}

# --- Subcommands ---

cmd_init() {
  local change_name="$1"
  local workflow="$2"

  validate_change_name "$change_name"
  validate_enum "$workflow" "full" "hotfix" "tweak"

  local change_dir yaml_file
  change_dir=$(change_dir_for "$change_name")
  yaml_file=$(yaml_file_for "$change_name")

  # Check if .comet.yaml already exists
  if [ -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml already exists at $yaml_file"
    exit 1
  fi

  # Create change directory if it doesn't exist
  mkdir -p "$change_dir"

  # Set workflow-appropriate defaults
  local phase build_mode isolation verify_mode context_compression auto_transition
  phase="open"
  context_compression=$(project_context_compression)
  auto_transition="$(project_auto_transition_default)"

  case "$workflow" in
    full)
      build_mode="null"
      tdd_mode="null"
      isolation="null"
      verify_mode="null"
      ;;
    hotfix|tweak)
      build_mode="direct"
      tdd_mode="direct"
      isolation="branch"
      verify_mode="light"
      ;;
  esac

  # Write .comet.yaml
  # Record current HEAD as base_ref for scale assessment fallback
  local base_ref="null"
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    base_ref=$(git rev-parse HEAD 2>/dev/null || echo "null")
  fi

  cat > "$yaml_file" <<EOF
workflow: $workflow
phase: $phase
context_compression: $context_compression
build_mode: $build_mode
build_pause: null
subagent_dispatch: null
tdd_mode: $tdd_mode
isolation: $isolation
verify_mode: $verify_mode
auto_transition: $auto_transition
base_ref: $base_ref
design_doc: null
plan: null
verify_result: pending
verification_report: null
branch_status: pending
created_at: $(date -u +%Y-%m-%d)
verified_at: null
archived: false
EOF

  green "Initialized: $yaml_file (workflow=$workflow)"
}

cmd_get() {
  local change_name="$1"
  local field="$2"

  validate_change_name "$change_name"

  local yaml_file
  yaml_file=$(yaml_file_for "$change_name")

  # Check if .comet.yaml exists
  if [ ! -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml not found at $yaml_file"
    exit 1
  fi

  # Read and output the field value
  local value
  value=$(yaml_field "$field" "$yaml_file")
  if [ "$field" = "auto_transition" ] && { [ -z "$value" ] || [ "$value" = "null" ]; }; then
    value="$(project_auto_transition_default)"
  fi
  echo "${value:-}"
}

cmd_set() {
  local change_name="$1"
  local field="$2"
  local value="$3"

  validate_change_name "$change_name"

  local yaml_file
  yaml_file=$(yaml_file_for "$change_name")

  # Check if .comet.yaml exists
  if [ ! -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml not found at $yaml_file"
    exit 1
  fi

  # Validate field name
  case "$field" in
    phase)
      yellow "WARNING: Setting 'phase' directly bypasses state machine constraints." >&2
      yellow "  Consider using: comet-state.sh transition <change-name> <event>" >&2
      ;;
    workflow|context_compression|build_mode|build_pause|subagent_dispatch|tdd_mode|isolation|verify_mode|auto_transition|verify_result|verification_report|branch_status|archived|design_doc|plan|verified_at|created_at|direct_override|build_command|verify_command|handoff_context|handoff_hash|base_ref)
      # Valid field
      ;;
    *)
      red "ERROR: Unknown field: '$field'" >&2
      red "Valid fields:" >&2
      red "  workflow, phase, context_compression, design_doc, plan, build_mode, build_pause, subagent_dispatch, tdd_mode, isolation," >&2
      red "  verify_mode, auto_transition, verify_result, verification_report, branch_status," >&2
      red "  verified_at, created_at, archived, base_ref, direct_override," >&2
      red "  build_command, verify_command, handoff_context, handoff_hash" >&2
      exit 1
      ;;
  esac

  # Validate enum values
  case "$field" in
    workflow)
      validate_enum "$value" "full" "hotfix" "tweak"
      ;;
    context_compression)
      validate_enum "$value" "off" "beta"
      ;;
    phase)
      validate_enum "$value" "open" "design" "build" "verify" "archive"
      ;;
    build_mode)
      validate_enum "$value" "subagent-driven-development" "executing-plans" "direct"
      ;;
    build_pause)
      validate_enum "$value" "null" "plan-ready"
      ;;
    subagent_dispatch)
      validate_enum "$value" "null" "confirmed"
      ;;
    tdd_mode)
      validate_enum "$value" "tdd" "direct"
      ;;
    isolation)
      validate_enum "$value" "branch" "worktree"
      ;;
    verify_mode)
      validate_enum "$value" "light" "full"
      ;;
    auto_transition)
      validate_enum "$value" "true" "false"
      ;;
    verify_result)
      validate_enum "$value" "pending" "pass" "fail"
      ;;
    branch_status)
      validate_enum "$value" "pending" "handled"
      ;;
    archived)
      validate_enum "$value" "true" "false"
      ;;
    direct_override)
      validate_enum "$value" "true" "false"
      ;;
    design_doc|plan|verification_report|handoff_context|handoff_hash)
      validate_path_field "$value" "$field"
      ;;
    verified_at|created_at|build_command|verify_command)
      # No validation for date fields or project command strings
      ;;
  esac

  # Write or update the field
  if grep -q "^${field}:" "$yaml_file"; then
    replace_yaml_field "$yaml_file" "$field" "$value"
  else
    # Field doesn't exist, append it
    echo "${field}: ${value}" >> "$yaml_file"
  fi

  green "[SET] ${field}=${value}"
}

require_phase() {
  local change_name="$1"
  local expected="$2"
  local actual
  actual=$(cmd_get "$change_name" "phase")
  if [ "$actual" != "$expected" ]; then
    red "ERROR: Cannot transition '$change_name': expected phase ${expected}, got ${actual}" >&2
    exit 1
  fi
}

require_verification_evidence() {
  local change_name="$1"
  local report branch_status
  report=$(cmd_get "$change_name" "verification_report")
  branch_status=$(cmd_get "$change_name" "branch_status")

  if [ -z "$report" ] || [ "$report" = "null" ] || [ ! -f "$report" ]; then
    red "ERROR: Cannot transition '$change_name': verification_report must point to an existing report file" >&2
    exit 1
  fi

  if [ "$branch_status" != "handled" ]; then
    red "ERROR: Cannot transition '$change_name': branch_status must be handled" >&2
    exit 1
  fi
}

require_build_decisions() {
  local change_name="$1"
  local workflow build_mode isolation direct_override subagent_dispatch tdd_mode
  workflow=$(cmd_get "$change_name" "workflow")
  build_mode=$(cmd_get "$change_name" "build_mode")
  isolation=$(cmd_get "$change_name" "isolation")
  direct_override=$(cmd_get "$change_name" "direct_override" 2>/dev/null || true)
  subagent_dispatch=$(cmd_get "$change_name" "subagent_dispatch" 2>/dev/null || true)
  tdd_mode=$(cmd_get "$change_name" "tdd_mode" 2>/dev/null || true)

  case "$isolation" in
    branch|worktree) ;;
    *)
      red "ERROR: Cannot transition '$change_name': isolation must be branch or worktree, got '${isolation:-null}'" >&2
      exit 1
      ;;
  esac

  case "$build_mode" in
    subagent-driven-development|executing-plans|direct) ;;
    *)
      red "ERROR: Cannot transition '$change_name': build_mode must be selected before leaving build, got '${build_mode:-null}'" >&2
      exit 1
      ;;
  esac

  if [ "$build_mode" = "direct" ] && [ "$workflow" != "hotfix" ] && [ "$workflow" != "tweak" ] && [ "$direct_override" != "true" ]; then
    red "ERROR: Cannot transition '$change_name': build_mode=direct is only allowed for hotfix/tweak unless direct_override=true" >&2
    exit 1
  fi

  if [ "$build_mode" = "subagent-driven-development" ] && [ "$subagent_dispatch" != "confirmed" ]; then
    red "ERROR: Cannot transition '$change_name': subagent_dispatch must be confirmed before using build_mode=subagent-driven-development" >&2
    exit 1
  fi

  if [ "$workflow" = "full" ] && { [ "$tdd_mode" = "null" ] || [ -z "$tdd_mode" ]; }; then
    red "ERROR: Cannot transition '$change_name': tdd_mode must be selected before leaving build (full workflow)" >&2
    exit 1
  fi
}

cmd_transition() {
  local change_name="$1"
  local event="$2"

  validate_change_name "$change_name"
  validate_enum "$event" "open-complete" "design-complete" "build-complete" "verify-pass" "verify-fail" "archive-reopen" "archived"

  case "$event" in
    open-complete)
      require_phase "$change_name" "open"
      local workflow
      workflow=$(cmd_get "$change_name" "workflow")
      if [ "$workflow" = "full" ]; then
        cmd_set "$change_name" phase design
      else
        cmd_set "$change_name" phase build
      fi
      ;;
    design-complete)
      require_phase "$change_name" "design"
      cmd_set "$change_name" phase build
      ;;
    build-complete)
      require_phase "$change_name" "build"
      require_build_decisions "$change_name"
      local current_verify_result
      current_verify_result=$(cmd_get "$change_name" "verify_result")
      cmd_set "$change_name" phase verify
      cmd_set "$change_name" verify_result pending
      # Preserve verification evidence on re-verify (verify-fail → build → build-complete)
      # so the fix can reference the original failure report
      if [ "$current_verify_result" != "fail" ]; then
        cmd_set "$change_name" verification_report null
        cmd_set "$change_name" branch_status pending
      fi
      ;;
    verify-pass)
      require_phase "$change_name" "verify"
      require_verification_evidence "$change_name"
      cmd_set "$change_name" verify_result pass
      cmd_set "$change_name" phase archive
      cmd_set "$change_name" verified_at "$(date -u +%Y-%m-%d)"
      ;;
    verify-fail)
      require_phase "$change_name" "verify"
      cmd_set "$change_name" verify_result fail
      cmd_set "$change_name" phase build
      # Preserve branch_status so re-verify doesn't require re-handling branches
      ;;
    archive-reopen)
      require_phase "$change_name" "archive"
      local archived
      archived=$(cmd_get "$change_name" "archived")
      if [ "$archived" = "true" ]; then
        red "ERROR: Cannot transition '$change_name': already archived" >&2
        exit 1
      fi
      cmd_set "$change_name" verify_result pending
      cmd_set "$change_name" phase verify
      cmd_set "$change_name" verified_at null
      ;;
    archived)
      require_phase "$change_name" "archive"
      cmd_set "$change_name" archived true
      ;;
  esac

  green "[TRANSITION] ${event}"
}

# --- Check helpers for entry verification ---

CHECK_BLOCK=0

check_pass() {
  local msg="$1"
  echo "  $(green "[PASS]") $msg"
}

check_fail() {
  local msg="$1"
  echo "  $(red "[FAIL]") $msg"
  CHECK_BLOCK=1
}

check_nonempty() {
  local desc="$1"
  local path="$2"
  if file_nonempty "$path"; then
    check_pass "$desc non-empty"
  else
    check_fail "$desc missing or empty"
  fi
}

check_yaml_is() {
  local field="$1"
  local expected="$2"
  local change_name="$3"
  local actual
  actual=$(cmd_get "$change_name" "$field")
  if [ "$actual" = "$expected" ]; then
    check_pass "${field}=${actual} (expected: ${expected})"
  else
    check_fail "${field}=${actual} (expected: ${expected})"
  fi
}

check_yaml_empty() {
  local field="$1"
  local change_name="$2"
  local value
  value=$(cmd_get "$change_name" "$field")
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    check_pass "${field} is empty/null"
  else
    check_fail "${field}=${value} (expected: empty/null)"
  fi
}

check_file_not_exists() {
  local desc="$1"
  local path="$2"
  if [ ! -f "$path" ]; then
    check_pass "$desc does not exist"
  else
    check_fail "$desc exists (should not exist)"
  fi
}

cmd_check() {
  local change_name="$1"
  local phase="$2"

  validate_change_name "$change_name"
  validate_enum "$phase" "open" "design" "build" "verify" "archive"

  local change_dir="openspec/changes/$change_name"
  local yaml_file="$change_dir/.comet.yaml"
  local proposal_file="$change_dir/proposal.md"
  local design_file="$change_dir/design.md"
  local tasks_file="$change_dir/tasks.md"

  echo "=== Entry Check: comet-${phase} ==="

  # .comet.yaml must exist for all phases (state machine core)
  if [ ! -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml not found at $yaml_file"
    exit 1
  fi

  # Phase-specific checks
  case "$phase" in
    open)
      check_pass ".comet.yaml exists"
      check_yaml_is "phase" "open" "$change_name"
      ;;
    design)
      check_pass ".comet.yaml exists"
      check_yaml_is "phase" "design" "$change_name"
      check_yaml_is "workflow" "full" "$change_name"
      check_yaml_empty "design_doc" "$change_name"
      check_nonempty "proposal.md" "$proposal_file"
      check_nonempty "design.md" "$design_file"
      check_nonempty "tasks.md" "$tasks_file"
      ;;
    build)
      check_pass ".comet.yaml exists"
      check_yaml_is "phase" "build" "$change_name"
      # design_doc required for full workflow only
      local workflow
      workflow=$(cmd_get "$change_name" "workflow")
      if [ "$workflow" = "full" ]; then
        local design_doc
        design_doc=$(cmd_get "$change_name" "design_doc")
        if [ -n "$design_doc" ] && [ "$design_doc" != "null" ] && [ -f "$design_doc" ]; then
          check_pass "design_doc=${design_doc} (file exists)"
        else
          check_fail "design_doc=${design_doc} (expected: non-null and file exists)"
        fi
      else
        check_pass "workflow=${workflow} (design_doc not required)"
      fi
      check_nonempty "proposal.md" "$proposal_file"
      check_nonempty "tasks.md" "$tasks_file"
      ;;
    verify)
      check_pass ".comet.yaml exists"
      check_yaml_is "phase" "verify" "$change_name"
      # Check verify_result is pending or null
      local verify_result
      verify_result=$(cmd_get "$change_name" "verify_result")
      if [ "$verify_result" = "pending" ] || [ -z "$verify_result" ] || [ "$verify_result" = "null" ]; then
        check_pass "verify_result=${verify_result} (expected: pending or null)"
      else
        check_fail "verify_result=${verify_result} (expected: pending or null)"
      fi
      ;;
    archive)
      check_pass ".comet.yaml exists"
      check_yaml_is "phase" "archive" "$change_name"
      check_yaml_is "verify_result" "pass" "$change_name"
      # Check archived is NOT true
      local archived
      archived=$(cmd_get "$change_name" "archived")
      if [ "$archived" != "true" ]; then
        check_pass "archived=${archived} (expected: not true)"
      else
        check_fail "archived=${archived} (expected: not true)"
      fi
      ;;
    *)
      red "ERROR: Unknown phase for check: $phase"
      exit 1
      ;;
  esac

  echo ""
  if [ "$CHECK_BLOCK" -eq 1 ]; then
    red "BLOCKED — fix failing checks before proceeding"
    exit 1
  else
    green "ALL CHECKS PASSED — ready to proceed"
    exit 0
  fi
}

# --- Recovery context for compaction resume ---

field_status() {
  # Args: field_name value [file_path]
  # Prints: "field_name: DONE (value)" or "field_name: PENDING"
  local field="$1"
  local value="$2"
  local file_path="${3:-}"

  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "  - ${field}: PENDING"
  elif [ -n "$file_path" ] && [ ! -f "$file_path" ]; then
    echo "  - ${field}: BROKEN (path ${value} does not exist)"
  else
    echo "  - ${field}: DONE (${value})"
  fi
}

cmd_recover() {
  local change_name="$1"

  validate_change_name "$change_name"

  local change_dir="openspec/changes/$change_name"
  local yaml_file="$change_dir/.comet.yaml"

  if [ ! -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml not found at $yaml_file"
    exit 1
  fi

  local phase workflow
  phase=$(cmd_get "$change_name" "phase")
  workflow=$(cmd_get "$change_name" "workflow")

  echo "=== Recovery Context: ${change_name} ==="
  echo "Phase: ${phase}"
  echo "Workflow: ${workflow}"
  echo ""

  # Read all relevant fields
  local design_doc plan verify_result verify_mode verification_report
  local branch_status handoff_context handoff_hash isolation build_mode build_pause subagent_dispatch tdd_mode direct_override
  design_doc=$(cmd_get "$change_name" "design_doc")
  plan=$(cmd_get "$change_name" "plan")
  verify_result=$(cmd_get "$change_name" "verify_result")
  verify_mode=$(cmd_get "$change_name" "verify_mode")
  verification_report=$(cmd_get "$change_name" "verification_report")
  branch_status=$(cmd_get "$change_name" "branch_status")
  handoff_context=$(cmd_get "$change_name" "handoff_context")
  handoff_hash=$(cmd_get "$change_name" "handoff_hash")
  isolation=$(cmd_get "$change_name" "isolation")
  build_mode=$(cmd_get "$change_name" "build_mode")
  build_pause=$(cmd_get "$change_name" "build_pause" 2>/dev/null || true)
  subagent_dispatch=$(cmd_get "$change_name" "subagent_dispatch" 2>/dev/null || true)
  tdd_mode=$(cmd_get "$change_name" "tdd_mode" 2>/dev/null || true)
  direct_override=$(cmd_get "$change_name" "direct_override" 2>/dev/null || true)

  echo "State fields:"

  # Phase-specific field reporting
  case "$phase" in
    open)
      echo "  Artifacts:"
      local artifacts_done=0
      for f in proposal.md design.md tasks.md; do
        if file_nonempty "$change_dir/$f"; then
          echo "  - ${f}: DONE"
          artifacts_done=$((artifacts_done + 1))
        else
          echo "  - ${f}: PENDING"
        fi
      done
      echo ""
      if [ "$artifacts_done" -eq 3 ]; then
        echo "Recovery action: All artifacts complete. Run /comet-open user confirmation, then guard to transition."
      elif [ "$artifacts_done" -eq 0 ]; then
        echo "Recovery action: No artifacts created yet. Start from /comet-open Step 1 (explore and clarify)."
      else
        echo "Recovery action: Some artifacts incomplete. Resume /comet-open from the first missing artifact."
      fi
      ;;
    design)
      echo "  Artifacts:"
      for f in proposal.md design.md tasks.md; do
        if file_nonempty "$change_dir/$f"; then
          echo "  - ${f}: DONE"
        else
          echo "  - ${f}: MISSING (unexpected in design phase)"
        fi
      done
      echo ""
      echo "  Design progress:"
      field_status "handoff_context" "$handoff_context" "$handoff_context"
      field_status "handoff_hash" "$handoff_hash"
      field_status "design_doc" "$design_doc" "$design_doc"
      echo ""
      if [ -n "$design_doc" ] && [ "$design_doc" != "null" ] && [ -f "$design_doc" ]; then
        echo "Recovery action: Design Doc already created and linked. Run guard to transition to build."
      elif [ -n "$handoff_context" ] && [ "$handoff_context" != "null" ] && [ -f "$handoff_context" ]; then
        echo "Recovery action: Handoff generated but Design Doc not yet created. Resume from brainstorming confirmation (Step 1c)."
      else
        echo "Recovery action: No handoff generated yet. Start from Step 1a (generate handoff package)."
      fi
      ;;
    build)
      echo "  Build decisions:"
      field_status "isolation" "$isolation"
      field_status "build_mode" "$build_mode"
      field_status "build_pause" "$build_pause"
      field_status "tdd_mode" "$tdd_mode"
      if [ "$build_mode" = "subagent-driven-development" ] || { [ -n "$subagent_dispatch" ] && [ "$subagent_dispatch" != "null" ]; }; then
        field_status "subagent_dispatch" "$subagent_dispatch"
      fi
      if [ "$build_mode" = "direct" ] && [ "$workflow" != "hotfix" ] && [ "$workflow" != "tweak" ]; then
        field_status "direct_override" "$direct_override"
      fi
      echo ""
      echo "  Plan:"
      field_status "plan" "$plan" "$plan"
      echo ""
      # Count completed vs pending tasks
      local tasks_file="$change_dir/tasks.md"
      local total=0 done=0 pending=0
      local plan_total=0 plan_done=0 plan_pending=0
      if [ -f "$tasks_file" ]; then
        total=$(grep -c '^[[:space:]]*- \[' "$tasks_file" 2>/dev/null || true)
        done=$(grep -c '^[[:space:]]*- \[x\]' "$tasks_file" 2>/dev/null || true)
        total="${total:-0}"
        done="${done:-0}"
        pending=$((total - done))
        echo "  Tasks: ${done}/${total} done, ${pending} pending"
      else
        echo "  Tasks: tasks.md MISSING"
      fi
      if [ -n "$plan" ] && [ "$plan" != "null" ] && [ -f "$plan" ]; then
        plan_total=$(grep -c '^[[:space:]]*- \[' "$plan" 2>/dev/null || true)
        plan_done=$(grep -c '^[[:space:]]*- \[x\]' "$plan" 2>/dev/null || true)
        plan_total="${plan_total:-0}"
        plan_done="${plan_done:-0}"
        plan_pending=$((plan_total - plan_done))
        if [ "$plan_total" -gt 0 ]; then
          echo "  Plan tasks: ${plan_done}/${plan_total} done, ${plan_pending} pending"
        fi
      fi
      echo ""
      if [ "$build_pause" = "plan-ready" ] && [ -n "$plan" ] && [ "$plan" != "null" ] && [ -f "$plan" ] && { [ "$isolation" = "null" ] || [ -z "$isolation" ] || [ "$build_mode" = "null" ] || [ -z "$build_mode" ]; }; then
        echo "Recovery action: Plan-ready pause detected. Ask the user whether to continue, then choose isolation and build mode without regenerating the plan."
      elif [ "$build_pause" = "plan-ready" ] && { [ -z "$plan" ] || [ "$plan" = "null" ] || [ ! -f "$plan" ]; }; then
        echo "Recovery action: Plan-ready pause is recorded, but the plan file is missing. Restore the plan file or rerun writing-plans before choosing execution."
      elif [ "$build_pause" = "plan-ready" ]; then
        if [ "$build_mode" = "subagent-driven-development" ] && { [ "$pending" -gt 0 ] || [ "$plan_pending" -gt 0 ]; }; then
          if [ "$subagent_dispatch" = "confirmed" ]; then
            echo "Recovery action: Plan-ready pause is stale because build decisions are already selected. Clear build_pause to null, then inspect the first unchecked task (OpenSpec or plan additions) against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window."
          else
            echo "Recovery action: Plan-ready pause is stale and subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing."
          fi
        elif [ "$pending" -gt 0 ] || [ "$plan_pending" -gt 0 ]; then
          echo "Recovery action: Plan-ready pause is stale because build decisions are already selected. Clear build_pause to null, then continue from the first unchecked task."
        else
          echo "Recovery action: Plan-ready pause is stale and all tasks are done. Clear build_pause to null, then run guard to transition to verify."
        fi
      elif [ "$isolation" = "null" ] || [ -z "$isolation" ]; then
        echo "Recovery action: Isolation not selected. Use the current platform's user confirmation mechanism to ask user for branch/worktree choice."
      elif [ "$build_mode" = "null" ] || [ -z "$build_mode" ]; then
        echo "Recovery action: Build mode not selected. Use the current platform's user confirmation mechanism to ask user for execution method."
      elif [ -z "$tdd_mode" ] || [ "$tdd_mode" = "null" ]; then
        echo "Recovery action: TDD mode not selected. Use the current platform's user confirmation mechanism to ask user for tdd or direct."
      elif [ ! -f "$tasks_file" ]; then
        echo "Recovery action: tasks.md missing. Verify change directory integrity."
      elif [ "$pending" -gt 0 ]; then
        if [ "$build_mode" = "subagent-driven-development" ]; then
          if [ "$subagent_dispatch" = "confirmed" ]; then
            echo "Recovery action: Read tasks.md and the Superpowers plan (which may include additions beyond OpenSpec), then inspect the first unchecked task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window."
          else
            echo "Recovery action: Subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing."
          fi
        else
          echo "Recovery action: Read tasks.md and continue from first unchecked task."
        fi
      elif [ "$plan_pending" -gt 0 ]; then
        if [ "$build_mode" = "subagent-driven-development" ]; then
          if [ "$subagent_dispatch" = "confirmed" ]; then
            echo "Recovery action: Read the Superpowers plan, then inspect the first unchecked Superpowers plan task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window."
          else
            echo "Recovery action: Subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing."
          fi
        else
          echo "Recovery action: Read the Superpowers plan and continue from the first unchecked plan task."
        fi
      else
        echo "Recovery action: All tasks done. Run guard to transition to verify."
      fi
      ;;
    verify)
      echo "  Verification:"
      field_status "verify_result" "$verify_result"
      field_status "verify_mode" "$verify_mode"
      field_status "verification_report" "$verification_report" "$verification_report"
      field_status "branch_status" "$branch_status"
      echo ""
      if [ "$verify_result" = "pass" ] && [ "$branch_status" = "handled" ]; then
        echo "Recovery action: Verification complete. Run guard to transition to archive."
      elif [ "$verify_result" = "pass" ]; then
        echo "Recovery action: Verification passed but branch not yet handled. Complete branch handling and set branch_status to handled."
      elif [ "$verify_result" = "fail" ]; then
        echo "Recovery action: Verification failed and rolled back to build. Resume from /comet-build."
      else
        echo "Recovery action: Verification not yet started or in progress. Run scale assessment then verify."
      fi
      ;;
    archive)
      echo "  Archive:"
      field_status "verify_result" "$verify_result"
      field_status "archived" "$(cmd_get "$change_name" "archived")"
      echo ""
      echo "Recovery action: Run /comet-archive to complete archiving."
      ;;
    *)
      red "ERROR: Unknown phase: $phase"
      exit 1
      ;;
  esac

  echo ""
  echo "=== End Recovery Context ==="
}

cmd_conflict_check() {
  local proposed_name="$1"
  shift
  local keywords=("$@")

  validate_change_name "$proposed_name"

  local conflicts=0
  local found_docs=""
  local index_file="docs/superpowers/INDEX.md"

  echo "=== Conflict Check: $proposed_name ==="

  # Auto-init INDEX.md if it doesn't exist (first-time use)
  if [ ! -f "$index_file" ]; then
    yellow "INDEX.md not found, initializing design registry..."
    cmd_index_init
  fi

  # Clean stale entries (change directories that no longer exist)
  cmd_index_clean_stale 2>/dev/null || true

  # 0. Check Design Registry (INDEX.md) first — authoritative source
  if [ -f "$index_file" ] && [ ${#keywords[@]} -gt 0 ]; then
    local index_hits=""
    for kw in "${keywords[@]}"; do
      # Match keyword in table rows (keyword column is last, backtick-wrapped)
      local matches
      matches=$(grep -i "\`$kw\`" "$index_file" 2>/dev/null | grep -v "^#" | grep -v "^>" || true)
      if [ -n "$matches" ]; then
        # Extract the design doc link from matched lines
        local doc_link
        doc_link=$(echo "$matches" | grep -o '\[design\]([^)]*)' | head -1 || true)
        local plan_link
        plan_link=$(echo "$matches" | grep -o '\[plan\]([^)]*)' | head -1 || true)
        local feature_name
        feature_name=$(echo "$matches" | head -1 | awk -F'|' '{gsub(/^[ \t]+|[ \t]+$/, "", $3); print $3}')
        
        yellow "INDEX HIT: Keyword '$kw' found in Design Registry — feature: $feature_name" >&2
        if [ -n "$doc_link" ]; then
          local doc_path
          doc_path="${doc_link#\[design\](}"
          doc_path="${doc_path%)}"
          found_docs="$found_docs\n  - docs/superpowers/$doc_path (INDEX keyword: $kw, feature: $feature_name)"
        fi
        if [ -n "$plan_link" ]; then
          local plan_path
          plan_path="${plan_link#\[plan\](}"
          plan_path="${plan_path%)}"
          found_docs="$found_docs\n  - docs/superpowers/$plan_path (INDEX keyword: $kw, feature: $feature_name)"
        fi
        conflicts=$((conflicts + 1))
        index_hits="$index_hits $kw"
      fi
    done
    
    # Also check proposed name against feature names in INDEX.md
    for kw in "${keywords[@]}"; do
      if grep -iq "$kw" "$index_file" 2>/dev/null | grep -q "|.*$kw.*|" 2>/dev/null; then
        : # already handled above
      fi
    done
    
    # If INDEX.md had hits, skip file-system scan (INDEX is authoritative)
    if [ "$conflicts" -gt 0 ]; then
      echo ""
      echo "Found $conflicts conflict(s) via Design Registry:"
      echo ""
      echo -e "$found_docs"
      echo ""
      red "ACTION REQUIRED: Related design already registered in INDEX.md." >&2
      red "Options:" >&2
      red "  1. Continue the existing change instead of creating a new one" >&2
      red "  2. Extend the existing design doc instead of creating a parallel one" >&2
      red "  3. Use a distinctly different name and confirm with user that scope is unrelated" >&2
      echo ""
      return 1
    else
      green "INDEX.md: no matching keywords found in registry"
    fi
  fi

  # 1. Check active (non-archived) changes with similar names
  if [ -d "openspec/changes" ]; then
    for change_dir in openspec/changes/*/; do
      [ -d "$change_dir" ] || continue
      local existing_name
      existing_name=$(basename "$change_dir")
      # Skip archive directory
      [ "$existing_name" = "archive" ] && continue

      # Name similarity check
      if [ "$existing_name" = "$proposed_name" ]; then
        red "CONFLICT: Active change with exact same name exists: $change_dir" >&2
        conflicts=$((conflicts + 1))
        continue
      fi

      # Keyword overlap with existing proposal.md
      if [ ${#keywords[@]} -gt 0 ] && [ -f "$change_dir/proposal.md" ]; then
        for kw in "${keywords[@]}"; do
          if grep -iq "$kw" "$change_dir/proposal.md" 2>/dev/null; then
            yellow "WARNING: Keyword '$kw' matches active change: $existing_name (proposal.md)" >&2
            found_docs="$found_docs\n  - $change_dir/proposal.md (matches: $kw)"
            conflicts=$((conflicts + 1))
            break
          fi
        done
      fi
    done
  fi

  # 2. Check docs/superpowers/specs/ for related design docs
  if [ -d "docs/superpowers/specs" ]; then
    for spec_file in docs/superpowers/specs/*.md; do
      [ -f "$spec_file" ] || continue
      local basename_spec
      basename_spec=$(basename "$spec_file")
      # Skip conflict-report files
      echo "$basename_spec" | grep -q "conflict-report" && continue

      # Check filename for keyword matches
      for kw in "${keywords[@]}"; do
        if echo "$basename_spec" | grep -iq "$kw"; then
          yellow "WARNING: Keyword '$kw' matches existing design doc: $spec_file" >&2
          found_docs="$found_docs\n  - $spec_file (filename matches: $kw)"
          conflicts=$((conflicts + 1))
          break
        fi
      done

      # Check file content for keyword matches (first 20 lines for frontmatter/title)
      if [ ${#keywords[@]} -gt 0 ]; then
        for kw in "${keywords[@]}"; do
          if head -20 "$spec_file" 2>/dev/null | grep -iq "$kw"; then
            yellow "WARNING: Keyword '$kw' found in: $spec_file" >&2
            # Only count if not already counted by filename match
            if ! echo "$basename_spec" | grep -iq "$kw"; then
              found_docs="$found_docs\n  - $spec_file (content matches: $kw)"
              conflicts=$((conflicts + 1))
            fi
            break
          fi
        done
      fi
    done
  fi

  # 3. Check docs/superpowers/plans/ for related plans
  if [ -d "docs/superpowers/plans" ]; then
    for plan_file in docs/superpowers/plans/*.md; do
      [ -f "$plan_file" ] || continue
      for kw in "${keywords[@]}"; do
        if basename "$plan_file" | grep -iq "$kw"; then
          yellow "WARNING: Keyword '$kw' matches existing plan: $plan_file" >&2
          found_docs="$found_docs\n  - $plan_file (filename matches: $kw)"
          conflicts=$((conflicts + 1))
          break
        fi
      done
    done
  fi

  # Output summary
  echo ""
  if [ "$conflicts" -gt 0 ]; then
    echo "Found $conflicts potential conflict(s):"
    echo ""
    echo -e "$found_docs"
    echo ""
    red "ACTION REQUIRED: Related documents already exist." >&2
    red "Options:" >&2
    red "  1. Continue the existing change instead of creating a new one" >&2
    red "  2. Extend the existing design doc instead of creating a parallel one" >&2
    red "  3. Use a distinctly different name and confirm with user that scope is unrelated" >&2
    echo ""
    return 1
  else
    green "No conflicts found — safe to create new change"
    return 0
  fi
}

cmd_scale() {
  local change_name="$1"

  validate_change_name "$change_name"

  local change_dir="openspec/changes/$change_name"
  local yaml_file="$change_dir/.comet.yaml"

  # Verify .comet.yaml exists
  if [ ! -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml not found at $yaml_file"
    exit 1
  fi

  # Read metrics
  # 1. Task count: count lines matching `- [` in tasks.md
  local tasks_file="$change_dir/tasks.md"
  local task_count=0
  if [ -f "$tasks_file" ]; then
    task_count=$(grep -c '^\- \[' "$tasks_file" 2>/dev/null || echo "0")
  fi

  # 2. Delta spec count: count files named spec.md under specs/*/spec.md
  local delta_spec_count=0
  if [ -d "$change_dir/specs" ]; then
    delta_spec_count=$(find "$change_dir/specs" -name "spec.md" -type f 2>/dev/null | wc -l | tr -d ' ')
  fi

  # 3. Changed files: prefer plan base-ref, then .comet.yaml base_ref, fall back to worktree diff
  local changed_files=0
  if git rev-parse --git-dir > /dev/null 2>&1; then
    local plan_file base_ref=""
    plan_file=$(cmd_get "$change_name" "plan" 2>/dev/null || true)
    if [ -n "$plan_file" ] && [ "$plan_file" != "null" ] && [ -f "$plan_file" ]; then
      base_ref=$(grep '^base-ref:' "$plan_file" 2>/dev/null | head -1 | sed 's/^base-ref: *//' || true)
    fi
    # Fallback to base_ref stored in .comet.yaml (set during init)
    if [ -z "$base_ref" ] || [ "$base_ref" = "null" ]; then
      base_ref=$(cmd_get "$change_name" "base_ref" 2>/dev/null || true)
    fi

    if [ -n "${base_ref:-}" ] && [ "$base_ref" != "null" ] && git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
      changed_files=$(git diff --name-only "$base_ref"...HEAD 2>/dev/null | wc -l | tr -d ' ')
    else
      changed_files=$(git diff --name-only HEAD 2>/dev/null | wc -l | tr -d ' ')
    fi
  fi

  # Decision rules
  local result="light"
  if [ "$task_count" -gt 3 ] || [ "$delta_spec_count" -gt 1 ] || [ "$changed_files" -gt 4 ]; then
    result="full"
  fi

  # Output assessment to stderr
  echo "=== Scale Assessment: $change_name ===" >&2
  echo "  Tasks: $task_count (threshold: 3)" >&2
  echo "  Delta specs: $delta_spec_count capabilities (threshold: 1)" >&2
  echo "  Changed files: $changed_files (threshold: 4)" >&2
  echo "  → Result: $result" >&2

  # Update verify_mode in .comet.yaml
  replace_yaml_field "$yaml_file" "verify_mode" "$result"

  green "[SCALE] verify_mode=$result"
}

# Resolve the next workflow step after a guard --apply phase advance.
# Reads the (already advanced) phase, workflow, and auto_transition, then emits
# a deterministic next-step contract so skills don't hardcode the next skill name.
#
# Output contract (stdout):
#   NEXT: auto|manual|done
#   SKILL: <skill-name>      (omitted when NEXT=done)
#   HINT: <message>          (only when NEXT=manual)
cmd_next() {
  local change_name="$1"
  validate_change_name "$change_name"

  local change_dir="openspec/changes/$change_name"
  local yaml_file="$change_dir/.comet.yaml"
  if [ ! -f "$yaml_file" ]; then
    red "ERROR: .comet.yaml not found at $yaml_file" >&2
    exit 1
  fi

  local phase workflow auto_transition archived
  phase=$(cmd_get "$change_name" "phase" 2>/dev/null || true)
  workflow=$(cmd_get "$change_name" "workflow" 2>/dev/null || true)
  auto_transition=$(cmd_get "$change_name" "auto_transition" 2>/dev/null || true)
  archived=$(cmd_get "$change_name" "archived" 2>/dev/null || true)

  # Change-level auto_transition overrides project-level; fall back to project default
  if [ -z "$auto_transition" ] || [ "$auto_transition" = "null" ]; then
    auto_transition="$(project_auto_transition_default)"
  fi

  # Terminal state: archived change has no next step.
  if [ "$archived" = "true" ]; then
    echo "NEXT: done"
    return 0
  fi

  # Map the current (post-advance) phase to the skill that owns it.
  local skill=""
  case "$phase" in
    open)
      skill="comet-open"
      ;;
    design)
      skill="comet-design"
      ;;
    build)
      case "$workflow" in
        hotfix) skill="comet-hotfix" ;;
        tweak)  skill="comet-tweak" ;;
        *)      skill="comet-build" ;;
      esac
      ;;
    verify)
      skill="comet-verify"
      ;;
    archive)
      skill="comet-archive"
      ;;
    *)
      red "ERROR: Cannot resolve next step for '$change_name': unknown phase '${phase:-null}'" >&2
      exit 1
      ;;
  esac

  # auto_transition=false pauses the next skill invocation only; phase is already advanced.
  if [ "$auto_transition" = "false" ]; then
    echo "NEXT: manual"
    echo "SKILL: $skill"
    echo "HINT: phase is '$phase'; run /$skill manually to continue"
  else
    echo "NEXT: auto"
    echo "SKILL: $skill"
  fi
}

# --- INDEX.md management ---

INDEX_FILE="docs/superpowers/INDEX.md"

# Initialize INDEX.md with standard structure if it doesn't exist
cmd_index_init() {
  if [ -f "$INDEX_FILE" ]; then
    green "INDEX.md already exists at $INDEX_FILE"
    return 0
  fi

  mkdir -p "$(dirname "$INDEX_FILE")"
  cat > "$INDEX_FILE" << 'INDEXEOF'
# Feature Index

This file tracks implemented features to prevent duplicate designs and provide change history.

## In Progress

| Date | Feature | Status | Keywords | Description | Archive |
|------|---------|--------|----------|-------------|---------|

## Completed

| Date | Feature | Status | Keywords | Description | Archive |
|------|---------|--------|----------|-------------|---------|
INDEXEOF

  green "Created $INDEX_FILE with standard structure"
}

# Add a new entry to "In Progress" table
# Usage: index-add <change-name> [keywords...]
cmd_index_add() {
  local change_name="$1"
  shift
  local keywords=("$@")

  # Ensure INDEX.md exists
  if [ ! -f "$INDEX_FILE" ]; then
    cmd_index_init
  fi

  # Get date from .comet.yaml or use today
  local date
  local yaml_file="openspec/changes/$change_name/.comet.yaml"
  if [ -f "$yaml_file" ]; then
    date=$(grep "^created_at:" "$yaml_file" 2>/dev/null | awk '{print $2}' || true)
  fi
  if [ -z "$date" ]; then
    date=$(date +%Y-%m-%d)
  fi

  # Extract feature name and description from proposal.md
  local feature="$change_name"
  local description=""
  local proposal="openspec/changes/$change_name/proposal.md"
  if [ -f "$proposal" ]; then
    # Get title (first # heading)
    local title
    title=$(grep -E '^# ' "$proposal" | head -1 | sed 's/^# *//' || true)
    if [ -n "$title" ]; then
      feature="$title"
    fi
    # Get description (first paragraph after title, skip empty lines)
    description=$(awk '/^# /{found=1; next} found && /^$/{next} found && /^[^#]/ && !/^\|/{print; exit}' "$proposal" || true)
    if [ -z "$description" ]; then
      # Fallback: get first non-empty, non-heading line
      description=$(grep -v '^#' "$proposal" | grep -v '^$' | grep -v '^|' | head -1 || true)
    fi
    # Truncate description if too long (max 60 chars)
    if [ ${#description} -gt 60 ]; then
      description="${description:0:57}..."
    fi
  fi

  # Check if entry already exists (match by feature name in column 2)
  if awk -v name="$feature" 'BEGIN{FS="|"} {gsub(/^[ \t]+|[ \t]+$/, "", $2); if($2 == name) found=1} END{exit !found}' "$INDEX_FILE" 2>/dev/null; then
    yellow "Entry for '$feature' already exists in INDEX.md"
    return 0
  fi

  # Format keywords with backticks
  local kw_formatted=""
  if [ ${#keywords[@]} -gt 0 ]; then
    for kw in "${keywords[@]}"; do
      if [ -n "$kw_formatted" ]; then
        kw_formatted="$kw_formatted, "
      fi
      kw_formatted="${kw_formatted}\`$kw\`"
    done
  fi

  # Build the row: | Date | Feature | Status | Keywords | Description | Archive |
  local status="in-progress"
  local row="| $date | $feature | $status | $kw_formatted | $description | - |"

  # Insert after the header row in "In Progress" section
  awk -v row="$row" '
    /^## In Progress$/ { in_progress=1; print; next }
    in_progress && /^\| Date/ { print; getline; print; print row; in_progress=0; next }
    { print }
  ' "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"

  green "Added '$feature' to INDEX.md In Progress"
}

# Update status or description for an existing entry
# Usage: index-update <change-name> <field> <value>
# field: status | description
cmd_index_update() {
  local change_name="$1"
  local field="$2"
  local value="$3"

  if [ ! -f "$INDEX_FILE" ]; then
    yellow "INDEX.md does not exist, nothing to update"
    return 0
  fi

  # Extract feature name from proposal
  local feature="$change_name"
  local proposal="openspec/changes/$change_name/proposal.md"
  if [ -f "$proposal" ]; then
    local title
    title=$(grep -E '^# ' "$proposal" | head -1 | sed 's/^# *//' || true)
    if [ -n "$title" ]; then
      feature="$title"
    fi
  fi

  # Check if entry exists (match by feature name in column 2)
  if ! awk -v name="$feature" 'BEGIN{FS="|"} {gsub(/^[ \t]+|[ \t]+$/, "", $2); if($2 == name) found=1} END{exit !found}' "$INDEX_FILE" 2>/dev/null; then
    yellow "Entry for '$feature' not found in INDEX.md, adding new entry"
    cmd_index_add "$change_name"
  fi

  # Determine which column to update
  local col
  case "$field" in
    status) col=3 ;;
    description) col=5 ;;
    *) red "Unknown field: $field (expected status or description)" >&2; return 1 ;;
  esac

  # Use awk to update the specific column for matching row (match by column 2)
  awk -v feature="$feature" -v col="$col" -v value="$value" '
    BEGIN { FS="|"; OFS="|" }
    {
      # Extract and trim column 2 for exact match
      col2 = $2
      gsub(/^[ \t]+|[ \t]+$/, "", col2)
      # Check if this row matches feature name exactly in column 2
      if (col2 == feature) {
        $col = " " value " "
      }
      print
    }
  ' "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"

  green "Updated $field for '$feature' in INDEX.md"
}

# Move entry from "In Progress" to "Completed"
# Usage: index-complete <change-name> [archive-path]
cmd_index_complete() {
  local change_name="$1"
  local archive_path="$2"

  if [ ! -f "$INDEX_FILE" ]; then
    yellow "INDEX.md does not exist, nothing to complete"
    return 0
  fi

  # Get feature name from proposal (check original path first, then archive path)
  local feature="$change_name"
  local proposal=""
  
  # Try original path first
  if [ -f "openspec/changes/$change_name/proposal.md" ]; then
    proposal="openspec/changes/$change_name/proposal.md"
  # Try archive path if provided
  elif [ -n "$archive_path" ] && [ -f "$archive_path/proposal.md" ]; then
    proposal="$archive_path/proposal.md"
  # Search in archive directory by pattern
  elif [ -d "openspec/changes/archive" ]; then
    local found_dir
    found_dir=$(find "openspec/changes/archive" -maxdepth 1 -type d -name "*-$change_name" 2>/dev/null | head -1)
    if [ -n "$found_dir" ] && [ -f "$found_dir/proposal.md" ]; then
      proposal="$found_dir/proposal.md"
    fi
  fi
  
  if [ -n "$proposal" ]; then
    local title
    title=$(grep -E '^# ' "$proposal" | head -1 | sed 's/^# *//' || true)
    if [ -n "$title" ]; then
      feature="$title"
    fi
  fi

  # Get archive date
  local date
  date=$(date +%Y-%m-%d)

  # Extract the row from "In Progress" section (match by exact column 2 value)
  local row
  row=$(awk -v feature="$feature" '
    BEGIN { FS="|"; found=0 }
    /^## In Progress$/ { in_progress=1; next }
    /^## / { in_progress=0 }
    in_progress {
      col2 = $2
      gsub(/^[ \t]+|[ \t]+$/, "", col2)
      if (col2 == feature) { print; found=1; exit }
    }
  ' "$INDEX_FILE")

  if [ -z "$row" ]; then
    yellow "Entry for '$feature' not found in In Progress"
    return 0
  fi

  # Update the row: Date (col 1), Status (col 3), Archive (col 6)
  local completed_row
  completed_row=$(echo "$row" | awk -v date="$date" -v archive="$archive_path" '
    BEGIN { FS="|"; OFS="|" }
    {
      $1 = " " date " "
      $3 = " completed "
      if (archive != "" && archive != "-") {
        $6 = " " archive " "
      }
      print
    }
  ')

  # Remove from In Progress and add to Completed
  awk -v feature="$feature" -v completed="$completed_row" '
    BEGIN { FS="|"; OFS="|" }
    /^## Completed$/ { in_completed=1 }
    /^## / && !/^## Completed$/ { in_completed=0 }
    # Remove matching row from In Progress (exact match on column 2)
    /^## In Progress$/ { in_progress=1; print; next }
    in_progress {
      col2 = $2
      gsub(/^[ \t]+|[ \t]+$/, "", col2)
      if (col2 == feature) { in_progress=0; next }
    }
    /^## / { in_progress=0 }
    # Add completed row after Completed header row
    in_completed && /^\| Date/ { print; getline; print; print completed; in_completed=0; next }
    { print }
  ' "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"

  green "Moved '$feature' from In Progress to Completed in INDEX.md"
}

# Clean stale entries (change directory no longer exists)
cmd_index_clean_stale() {
  if [ ! -f "$INDEX_FILE" ]; then
    return 0
  fi

  local stale_count=0

  # Find entries in "In Progress" where change dir doesn't exist
  # Extract feature name from column 2
  awk '
    BEGIN { FS="|" }
    /^## In Progress$/ { in_progress=1; next }
    /^## / { in_progress=0 }
    in_progress && /^\| [0-9]/ {
      # Extract feature name (2nd column)
      gsub(/^[ \t]+|[ \t]+$/, "", $2)
      print $2
    }
  ' "$INDEX_FILE" | while read -r feature; do
    # Try to find matching change directory (check both active and archived)
    local found=0
    
    # Check active changes
    if [ -d "openspec/changes/$feature" ]; then
      found=1
    elif [ -d "openspec/changes" ]; then
      for dir in openspec/changes/*/; do
        [ -d "$dir" ] || continue
        local name
        name=$(basename "$dir")
        [ "$name" = "archive" ] && continue
        # Check if feature matches change name
        if [ "$name" = "$feature" ]; then
          found=1
          break
        fi
        # Check proposal title
        local proposal="$dir/proposal.md"
        if [ -f "$proposal" ]; then
          local title
          title=$(grep -E '^# ' "$proposal" | head -1 | sed 's/^# *//' || true)
          if [ "$title" = "$feature" ]; then
            found=1
            break
          fi
        fi
      done
    fi
    
    # Check archived changes if not found in active
    if [ "$found" -eq 0 ] && [ -d "openspec/changes/archive" ]; then
      for dir in openspec/changes/archive/*/; do
        [ -d "$dir" ] || continue
        local name
        name=$(basename "$dir")
        # Archive format: YYYY-MM-DD-change-name
        if [[ "$name" == *-"$feature" ]]; then
          found=1
          break
        fi
        # Check proposal title
        local proposal="$dir/proposal.md"
        if [ -f "$proposal" ]; then
          local title
          title=$(grep -E '^# ' "$proposal" | head -1 | sed 's/^# *//' || true)
          if [ "$title" = "$feature" ]; then
            found=1
            break
          fi
        fi
      done
    fi
    if [ "$found" -eq 0 ]; then
      echo "$feature"
    fi
  done > /tmp/comet-stale-features.txt

  if [ -s /tmp/comet-stale-features.txt ]; then
    while read -r stale_feature; do
      yellow "Stale entry found: '$stale_feature' (change directory no longer exists)"
      # Remove the stale row using exact match on column 2
      awk -v feature="$stale_feature" '
        BEGIN { FS="|" }
        {
          col2 = $2
          gsub(/^[ \t]+|[ \t]+$/, "", col2)
          if (col2 == feature) next
        }
        { print }
      ' "$INDEX_FILE" > "$INDEX_FILE.tmp" && mv "$INDEX_FILE.tmp" "$INDEX_FILE"
      stale_count=$((stale_count + 1))
    done < /tmp/comet-stale-features.txt
    green "Cleaned $stale_count stale entries from INDEX.md"
  else
    green "No stale entries found in INDEX.md"
  fi

  rm -f /tmp/comet-stale-features.txt
}

# Read global preference from ~/.comet/config.yaml
# Usage: get-preference <field>
cmd_get_preference() {
  local field="$1"
  local config_file="${COMET_GLOBAL_CONFIG:-$HOME/.comet}/config.yaml"
  
  if [ ! -f "$config_file" ]; then
    return 0
  fi
  
  # Simple YAML parser for key: value format
  local value
  value=$(grep -E "^${field}:" "$config_file" 2>/dev/null | sed 's/^[^:]*: *//' | tr -d '\r' || true)
  
  if [ -n "$value" ]; then
    echo "$value"
  fi
}

# --- Main ---

SUBCOMMAND="${1:-}"
shift || true

case "$SUBCOMMAND" in
  init)
    if [ $# -lt 2 ]; then
      red "Usage: comet-state.sh init <change-name> <workflow>" >&2
      red "Workflows: full, hotfix, tweak" >&2
      exit 1
    fi
    cmd_init "$@"
    ;;
  get)
    if [ $# -lt 2 ]; then
      red "Usage: comet-state.sh get <change-name> <field>" >&2
      exit 1
    fi
    cmd_get "$@"
    ;;
  set)
    if [ $# -lt 3 ]; then
      red "Usage: comet-state.sh set <change-name> <field> <value>" >&2
      exit 1
    fi
    cmd_set "$@"
    ;;
  transition)
    if [ $# -lt 2 ]; then
      red "Usage: comet-state.sh transition <change-name> <event>" >&2
      red "Events: open-complete, design-complete, build-complete, verify-pass, verify-fail, archive-reopen, archived" >&2
      exit 1
    fi
    cmd_transition "$@"
    ;;
  check)
    if [ $# -lt 2 ]; then
      red "Usage: comet-state.sh check <change-name> <phase> [--recover]" >&2
      red "Phases: open, design, build, verify, archive" >&2
      exit 1
    fi
    # Detect --recover flag (3rd argument)
    if [ "${3:-}" = "--recover" ]; then
      cmd_recover "$1"
    else
      cmd_check "$@"
    fi
    ;;
  conflict-check)
    if [ $# -lt 1 ]; then
      red "Usage: comet-state.sh conflict-check <proposed-name> [keywords...]" >&2
      exit 1
    fi
    cmd_conflict_check "$@"
    ;;
  scale)
    if [ $# -lt 1 ]; then
      red "Usage: comet-state.sh scale <change-name>" >&2
      exit 1
    fi
    cmd_scale "$@"
    ;;
  next)
    if [ $# -lt 1 ]; then
      red "Usage: comet-state.sh next <change-name>" >&2
      exit 1
    fi
    cmd_next "$@"
    ;;
  index-init)
    cmd_index_init
    ;;
  index-add)
    if [ $# -lt 1 ]; then
      red "Usage: comet-state.sh index-add <change-name> [keywords...]" >&2
      exit 1
    fi
    cmd_index_add "$@"
    ;;
  index-update)
    if [ $# -lt 3 ]; then
      red "Usage: comet-state.sh index-update <change-name> <design_doc|plan> <path>" >&2
      exit 1
    fi
    cmd_index_update "$@"
    ;;
  index-complete)
    if [ $# -lt 1 ]; then
      red "Usage: comet-state.sh index-complete <change-name>" >&2
      exit 1
    fi
    cmd_index_complete "$@"
    ;;
  index-clean-stale)
    cmd_index_clean_stale
    ;;
  get-preference)
    if [ $# -lt 1 ]; then
      red "Usage: comet-state.sh get-preference <field>" >&2
      exit 1
    fi
    cmd_get_preference "$@"
    ;;
  *)
    red "Unknown subcommand: $SUBCOMMAND" >&2
    echo "" >&2
    echo "Usage: comet-state.sh <subcommand> <change-name> [args...]" >&2
    echo "" >&2
    echo "Subcommands:" >&2
    echo "  init <change-name> <workflow>  — Initialize .comet.yaml with workflow defaults" >&2
    echo "  get <change-name> <field>       — Read a field value from .comet.yaml" >&2
    echo "  set <change-name> <field> <val> — Update a field value in .comet.yaml" >&2
    echo "  transition <change-name> <event> — Apply a validated state transition" >&2
    echo "  check <change-name> <phase>    — Verify entry requirements for a phase" >&2
    echo "  conflict-check <name> [keywords...] — Scan for related existing documents" >&2
    echo "  scale <change-name>             — Assess and set verification mode based on metrics" >&2
    echo "  next <change-name>              — Resolve the next workflow step (auto/manual/done)" >&2
    echo "  index-init                      — Initialize INDEX.md design registry" >&2
    echo "  index-add <name> [keywords...]  — Add change to In Progress table" >&2
    echo "  index-update <name> <field> <v> — Update design_doc or plan link" >&2
    echo "  index-complete <name>           — Move from In Progress to Completed" >&2
    echo "  index-clean-stale               — Remove entries for deleted changes" >&2
    echo "" >&2
    echo "Workflows: full, hotfix, tweak" >&2
    echo "Phases for check: open, design, build, verify, archive" >&2
    exit 1
    ;;
esac
