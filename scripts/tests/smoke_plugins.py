#!/usr/bin/env python3
"""Install the marketplace the way a user does, in throwaway homes, and check what landed.

  smoke-plugins.sh [--claude] [--codex] [--tree DIR] [--work DIR]
  smoke-plugins.sh --migrate-from COMMIT [--work DIR]
  smoke-plugins.sh --external NAME [--work DIR]
  smoke-plugins.sh --precedence-probe [--work DIR]

Claude: the tree is served as a Git marketplace. Claude Code refuses file://
sources, so the published URL is registered and a global url.insteadOf of the
isolated HOME points it at a bare repository of the tree: the source recorded
in known_marketplaces.json is the real Git one, and nothing reaches the
network. scripts/install.sh --claude then installs what a user gets. Oracle:
the installed set is the manifest minus installByDefault:false minus
install-exclude.txt; every installed cache is the tree byte for byte (modes
included); agents, skills and hook events read by pluginlib from the cache and
from the tree agree; plugins/marketplaces/kodflow holds the served commit;
kodflow-hooks' SessionStart hook, run from its installPath, raises no
fingerprint alert, and does raise one on a tampered copy (positive control).
External entries are validated offline and never installed.

Codex: scripts/install.sh --codex in an isolated CODEX_HOME, the GitHub source
redirected the same way to a bare repository of the checkout. Oracle: the
roles Codex discovers (codex debug prompt-input, minus its built-in roles)
equal codex/agents both ways; a retired generated agent is removed, a user's
own agent is kept; a skill script runs from the installed plugin.

--tree replays the Claude part on another tree (the canary's release
artifact); the Codex part always uses the checkout, the only tree install.sh
can pin. --precedence-probe is the advisory lane's: a fixture plugin whose two
manifests disagree on the description, and the description Claude shows.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from pluginlib.model import PluginPackage  # noqa: E402

MARKET_URL = "https://github.com/kodflow/claude-marketplace.git"
SHA = re.compile(r"[0-9a-f]{40}")
FINGERPRINT_ALERTS = ("fingerprint", "guards at risk", "differ from the marketplace copy")
FIXTURE = ROOT / "scripts/tests/fixtures/smoke/session-start.json"
PROBE = ROOT / "scripts/tests/fixtures/precedence-plugin"


class SmokeError(Exception):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeError(message)


def run(argv: list[str], *, env: dict, cwd: Path | None = None, timeout: int = 300,
        stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(argv, env=env, cwd=cwd, input=stdin, capture_output=True, text=True, timeout=timeout)


def must(argv: list[str], *, env: dict, cwd: Path | None = None, timeout: int = 300) -> str:
    result = run(argv, env=env, cwd=cwd, timeout=timeout)
    if result.returncode:
        raise SmokeError(f"{' '.join(argv)} exited {result.returncode}\n{result.stdout}{result.stderr}")
    return result.stdout


def git(*args: str, cwd: Path | None = None) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return must(["git", *args], env=env, cwd=cwd).strip()


def isolated_env(home: Path, **extra: str) -> dict:
    """An environment that reads nothing of the real profile."""
    drop = ("CLAUDE_", "CODEX_", "ANTHROPIC_", "OPENAI_", "GIT_", "XDG_")
    env = {k: v for k, v in os.environ.items() if not k.startswith(drop)}
    env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / ".config"), XDG_CACHE_HOME=str(home / ".cache"),
               GIT_CONFIG_NOSYSTEM="1", GIT_TERMINAL_PROMPT="0", NO_COLOR="1", **extra)
    return env


def serve(tree: Path, bare: Path, home: Path, commit: str = "HEAD") -> str:
    """A bare repository holding the tree's commit, and the isolated HOME's
    gitconfig sending the published URL to it. Returns the served commit."""
    if (tree / ".git").exists():
        check(commit != "HEAD" or git("status", "--porcelain", cwd=tree) == "",
              f"{tree} has uncommitted changes: the marketplace is served from its HEAD, commit first")
        source = tree
    else:
        # A release artifact: no history, so it becomes one commit.
        source = bare.parent / (bare.name + ".src")
        shutil.copytree(tree, source, symlinks=True)
        git("init", "--quiet", cwd=source)
        git("add", "-A", cwd=source)
        git("-c", "user.name=smoke", "-c", "user.email=smoke@invalid", "commit", "--quiet",
            "-m", "release artifact", cwd=source)
    sha = git("rev-parse", "--verify", f"{commit}^{{commit}}", cwd=source)
    git("init", "--quiet", "--bare", str(bare))
    # actions/checkout is shallow: the bare must accept a shallow history.
    git("config", "receive.shallowUpdate", "true", cwd=bare)
    git("push", "--quiet", str(bare), f"{sha}:refs/heads/main", cwd=source)
    git("symbolic-ref", "HEAD", "refs/heads/main", cwd=bare)
    home.mkdir(parents=True, exist_ok=True)
    env = isolated_env(home)
    must(["git", "config", "--global", f"url.file://{bare}.insteadOf", MARKET_URL], env=env)
    return sha


def files_of(root: Path) -> dict[str, tuple[str, bool]]:
    """Relative path -> (sha256, executable) of every regular file and link."""
    out = {}
    for path in sorted(root.rglob("*")):
        if path.is_dir() and not path.is_symlink():
            continue
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            out[rel] = ("link:" + os.readlink(path), False)
        else:
            mode = path.stat().st_mode
            out[rel] = (hashlib.sha256(path.read_bytes()).hexdigest(), bool(mode & stat.S_IXUSR))
    return out


def same_tree(installed: Path, source: Path, label: str) -> None:
    got, want = files_of(installed), files_of(source)
    missing, extra = sorted(set(want) - set(got)), sorted(set(got) - set(want))
    differ = sorted(p for p in set(want) & set(got) if want[p] != got[p])
    problems = [f"missing {p}" for p in missing[:10]] + [f"extra {p}" for p in extra[:10]] + \
        [f"differs {p} (content or mode)" for p in differ[:10]]
    check(not problems, f"{label}: the installed cache is not the tree:\n  " + "\n  ".join(problems))


def surface(root: Path) -> dict[str, set[str]]:
    """What the host loads, read by pluginlib: agents, skills, hook events."""
    package = PluginPackage(root=root, manifest={})
    hooks = root / "hooks/hooks.json"
    events = set()
    if hooks.is_file():
        events = set((json.loads(hooks.read_text(encoding="utf-8")).get("hooks") or {}).keys())
    return {
        "agents": {path.stem for path in package.agent_files()},
        "skills": {path.name for path in package.skill_directories()},
        "events": events,
    }


def excluded() -> set[str]:
    lines = (ROOT / "scripts/install-exclude.txt").read_text(encoding="utf-8").splitlines()
    return {line.split("#", 1)[0].strip() for line in lines} - {""}


def check_externals(entries: list[dict]) -> list[str]:
    """Pinned third-party entries, checked offline: never fetched here."""
    catalog = json.loads((ROOT / "catalog/catalog.json").read_text(encoding="utf-8"))
    pinned = {entry["name"]: entry for entry in catalog.get("externals", [])}
    names = []
    for entry in entries:
        source = entry["source"]
        name = entry["name"]
        check(source.get("source") == "url" and source.get("url", "").startswith("https://"),
              f"external {name}: source must be an https url")
        check(bool(SHA.fullmatch(source.get("sha", ""))), f"external {name}: not pinned by a 40-hex sha")
        check(entry.get("installByDefault") is False, f"external {name}: must be installByDefault false")
        check(name in pinned and pinned[name]["source"] == {"url": source["url"], "sha": source["sha"]},
              f"external {name}: differs from catalog externals[]")
        names.append(name)
    check(set(names) == set(pinned), "marketplace externals differ from catalog externals[]")
    return names


def run_session_start(install_path: Path, config: Path, home: Path, project: Path) -> str:
    hooks = json.loads((install_path / "hooks/hooks.json").read_text(encoding="utf-8"))["hooks"]
    commands = [h for group in hooks["SessionStart"] for h in group["hooks"] if h.get("type") == "command"]
    check(bool(commands), "kodflow-hooks declares no SessionStart command")
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    payload["cwd"] = str(project)
    env = isolated_env(home, CLAUDE_CONFIG_DIR=str(config), CLAUDE_PLUGIN_ROOT=str(install_path),
                       CLAUDE_PROJECT_DIR=str(project))
    output = []
    for hook in commands:
        result = run(["bash", "-c", hook["command"]], env=env, cwd=project,
                     timeout=int(hook.get("timeout", 60)) + 30, stdin=json.dumps(payload))
        check(result.returncode == 0, f"SessionStart {hook['command']} exited {result.returncode}: {result.stderr}")
        if result.stdout.strip():
            json.loads(result.stdout.strip().splitlines()[-1])
        output.append(result.stdout + result.stderr)
    return "\n".join(output)


def smoke_claude(tree: Path, work: Path) -> None:
    home = work / "claude-home"
    config = home / ".claude"
    sha = serve(tree, work / "claude-served.git", home)
    env = isolated_env(home, CLAUDE_CONFIG_DIR=str(config))
    print(f"claude: {must(['claude', '--version'], env=env).strip()}, serving {sha}")

    must(["bash", str(ROOT / "scripts/install.sh"), "--claude"], env=env, cwd=ROOT, timeout=900)

    known = json.loads((config / "plugins/known_marketplaces.json").read_text(encoding="utf-8"))
    check("kodflow" in known, "kodflow missing from known_marketplaces.json")
    source = known["kodflow"]["source"]
    check(source.get("source") not in ("directory", "file", "local"),
          f"the marketplace was registered as {source.get('source')}, not as a Git source")
    check(source == {"source": "git", "url": MARKET_URL}, f"unexpected marketplace source {source}")
    clone = config / "plugins/marketplaces/kodflow"
    check(Path(known["kodflow"]["installLocation"]).resolve() == clone.resolve(),
          "installLocation is not plugins/marketplaces/kodflow")
    check(git("rev-parse", "HEAD", cwd=clone) == sha, "plugins/marketplaces/kodflow is not at the served commit")
    check((clone / ".claude-plugin/marketplace.json").read_bytes()
          == (tree / ".claude-plugin/marketplace.json").read_bytes(),
          "plugins/marketplaces/kodflow holds another marketplace.json")

    marketplace = json.loads((tree / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
    local = [p for p in marketplace["plugins"] if isinstance(p["source"], str)]
    externals = check_externals([p for p in marketplace["plugins"] if not isinstance(p["source"], str)])
    expected = {p["name"] for p in local if p.get("installByDefault", True) is not False} - excluded()
    installed = json.loads((config / "plugins/installed_plugins.json").read_text(encoding="utf-8"))["plugins"]
    got = {key.removesuffix("@kodflow") for key in installed}
    check(got == expected, f"installed {sorted(got)}, expected {sorted(expected)}")
    check(not set(externals) & got, "an external entry was installed by default")

    by_name = {p["name"]: p for p in local}
    paths = {}
    for name in sorted(expected):
        record = installed[f"{name}@kodflow"]
        check(len(record) == 1 and record[0]["scope"] == "user", f"{name}: expected one user-scope install")
        record = record[0]
        source_dir = (tree / by_name[name]["source"]).resolve()
        install_path = Path(record["installPath"])
        check(install_path.resolve().is_relative_to((config / "plugins/cache/kodflow").resolve()),
              f"{name}: installPath outside plugins/cache/kodflow")
        check(record.get("gitCommitSha") == sha, f"{name}: installed from {record.get('gitCommitSha')}, not {sha}")
        version = json.loads((source_dir / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))["version"]
        check(record["version"] == version, f"{name}: version {record['version']}, the tree says {version}")
        same_tree(install_path, source_dir, name)
        want, have = surface(source_dir), surface(install_path)
        check(want == have, f"{name}: loaded surface differs: tree {want}, installed {have}")
        paths[name] = install_path
        print(f"claude: {name} {version} == tree ({len(want['agents'])} agents, "
              f"{len(want['skills'])} skills, {len(want['events'])} hook events)")

    if "kodflow-hooks" in paths:
        project = work / "project"
        project.mkdir(exist_ok=True)
        out = run_session_start(paths["kodflow-hooks"], config, home, project)
        alerts = [a for a in FINGERPRINT_ALERTS if a in out]
        check(not alerts, f"SessionStart raised a fingerprint alert:\n{out}")
        # Positive control: the same run on a copy with one guard edited must
        # alert, or the clean run above proves nothing.
        tampered = work / "tampered-hooks"
        shutil.copytree(paths["kodflow-hooks"], tampered, symlinks=True)
        guard = (tampered / "hooks/fingerprints.sha256").read_text(encoding="utf-8").split()[1]
        with open(tampered / "hooks" / guard, "a", encoding="utf-8") as handle:
            handle.write("\n# tampered\n")
        out = run_session_start(tampered, config, home, project)
        check("fingerprint" in out, f"SessionStart did not notice a tampered guard ({guard}):\n{out}")
        print("claude: kodflow-hooks SessionStart ran from its installPath, no fingerprint alert "
              "(a tampered copy alerts)")
    print(f"claude: externals validated offline, not installed: {', '.join(externals) or 'none'}")


ROLES = re.compile(r"^([A-Za-z0-9_.-]+): \{$", re.M)


def codex_roles(env: dict, cwd: Path) -> set[str]:
    """The role names Codex offers to spawn_agent, read from the model-visible
    prompt: the description that lists \"Available roles:\"."""
    text = must(["codex", "debug", "prompt-input"], env=env, cwd=cwd, timeout=120)
    found: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
        elif isinstance(node, str) and "Available roles:\n" in node:
            found.update(ROLES.findall(node.split("Available roles:\n", 1)[1]))

    walk(json.loads(text))
    check(bool(found), "codex debug prompt-input lists no roles")
    return found


