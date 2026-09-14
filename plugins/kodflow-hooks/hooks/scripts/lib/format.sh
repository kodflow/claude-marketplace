#!/bin/bash
# lib/format.sh — formatter table, sourced by on-tool.sh on PostToolUse only
# when a code file was written. Defines hook_format FILE. Not a hook entry.
#
# Makefile first: a project that declares `fmt` or `format` owns its
# formatting. Otherwise one direct formatter per extension, and nothing when
# that formatter is not on PATH — the hook must stay silent where the tool is
# absent, not install anything.

# Walk up to the nearest build marker; fall back to the git root, then to the
# starting directory. The git root matters: a file with no Makefile above it
# would otherwise be formatted from its own directory, where a repo-level
# .prettierrc or ruff.toml is out of reach.
hook_project_root() {
    local d=$1 top
    while [ "$d" != "/" ] && [ -n "$d" ]; do
        [ -f "$d/Makefile" ] || [ -f "$d/package.json" ] || [ -f "$d/pyproject.toml" ] || \
        [ -f "$d/go.mod" ] || [ -f "$d/Cargo.toml" ] || [ -f "$d/build.zig" ] || \
        [ -f "$d/pom.xml" ] || [ -f "$d/build.gradle" ] || [ -f "$d/build.gradle.kts" ] || \
        [ -f "$d/composer.json" ] || [ -f "$d/Gemfile" ] || [ -f "$d/mix.exs" ] && { printf '%s' "$d"; return; }
        d=${d%/*}
    done
    top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) && { printf '%s' "$top"; return; }
    printf '%s' "$1"
}

# `target:` at line start, optionally with prerequisites; not `target := x`,
# not `# target:`, not `other-target:`.
hook_make_target() { grep -Eq "^$1([[:space:]]+[[:alnum:]_.-]+)*:[^=]*$" "$2/Makefile" 2>/dev/null; }

hook_format() {
    local f=$1 ext=${1##*.} root
    FMT_TOOL=""
    root=$(hook_project_root "${f%/*}")

    if [ -f "$root/Makefile" ]; then
        local t
        for t in fmt format; do
            hook_make_target "$t" "$root" || continue
            FMT_TOOL="make $t"
            if grep -qE 'FILE[[:space:]]*[:?]?=' "$root/Makefile" 2>/dev/null; then
                (cd "$root" && make "$t" FILE="$f" >/dev/null 2>&1)
            else
                (cd "$root" && make "$t" >/dev/null 2>&1)
            fi
            return 0
        done
    fi

    local tool="" run=""
    case "$ext" in
        js|jsx|ts|tsx|mjs|cjs|json|yml|yaml|html|htm|css|scss|less)
                tool=prettier;   run='prettier --write "$f"' ;;
        py)     if command -v ruff >/dev/null 2>&1; then
                    tool=ruff;   run='ruff format "$f" && ruff check --select I --fix "$f"'
                else tool=black; run='black --quiet "$f"'; fi ;;
        go)     if command -v goimports >/dev/null 2>&1; then tool=goimports; run='goimports -w "$f"'
                else tool=gofmt; run='gofmt -w "$f"'; fi ;;
        rs)     tool=rustfmt;    run='rustfmt "$f"' ;;
        zig)    tool=zig;        run='zig fmt "$f"' ;;
        sh|bash) tool=shfmt;     run='shfmt -w "$f"' ;;
        tf|tfvars) tool=terraform; run='terraform fmt "$f"' ;;
        c|cpp|cc|cxx|h|hpp) tool=clang-format; run='clang-format -i --sort-includes "$f"' ;;
        java)   tool=google-java-format; run='google-java-format --replace "$f"' ;;
        kt|kts) tool=ktlint;     run='ktlint -F "$f"' ;;
        rb)     tool=rubocop;    run='rubocop -a "$f"' ;;
        php)    tool=php-cs-fixer; run='php-cs-fixer fix "$f" --quiet' ;;
        swift)  tool=swiftformat; run='swiftformat "$f"' ;;
        dart)   tool=dart;       run='dart format "$f"' ;;
        ex|exs) tool=mix;        run='mix format "$f"' ;;
        lua)    tool=stylua;     run='stylua "$f"' ;;
        toml)   tool=taplo;      run='taplo fmt "$f"' ;;
        sql)    tool=pg_format;  run='pg_format -i "$f"' ;;
        cs|vb)  tool=dotnet;     run='dotnet format "$f"' ;;
        xml)    tool=xmllint;    run='xmllint --format "$f" --output "$f"' ;;
        *)      return 0 ;;
    esac
    command -v "$tool" >/dev/null 2>&1 || return 0
    FMT_TOOL=$tool
    eval "$run" >/dev/null 2>&1
    return 0
}
