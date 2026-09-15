#!/usr/bin/env python3
"""The cost guardrails, against a fixture built to break them.

Each check is a cheap regex away from useless: a description budget that reads
only the first line of a wrapped YAML scalar passes a 900-character
description, and a reference check that fires on `git bisect` buries the real
findings. Both happened while this was being written, so the fixture carries
the shapes that fooled it, and the must-NOT-fire cases weigh as much as the
must-fire ones.
"""
import importlib.util, os, pathlib, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
SCRIPT = HERE.parent / "check-context-cost.py"

_spec = importlib.util.spec_from_file_location("check_context_cost", SCRIPT)
cost = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cost)

LONG = "A description long past any budget. " * 12          # ~430 characters
BIG = "x" * (cost.SKILL_SIZE_BUDGET + 1)

BIG_SKILL = "plugins/kodflow-alpha/skills/big/SKILL.md"
CITER = "plugins/kodflow-alpha/skills/citer/SKILL.md"
A = "plugins/kodflow-alpha/agents/"


def write(p, text):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def fixture():
    root = pathlib.Path(tempfile.mkdtemp())
    alpha = root / "plugins" / "kodflow-alpha"
    beta = root / "plugins" / "kodflow-beta"

    write(alpha / "agents" / "pinned.md",
          "---\nname: pinned\ndescription: Short and pinned.\nmodel: haiku\neffort: low\n---\n\nBody.\n")
    write(alpha / "agents" / "unpinned.md",
          "---\nname: unpinned\ndescription: Short.\nmodel: haiku\n---\n\nBody.\n")
    # The four ways of writing the key and pinning nothing. A check that only
    # proves the line exists reads every one of them as pinned, which is the
    # exact agent it was written to catch.
    write(alpha / "agents" / "empty-effort.md",
          "---\nname: empty-effort\ndescription: Short.\nmodel: haiku\neffort:\n---\n\nBody.\n")
    write(alpha / "agents" / "null-effort.md",
          "---\nname: null-effort\ndescription: Short.\nmodel: haiku\neffort: null\n---\n\nBody.\n")
    write(alpha / "agents" / "tilde-effort.md",
          "---\nname: tilde-effort\ndescription: Short.\nmodel: haiku\neffort: ~\n---\n\nBody.\n")
    write(alpha / "agents" / "commented-effort.md",
          "---\nname: commented-effort\ndescription: Short.\nmodel: haiku\n"
          "effort:  # not decided yet\n---\n\nBody.\n")
    write(alpha / "agents" / "trailing-comment.md",
          "---\nname: trailing-comment\ndescription: Short.\nmodel: haiku\n"
          "effort: low  # deliberate, this one is cheap\n---\n\nBody.\n")
    # The description wraps the way the files in this tree actually wrap it,
    # over indented continuation lines. Reading the first line alone measures 36.
    write(alpha / "agents" / "wordy.md",
          "---\nname: wordy\ndescription: " + LONG[:36] + "\n  " + LONG[36:200] +
          "\n  " + LONG[200:] + "\nmodel: haiku\neffort: low\n---\n\nBody.\n")
    write(alpha / "agents" / "exampled.md",
          "---\nname: exampled\ndescription: 'Does a thing. <example>user asks, agent runs</example>'\n"
          "model: haiku\neffort: low\n---\n\nBody.\n")
    write(alpha / "agents" / "remembers.md",
          "---\nname: remembers\ndescription: Short.\nmodel: haiku\neffort: low\n---\n\n"
          "You have a persistent, file-based memory system, and here is how to use it.\n")

    # An agent body cites other agents and skills exactly as a skill body does,
    # so it can send a session to someone else's `beta-worker` the same way.
    write(alpha / "agents" / "citer-agent.md",
          "---\nname: citer-agent\ndescription: Short.\nmodel: haiku\neffort: low\n---\n\n"
          "Hand the analysis to `beta-worker`.\n"            # bare: owned by kodflow-beta
          "Then `kodflow-beta:beta-skill` finishes it.\n"    # prefixed: correct
          "`big` is ours, so it stays bare.\n"
          "Quality gate: `make lint` — a shell command, not a skill call.\n")

    write(alpha / "skills" / "big" / "SKILL.md",
          "---\nname: big\ndescription: Short.\n---\n\n" + BIG)
    write(alpha / "skills" / "citer" / "SKILL.md",
          "---\nname: citer\ndescription: Short.\n---\n\n"
          "Dispatch `beta-worker` for the analysis.\n"        # bare: owned by kodflow-beta
          "Then `kodflow-beta:beta-skill` finishes it.\n"     # prefixed: correct
          "Run `/beta-skill` by hand if it does not.\n"       # bare slash invocation
          "`kodflow-alpha:big` and `big` are ours, both fine.\n"
          "Quality gate: `make lint` — a shell command, not a skill call.\n"
          "History: `git bisect` likewise.\n"
          "Path `plugins/kodflow-beta/skills/lint/SKILL.md` is a path, not a call.\n"
          "`kodflow-alpha:beta-worker` claims an agent it does not own.\n")

    write(beta / "agents" / "beta-worker.md",
          "---\nname: beta-worker\ndescription: Short.\nmodel: haiku\neffort: low\n---\n\nBody.\n")
    write(beta / "skills" / "beta-skill" / "SKILL.md",
          "---\nname: beta-skill\ndescription: Short.\n---\n\nBody.\n")
    write(beta / "skills" / "lint" / "SKILL.md",
          "---\nname: lint\ndescription: Short.\n---\n\nBody.\n")
    return root