def smoke_codex(work: Path) -> None:
    home = work / "codex-home"
    codex_home = home / ".codex"
    sha = serve(ROOT, work / "codex-served.git", home)
    env = isolated_env(home, CODEX_HOME=str(codex_home))
    project = work / "codex-project"
    project.mkdir(exist_ok=True)
    codex_home.mkdir(parents=True, exist_ok=True)
    print(f"codex: {must(['codex', '--version'], env=env).strip()}, serving {sha}")

    # A role the user wrote, and Codex's own roles: Codex lists roles only once
    # a custom one exists, so the baseline is taken with the user's in place.
    agents = codex_home / "agents"
    agents.mkdir()
    own = "user-own-smoke"
    (agents / f"{own}.toml").write_text(
        f'name = "{own}"\ndescription = "a role the user wrote"\ndeveloper_instructions = "mine"\n',
        encoding="utf-8")
    baseline = codex_roles(env, project)
    check(own in baseline, f"Codex does not discover a role written in {agents}")
    retired = "kodflow-retired-smoke"
    (agents / f"{retired}.toml").write_text(
        f'# generated-from: plugins/*/agents/{retired}.md\nname = "{retired}"\n'
        'description = "retired"\ndeveloper_instructions = "retired"\n', encoding="utf-8")

    must(["bash", str(ROOT / "scripts/install.sh"), "--codex"], env=env, cwd=ROOT, timeout=900)

    check(not (agents / f"{retired}.toml").exists(), "the retired generated agent is still installed")
    check((agents / f"{own}.toml").exists(), "the installer removed an agent the user wrote")
    shipped = sorted((ROOT / "codex/agents").glob("*.toml"))
    expected = set()
    for path in shipped:
        check((agents / path.name).read_bytes() == path.read_bytes(), f"{path.name} differs once installed")
        name = re.search(r'^name = "([^"]+)"', path.read_text(encoding="utf-8"), re.M)
        check(name is not None, f"{path.name} has no name")
        expected.add(name.group(1))
    discovered = codex_roles(env, project) - baseline
    check(retired not in discovered, "Codex still discovers the retired agent")
    missing, extra = sorted(expected - discovered), sorted(discovered - expected)
    check(not missing and not extra, f"Codex roles differ from codex/agents: missing {missing}, extra {extra}")
    print(f"codex: {len(discovered)} roles discovered == codex/agents; retired agent gone, user agent kept")

    listing = json.loads(must(["codex", "plugin", "list", "--json"], env=env, cwd=project))
    installed = {p["name"] for p in listing.get("installed", []) if p.get("installed")}
    index = json.loads((ROOT / ".agents/plugins/marketplace.json").read_text(encoding="utf-8"))
    claude_index = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
    nodefault = {p["name"] for p in claude_index["plugins"] if p.get("installByDefault") is False}
    want = {p["name"] for p in index["plugins"]} - nodefault - excluded()
    check(installed == want, f"Codex plugins {sorted(installed)}, expected {sorted(want)}")

    scripts = sorted((codex_home / "plugins/cache/kodflow/kodflow-workflow").glob(
        "*/skills/project/scripts/locate-code-home.sh"))
    check(len(scripts) == 1, f"expected one installed locate-code-home.sh, found {len(scripts)}")
    result = run(["bash", str(scripts[0])], env=env, cwd=project, timeout=60)
    check(result.returncode == 0, f"locate-code-home.sh exited {result.returncode}: {result.stderr}")
    lines = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    check(lines.get("IN_REPO") == "0" and lines.get("CODE_HOME", "").startswith(str(home)),
          f"locate-code-home.sh answered outside the isolated home:\n{result.stdout}")
    print(f"codex: {len(installed)} native plugins; /project's script ran from the installed plugin")


