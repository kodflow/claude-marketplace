# blocks.sh — the session's journal of refusals: <session dir>/blocks.jsonl.
# shellcheck shell=bash
#
# One JSON line per call that something stopped, appended, the last 500 kept:
#   {"ts":…,"kind":"hook|classifier|permission|ci|agent","tool":…,
#    "summary":…,"motif":…,"agent":…,"rule":…,"ref":…}
# kind hook is a guard of kodflow-hooks (motif = its [motif:…]); classifier a
# refusal of auto mode (PermissionDenied); agent a subagent that stopped with
# a task in progress. `rule` is the permission rule that would have let the
# call through, in settings.json form, when it can be read off the call.
#
#   . "$LIB/blocks.sh"
#   kf_block SDIR KIND TOOL SUMMARY MOTIF AGENT [RULE] [REF] [ID]
#
# ID (a tool_use_id) is written once: the same refusal seen twice (the
# PermissionDenied event and a failure carrying its text) is one line.
# Never fails, never prints, never waits more than a second for the lock.

KF_BLOCKS_MAX=${KF_BLOCKS_MAX:-500}

kf_block() {
    local sd=$1 kind=$2 tool=$3 summary=$4 motif=$5 agent=$6 rule=${7:-} ref=${8:-} id=${9:-} line
    [ -n "$sd" ] && [ -n "$kind" ] || return 0
    command -v jq >/dev/null 2>&1 || return 0
    line=$(jq -n -c --arg ts "$(date -u +%FT%TZ)" --arg kind "$kind" --arg tool "$tool" \
        --arg summary "$summary" --arg motif "$motif" --arg agent "$agent" --arg rule "$rule" --arg ref "$ref" '
        def opt($k; $v): if $v == "" then {} else {($k): $v} end;
        {ts: $ts, kind: $kind} + opt("tool"; $tool)
        + {summary: ($summary | [explode[] | if . < 32 then 32 else . end] | implode | .[:300])}
        + opt("motif"; $motif) + opt("agent"; $agent) + opt("rule"; $rule) + opt("ref"; $ref)' 2>/dev/null) || return 0
    [ -n "$line" ] || return 0
    (
        mkdir -p "$sd" 2>/dev/null || exit 0
        # shellcheck source=lock.sh
        . "${BASH_SOURCE[0]%/*}/lock.sh" 2>/dev/null && kf_lock "$sd/.blocks.lock.d" 1
        f=$sd/blocks.jsonl
        if [ -n "$id" ]; then
            grep -qxF -- "$id" "$sd/blocks.seen" 2>/dev/null && exit 0
            printf '%s\n' "$id" >> "$sd/blocks.seen"
            [ "$(wc -l < "$sd/blocks.seen" 2>/dev/null)" -gt 200 ] 2>/dev/null \
                && tail -n 100 "$sd/blocks.seen" > "$sd/blocks.seen.tmp" && mv -f "$sd/blocks.seen.tmp" "$sd/blocks.seen"
        fi
        printf '%s\n' "$line" >> "$f"
        if [ "$(wc -l < "$f" 2>/dev/null)" -gt "$KF_BLOCKS_MAX" ] 2>/dev/null; then
            tail -n "$KF_BLOCKS_MAX" "$f" > "$f.$$.tmp" 2>/dev/null && mv -f "$f.$$.tmp" "$f"
            rm -f "$f.$$.tmp"
        fi
    ) >/dev/null 2>&1 </dev/null
    return 0
}

# The permission rule that would have allowed the call, read from the hook's
# input on stdin; empty when nothing sensible can be said. Bash keeps the
# command and its subcommand (git push, npm run), a file tool its absolute
# path (// is settings.json's absolute form), WebFetch its domain, any other
# tool its name.
kf_block_rule() {
    jq -r '
        (.tool_name // "") as $t | (.tool_input // {}) as $i
        | if $t == "Bash" then
            ($i.command // "" | tostring | split("\n")[0]
             | [splits("[ \t]+")] | map(select(length > 0))
             | map(select(test("^[A-Za-z_][A-Za-z0-9_]*=") | not))) as $w
            | if ($w | length) == 0 then ""
              elif ($w | length) > 1 and ($w[1] | test("^[a-z][a-z0-9_-]*$")) then "Bash(\($w[0]) \($w[1]):*)"
              else "Bash(\($w[0]):*)" end
          elif ($t | test("^(Edit|Write|MultiEdit|NotebookEdit)$")) then
            ($i.file_path // $i.notebook_path // "") as $p
            | if ($p | startswith("/")) then "Edit(/\($p))" else "" end
          elif $t == "Read" then
            ($i.file_path // "") as $p | if ($p | startswith("/")) then "Read(/\($p))" else "" end
          elif $t == "WebFetch" then
            (($i.url // "" | capture("^[a-z]+://(?<h>[^/:?#]+)") | .h)? // "") as $h
            | if $h == "" then "WebFetch" else "WebFetch(domain:\($h))" end
          elif $t == "" then ""
          else $t end' 2>/dev/null
}