def run(root, allowlist=None):
    """Findings as {(check, path)} and in full, with the allowlist swapped in.

    The allowlist is module state on purpose: it belongs in the script, where a
    reviewer reads the dated reasons in the diff, not in a data file nobody opens.
    """
    saved = cost.SKILL_SIZE_ALLOWLIST
    cost.SKILL_SIZE_ALLOWLIST = saved if allowlist is None else allowlist
    try:
        found, _, _ = cost.check(root)
    finally:
        cost.SKILL_SIZE_ALLOWLIST = saved
    return {(c, p) for c, p, _ in found}, found


def main():
    root = fixture()
    hits, found = run(root)
    ok, fails = 0, []

    def case(label, condition):
        nonlocal ok
        if condition:
            ok += 1
        else:
            fails.append(label)

    case("an agent with model and effort is clean",  ("model_effort", A + "pinned.md") not in hits)
    case("an agent missing effort is flagged",       ("model_effort", A + "unpinned.md") in hits)
    case("a bare `effort:` is not pinned",           ("model_effort", A + "empty-effort.md") in hits)
    case("`effort: null` is not pinned",             ("model_effort", A + "null-effort.md") in hits)
    case("`effort: ~` is not pinned",                ("model_effort", A + "tilde-effort.md") in hits)
    case("an effort that is only a comment is not pinned",
         ("model_effort", A + "commented-effort.md") in hits)
    case("a real effort with a trailing comment is pinned",
         ("model_effort", A + "trailing-comment.md") not in hits)
    case("a wrapped description is measured whole",  ("description_budget", A + "wordy.md") in hits)
    case("a short description is clean",             ("description_budget", A + "pinned.md") not in hits)
    case("an <example> in a description is flagged", ("description_budget", A + "exampled.md") in hits)
    case("a copied memory block is flagged",         ("memory_block", A + "remembers.md") in hits)
    case("an oversized SKILL.md is flagged",         ("skill_size", BIG_SKILL) in hits)

    # Every reference message opens with the offending token, so the token is
    # what the assertions read: matching anywhere in the message would find
    # `kodflow-beta:beta-skill` in the suggestion that recommends writing it.
    cited = {m.split("`")[1] for c, p, m in found if c == "plugin_prefix" and p == CITER}
    case("a bare agent of another plugin is flagged",  "beta-worker" in cited)
    case("a bare /skill of another plugin is flagged", "/beta-skill" in cited)
    case("a correctly prefixed reference is clean",    "kodflow-beta:beta-skill" not in cited)
    case("a name the citing plugin owns is clean",     not {"big", "kodflow-alpha:big"} & cited)
    case("a shell command is not a reference",         not {"lint", "git"} & cited)
    case("a path is not a reference",                  not any(t.endswith("SKILL.md") for t in cited))
    case("a prefix naming the wrong owner is flagged", "kodflow-alpha:beta-worker" in cited)

    # The same reference rules, read out of an agent file rather than a skill.
    agent_cited = {m.split("`")[1] for c, p, m in found
                   if c == "plugin_prefix" and p == A + "citer-agent.md"}
    case("a bare reference in an agent is flagged",     "beta-worker" in agent_cited)
    case("a prefixed reference in an agent is clean",   "kodflow-beta:beta-skill" not in agent_cited)
    case("an agent naming its own plugin's skill is clean", "big" not in agent_cited)
    case("a shell command in an agent is not a reference",  "lint" not in agent_cited)

    # The allowlist: an entry silences the file, an entry without a date does
    # not, and one that outlived its file or its reason becomes the finding.
    allowed, _ = run(root, {BIG_SKILL: "2026-09-15: reference material, reduction planned next pass"})
    case("an allowlisted SKILL.md is silent",          ("skill_size", BIG_SKILL) not in allowed)
    undated, _ = run(root, {BIG_SKILL: "too big for now"})
    case("an allowlist entry with no date is flagged", ("skill_size", BIG_SKILL) in undated)
    impossible, _ = run(root, {BIG_SKILL: "2026-13-45: shaped like a date, names no day"})
    case("an allowlist date that is not a calendar date is flagged",
         ("skill_size", BIG_SKILL) in impossible)
    _, shrunk = run(root, {"plugins/kodflow-beta/skills/beta-skill/SKILL.md": "2026-09-15: nothing to see"})
    case("an allowlist entry now under budget is flagged",
         any("already under budget" in m for _, _, m in shrunk))
    _, gone = run(root, {"plugins/kodflow-alpha/skills/vanished/SKILL.md": "2026-09-15: was big once"})
    case("an allowlist entry for a missing file is flagged",
         any("the file is gone" in m for _, _, m in gone))

    # Warning-by-default is the shape of this gate, not a detail of it: the
    # exit code must stay 0 until somebody opts a check in by name.
    lenient = subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True)
    case("findings alone do not fail the build", lenient.returncode == 0)
    strict = subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True,
                            env={**os.environ, "COST_CHECKS_STRICT": "model_effort"})
    case("an opted-in check fails the build", strict.returncode == 1)
    case("a check nobody opted into stays a warning", "[warn] skill_size" in strict.stdout)
    typo = subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True,
                          env={**os.environ, "COST_CHECKS_STRICT": "model-effort"})
    case("a misspelt check name is refused, not silently ignored",
         typo.returncode != 0 and "unknown check" in typo.stderr)

    total = ok + len(fails)
    if fails:
        print(f"context cost: {len(fails)}/{total} cases wrong")
        for f in fails:
            print("  FAIL " + f)
        return 1
    print(f"context cost: {total}/{total} cases correct")
    return 0


if __name__ == "__main__":
    sys.exit(main())