def installed_records(config: Path) -> dict:
    data = json.loads((config / "plugins/installed_plugins.json").read_text(encoding="utf-8"))["plugins"]
    return {key.removesuffix("@kodflow"): value[0] for key, value in data.items() if len(value) == 1}


def smoke_migration(tree: Path, start: str, work: Path) -> None:
    """A user on the marketplace at <start> who runs marketplace update then
    plugin update lands on the tree's commit: versions, commit and bytes."""
    home = work / "migration-home"
    config = home / ".claude"
    bare = work / "migration-served.git"
    old = serve(tree, bare, home, start)
    new = git("rev-parse", "HEAD", cwd=tree)
    check(git("status", "--porcelain", cwd=tree) == "", f"{tree} has uncommitted changes, commit first")
    env = isolated_env(home, CLAUDE_CONFIG_DIR=str(config))
    print(f"migration: {must(['claude', '--version'], env=env).strip()}, from {old} to {new}")

    must(["claude", "plugin", "marketplace", "add", "--scope", "user", MARKET_URL], env=env, timeout=600)
    before = json.loads(git("show", f"{old}:.claude-plugin/marketplace.json", cwd=tree))
    exclude = {line.split("#", 1)[0].strip()
               for line in git("show", f"{old}:scripts/install-exclude.txt", cwd=tree).splitlines()} - {""}
    names = sorted(p["name"] for p in before["plugins"]
                   if p.get("installByDefault", True) is not False and p["name"] not in exclude)
    for name in names:
        must(["claude", "plugin", "install", "--scope", "user", f"{name}@kodflow"], env=env, timeout=600)
    records = installed_records(config)
    check(sorted(records) == names, f"installed at {old}: {sorted(records)}, expected {names}")
    check(all(r.get("gitCommitSha") == old for r in records.values()), f"the start install is not at {old}")

    git("push", "--quiet", "--force", str(bare), f"{new}:refs/heads/main", cwd=tree)
    must(["claude", "plugin", "marketplace", "update", "kodflow"], env=env, timeout=600)
    check(git("rev-parse", "HEAD", cwd=config / "plugins/marketplaces/kodflow") == new,
          "marketplace update did not move plugins/marketplaces/kodflow to the candidate")
    after = json.loads((tree / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
    sources = {p["name"]: p["source"] for p in after["plugins"] if isinstance(p["source"], str)}
    for name in names:
        if name not in sources:
            continue  # dropped by the candidate: nothing to update to
        must(["claude", "plugin", "update", "--scope", "user", f"{name}@kodflow"], env=env, timeout=600)
    records = installed_records(config)
    for name in names:
        if name not in sources:
            continue
        source_dir = (tree / sources[name]).resolve()
        version = json.loads((source_dir / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))["version"]
        record = records.get(name, {})
        check(record.get("version") == version, f"{name}: {record.get('version')} after update, expected {version}")
        check(record.get("gitCommitSha") == new, f"{name}: updated from {record.get('gitCommitSha')}, not {new}")
        same_tree(Path(record["installPath"]), source_dir, f"{name} after update")
        print(f"migration: {name} {version} == candidate")


def smoke_external(tree: Path, name: str, work: Path) -> None:
    """A pinned external entry installed on demand: fetched from its upstream
    at the pinned commit (network), skills present, never by default."""
    home = work / "external-home"
    config = home / ".claude"
    sha = serve(tree, work / "external-served.git", home)
    env = isolated_env(home, CLAUDE_CONFIG_DIR=str(config))
    marketplace = json.loads((tree / ".claude-plugin/marketplace.json").read_text(encoding="utf-8"))
    entry = next((p for p in marketplace["plugins"] if p["name"] == name), None)
    check(entry is not None and not isinstance(entry["source"], str), f"{name} is no external entry")
    check_externals([entry])
    print(f"external: {must(['claude', '--version'], env=env).strip()}, serving {sha}, {name} at {entry['source']['sha']}")
    must(["claude", "plugin", "marketplace", "add", "--scope", "user", MARKET_URL], env=env, timeout=600)
    must(["claude", "plugin", "install", "--scope", "user", f"{name}@kodflow"], env=env, timeout=600)
    record = installed_records(config).get(name)
    check(record is not None, f"{name}@kodflow is not installed")
    install_path = Path(record["installPath"])
    check(record.get("gitCommitSha") in (None, entry["source"]["sha"]),
          f"{name}: installed from {record.get('gitCommitSha')}, pinned {entry['source']['sha']}")
    found = surface(install_path)
    check(bool(found["skills"]), f"{name}: no skill installed")
    check(not (install_path / "hooks").exists(), f"{name}: ships hooks/, refused for an external entry")
    print(f"external: {name} {record['version']} installed, skills: {', '.join(sorted(found['skills']))}")
    print(must(["claude", "plugin", "details", f"{name}@kodflow"], env=env))


def precedence_probe(work: Path) -> int:
    """Which manifest Claude reads when the root plugin.json and
    .claude-plugin/plugin.json disagree. Advisory: prints the verdict."""
    home = work / "probe-home"
    config = home / ".claude"
    market = work / "probe-market"
    shutil.copytree(PROBE, market / "plugins/precedence-plugin")
    (market / ".claude-plugin").mkdir(parents=True)
    (market / ".claude-plugin/marketplace.json").write_text(json.dumps({
        "name": "precedence-probe", "owner": {"name": "probe"},
        "plugins": [{"name": "precedence-plugin", "source": "./plugins/precedence-plugin"}],
    }), encoding="utf-8")
    home.mkdir(parents=True)
    env = isolated_env(home, CLAUDE_CONFIG_DIR=str(config))
    must(["claude", "plugin", "marketplace", "add", "--scope", "user", str(market)], env=env)
    must(["claude", "plugin", "install", "--scope", "user", "precedence-plugin@precedence-probe"], env=env)
    shown = must(["claude", "plugin", "details", "precedence-plugin@precedence-probe"], env=env)
    host = json.loads((PROBE / ".claude-plugin/plugin.json").read_text(encoding="utf-8"))["description"]
    portable = json.loads((PROBE / "plugin.json").read_text(encoding="utf-8"))["description"]
    if host in shown and portable not in shown:
        print("precedence: Claude shows .claude-plugin/plugin.json's description (expected)")
        return 0
    seen = "plugin.json (root)" if portable in shown else "neither manifest"
    print(f"precedence: Claude shows {seen}, not .claude-plugin/plugin.json\n{shown}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--claude", action="store_true")
    parser.add_argument("--codex", action="store_true")
    parser.add_argument("--tree", type=Path, default=ROOT, help="marketplace tree for the Claude part")
    parser.add_argument("--work", type=Path, help="work directory (default: a new temporary one)")
    parser.add_argument("--migrate-from", metavar="COMMIT",
                        help="Claude only: install at COMMIT, then marketplace update + plugin update to the tree's HEAD")
    parser.add_argument("--external", metavar="NAME",
                        help="Claude only: install the pinned external entry NAME on demand (network)")
    parser.add_argument("--precedence-probe", action="store_true")
    args = parser.parse_args()
    both = not args.claude and not args.codex
    base = args.work or Path(tempfile.mkdtemp(prefix="kodflow-smoke-"))
    base.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="run-", dir=base)).resolve()
    try:
        if args.precedence_probe:
            return precedence_probe(work)
        if args.external:
            smoke_external(args.tree.resolve(), args.external, work)
            print("smoke: ok")
            shutil.rmtree(work, ignore_errors=True)
            return 0
        if args.migrate_from:
            smoke_migration(args.tree.resolve(), args.migrate_from, work)
            print("smoke: ok")
            shutil.rmtree(work, ignore_errors=True)
            return 0
        for host in ("claude", "codex"):
            if (both or getattr(args, host)) and shutil.which(host) is None:
                raise SmokeError(f"the {host} CLI is not on PATH")
        if both or args.claude:
            smoke_claude(args.tree.resolve(), work)
        if both or args.codex:
            smoke_codex(work)
    except (SmokeError, subprocess.TimeoutExpired, OSError, ValueError, KeyError) as error:
        print(f"::error::smoke: {error}", file=sys.stderr)
        print(f"work directory kept: {work}", file=sys.stderr)
        return 1
    shutil.rmtree(work, ignore_errors=True)
    print("smoke: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
