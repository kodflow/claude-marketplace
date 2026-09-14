# Apply Changes

## Phase 4.0: Extract & Apply (From Tarball)

**Copy files from extracted tarballs to their destinations.
No per-file HTTP validation needed: the tarball is already validated.**

```yaml
extract_workflow:
  rule: "Copy from extracted tarball, validate non-empty"

  devcontainer_extract:
    strategy: "cp from extract dir to local paths"
    compose_strategy: "REPLACE devcontainer service, PRESERVE custom"

  infra_extract:
    strategy: "cp with protected path filtering"
    skip_protected: true
```

**Implementation:**

```bash
# rtk is wired by the kodflow-hooks plugin (on-tool.sh); no settings.json migration
# is needed and none is attempted here.
unset _legacy_rtk _wrapper_rtk _tmp_settings

# Migration: remove deprecated MCP servers from runtime mcp.json
if [ -f "$HOME/.claude/mcp.json" ] && command -v jq &>/dev/null; then
        if jq -e ".mcpServers.$server" "$HOME/.claude/mcp.json" &>/dev/null; then
            jq "del(.mcpServers.$server)" "$HOME/.claude/mcp.json" > "$HOME/.claude/mcp.json.tmp" && \
                mv "$HOME/.claude/mcp.json.tmp" "$HOME/.claude/mcp.json"
            echo "  Removed deprecated $server MCP server"
        fi
    done
fi

# Migration: remove .taskmaster/ directory
[ -d ".taskmaster" ] && rm -rf ".taskmaster" && echo "  Removed deprecated .taskmaster/"

fi
fi
```

### 5.7: Update devcontainer version file

```bash
# Get commit SHA via git ls-remote (strip-components removes dir name)
DC_COMMIT=$(git ls-remote "https://github.com/$DEVCONTAINER_REPO.git" "$DEVCONTAINER_BRANCH" | cut -c1-7)
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$CONTEXT" = "container" ]; then
    echo "{\"commit\": \"$DC_COMMIT\", \"updated\": \"$DATE\"}" > .devcontainer/.template-version
else
    echo "{\"commit\": \"$DC_COMMIT\", \"updated\": \"$DATE\"}" > "$UPDATE_TARGET/.template-version"
fi
echo "  ✓ .template-version updated ($DC_COMMIT)"
```

### 5.8: Cleanup temp directories

```bash
# Temp directories are cleaned up automatically by trap EXIT
# Registered via CLEANUP_DIRS during download phase
```

### 5.9: Consolidated report

**Output (devcontainer only):**

```
═══════════════════════════════════════════════
  ✓ DevContainer updated successfully
═══════════════════════════════════════════════

  Profile : devcontainer
  Method  : git tarball (1 API call)
  Source  : kodflow/devcontainer-template
  Version : def5678

  Updated components:
    ✓ hooks          (scripts)
    ✓ commands       (slash commands + sub-modules)
    ✓ agents         (agent definitions)
    ✓ lifecycle      (delegation stubs)
    ✓ image-hooks    (image-embedded hooks)
    ✓ shared-utils   (utils.sh)
    ✓ p10k           (powerlevel10k)
    ✓ settings       (settings.json)
    ✓ compose        (devcontainer service)
    ✓ mcp-template   (mcp.json.tpl)
    ✓ mcp-fragments  (context7, project-linter)
    ✓ features       (devcontainer features, 25 languages)
    ✓ docs           (design patterns KB)
    ✓ templates      (project/docs templates)
    ✓ devcontainer   (feature refs)
    ✓ Dockerfile     (image FROM)
    ✓ vscode         (.vscode/settings.json)

═══════════════════════════════════════════════
```

**Output (infrastructure profile):**

```
═══════════════════════════════════════════════
  ✓ DevContainer updated successfully
═══════════════════════════════════════════════

  Profile : infrastructure
  Method  : git tarball (2 API calls)
  Sources :
    - kodflow/devcontainer-template (def5678)
    - kodflow/infrastructure-template (abc1234)

  DevContainer components:
    ✓ hooks, commands, agents, lifecycle
    ✓ image-hooks, shared-utils, p10k, settings
    ✓ compose

  Infrastructure components:
    ✓ modules/ (12 files)
    ✓ stacks/ (8 files)
    ✓ ansible/ (15 files)
    ✓ packer/ (4 files)
    ✓ ci/ (6 files)
    ✓ tests/ (9 files)
    Protected: 3 skipped (inventory/, terragrunt.hcl)

═══════════════════════════════════════════════
```
