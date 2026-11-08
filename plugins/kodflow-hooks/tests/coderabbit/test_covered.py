"""Offline tests of probe.py's `covered`, its YAML reader and the relaunch marker
accounting. Fixtures under fixtures/ are real pull requests read with gh api on
2026-11-08 (trimmed to the fields probe.py reads):

  kodflow/forgejo-raft#8     older summary layout (`recent_review_start`), paused
                             after 90964109; head a6147257 not reviewed
  kitsunium/sdk#1314         newer layout (`coderabbit-ai-generated:v1`,
                             `recent_review_status_start`), head reviewed
  kodflow/ktn-linter#816     a sync PR of kodflow-ci[bot] in a repository with
                             its own .coderabbit.yaml

Run: python3 -I -m unittest discover -s plugins/kodflow-hooks/tests/coderabbit
(pytest collects the same classes).
"""
import argparse
import base64
import copy
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "hooks", "coderabbit"))
import probe  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
POLICY = os.path.join(FIX, "policy")
NOW = probe.parse_time("2026-11-08T12:00:00Z")
BOT = {"login": "coderabbitai[bot]", "type": "Bot"}
HUMAN = {"login": "kodflow", "type": "User"}
OPTS = argparse.Namespace(buffer_minutes=2, unknown_wait_minutes=60, stale_minutes=30, max_attempts=3,
                          head_cap=3, push_quiet_minutes=20, policy_dir=POLICY)
LIMIT = "<!-- rate limited by coderabbit.ai -->\n> ## Review limit reached\n> **Next included review available in {n} minutes.**"
PAUSED = "<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\n<!-- This is an auto-generated comment: review paused by coderabbit.ai -->\n> ## Review paused"

A6 = "a6147257f5734612a3b3ac8cb89b209525fa071e"
N9 = "90964109b196e06977ae6384b80ba12c0c2eb057"
EF = "efc1809efc030e7686ae5f896242a04c92ce97b4"
H1, H2 = "1111111aaaaaaa", "2222222bbbbbbb"


def load(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as fh:
        return json.load(fh)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def comment(user, body, created, updated=None):
    return {"user": user, "body": body, "created_at": created, "updated_at": updated or created, "html_url": "u"}


class Api(probe.Api):
    """Routes by path; `get` and `paginate` both read `routes`, a 404 when absent."""

    def __init__(self, routes):
        super().__init__()
        self.routes, self.posted, self.paths = routes, [], []

    def _route(self, path):
        self.calls += 1
        self.paths.append(path)
        for pattern, value in self.routes.items():
            if re.fullmatch(pattern, path):
                if isinstance(value, Exception):
                    raise value
                return copy.deepcopy(value)
        raise probe.ApiError(404, "Not Found")

    def get(self, owner, path):
        return self._route(path)

    def paginate(self, owner, path, params=None, key=None, max_pages=None):
        return self._route(path)

    def post_comment(self, owner, repo, number, body):
        self.posted.append((repo, number, body))


def contents(text):
    return {"content": base64.b64encode(text.encode()).decode()}


def routes_for(fx, repo, head=None, yaml_text=None, **extra):
    pr = copy.deepcopy(fx["pr"])
    if head:
        pr["head"]["sha"] = head
    n = pr["number"]
    r = {
        rf"/repos/{repo}/pulls/{n}": pr,
        rf"/repos/{repo}/issues/{n}/comments": fx.get("comments", []),
        rf"/repos/{repo}/pulls/{n}/reviews": fx.get("reviews", []),
        rf"/repos/{repo}/pulls/{n}/files": [{"filename": f} for f in fx.get("files", ["src/main.go"])],
    }
    if yaml_text is not None:
        r[rf"/repos/{repo}/contents/\.coderabbit\.yaml\?ref=.*"] = contents(yaml_text)
    r.update(extra)
    return r


def cov_opts(repo, pr, **kw):
    base = dict(repo=repo, pr=pr, policy_dir=POLICY, cache_dir="", cache_minutes=5, deadline=4.0)
    base.update(kw)
    return argparse.Namespace(**base)


# ------------------------------------------------------------------------ YAML


class Yaml(unittest.TestCase):
    def test_real_repository_file(self):
        d = probe.parse_yaml(read(os.path.join(FIX, "kodflow_ktn-linter_816.coderabbit.yaml")))
        auto = d["reviews"]["auto_review"]
        self.assertEqual(auto["ignore_title_keywords"], ["WIP", "DO NOT MERGE", "DRAFT"])
        self.assertIs(auto["drafts"], False)
        self.assertEqual(auto["base_branches"], ["main"])
        self.assertIn("!**/go.sum", d["reviews"]["path_filters"])
        self.assertIs(d["inheritance"], False)
        self.assertTrue(d["tone_instructions"].startswith("Concise and technical."))
        self.assertTrue(all(isinstance(x, dict) and "path" in x for x in d["reviews"]["path_instructions"]))

    def test_real_settings_file(self):
        d = probe.parse_yaml(read(os.path.join(POLICY, "settings.yaml")))
        auto = d["reviews"]["auto_review"]
        self.assertIn("ci(post-commit):", auto["ignore_title_keywords"])   # a colon inside quotes is no key
        self.assertEqual(auto["ignore_usernames"], ["dependabot[bot]"])
        self.assertEqual(len(d["reviews"]["path_filters"]), 25)
        self.assertTrue(d["tone_instructions"].startswith("Evidence-based") and d["tone_instructions"].endswith("findings."))

    @unittest.skipUnless(__import__("importlib").util.find_spec("yaml"), "PyYAML not installed")
    def test_agrees_with_pyyaml_on_what_is_read(self):
        import yaml
        for path in (os.path.join(FIX, "kodflow_ktn-linter_816.coderabbit.yaml"), os.path.join(POLICY, "settings.yaml"),
                     os.path.join(POLICY, "override-kodflow.yaml")):
            text = read(path)
            ours, theirs = probe.parse_yaml(text), yaml.safe_load(text)
            for keys in (("reviews", "auto_review"), ("reviews", "path_filters"), ("inheritance",)):
                self.assertEqual(probe._dig(ours, *keys), probe._dig(theirs, *keys), (path, keys))

    def test_forms(self):
        doc = probe.parse_yaml(
            "# head\n"
            "a: [x, 'y z', \"w\"]  # trailing\n"
            "\"q:k\": 'it''s # not a comment'\n"
            "b:\n- one\n- two: 2\n  three: true\n"
            "c:\n  plain: multi\n    line\n  empty:\n  nul: ~\n  f: {k: v, n: 3}\n"
            "d: |\n  block # kept\n\n  text\n"
            "e: 1.5\n"
        )
        self.assertEqual(doc["a"], ["x", "y z", "w"])
        self.assertEqual(doc["q:k"], "it's # not a comment")
        self.assertEqual(doc["b"], ["one", {"two": 2, "three": True}])
        self.assertEqual(doc["c"], {"plain": "multi line", "empty": None, "nul": None, "f": {"k": "v", "n": 3}})
        self.assertIsInstance(doc["d"], str)
        self.assertEqual(doc["e"], 1.5)
        self.assertIsNone(probe.parse_yaml("# only a comment\n"))

    def test_refuses_what_it_does_not_read(self):
        for text in ("a: &x 1\nb: *x\n", "a: !!str 1\n", "a:\n\tb: 1\n", "a: 1\n   b: 2\n", "a: [1, 2\n", "a: \"open\n"):
            with self.assertRaises(probe.YamlError, msg=text):
                probe.parse_yaml(text)


# ----------------------------------------------------------------- eligibility


class Glob(unittest.TestCase):
    def test_minimatch_forms(self):
        m = probe.glob_match
        self.assertTrue(m("**/go.sum", "go.sum"))
        self.assertTrue(m("**/go.sum", "a/b/go.sum"))
        self.assertTrue(m("src/**", "src/a/b.go"))
        self.assertFalse(m("src/*", "src/a/b.go"))
        self.assertTrue(m("**/*.{ts,js}", "web/x.js"))
        self.assertFalse(m("**/*.{ts,js}", "web/x.go"))
        self.assertTrue(m("**/zz_generated*", "pkg/zz_generated.deepcopy.go"))

    def test_includes_and_excludes(self):
        f = ["src/**", "!src/generated/**"]
        self.assertTrue(probe.path_kept("src/a.go", f))
        self.assertFalse(probe.path_kept("src/generated/a.go", f))
        self.assertFalse(probe.path_kept("docs/a.md", f))
        self.assertTrue(probe.path_kept("docs/a.md", ["!**/*.lock"]))


class Eligibility(unittest.TestCase):
    def setUp(self):
        self.ktn = probe.parse_yaml(read(os.path.join(FIX, "kodflow_ktn-linter_816.coderabbit.yaml")))
        self.none = {"ignore_usernames": [], "ignore_title_keywords": []}

    def pr(self, **kw):
        p = {"number": 1, "title": "feat(x): y", "draft": False, "user": HUMAN,
             "head": {"sha": "h"}, "base": {"ref": "main", "repo": {"default_branch": "main"}}}
        p.update(kw)
        return p

    def res(self, pr, settings=None, override=None, files=("a.go",)):
        return probe.resolve_eligibility(pr, settings if settings is not None else self.ktn, override or self.none, lambda: list(files))

    def test_sync_pr_in_a_repo_with_its_own_file(self):
        fx = load("kodflow_ktn-linter_816")
        policy = probe.load_policy(POLICY, "kodflow")
        ok, why = self.res(fx["pr"], override=policy["override"], files=fx["files"])
        self.assertFalse(ok)
        self.assertIn("ignore_usernames", why)       # the override, though the repo file has no such list
        # by title alone too: the override's keyword is unioned with the repo's
        human = dict(fx["pr"], user=HUMAN)
        self.assertFalse(self.res(human, override=policy["override"])[0])
        # and without the override, CodeRabbit would review it
        self.assertEqual(self.res(fx["pr"], files=fx["files"]), (True, "eligible"))

    def test_title_keywords_are_case_insensitive_substrings(self):
        self.assertFalse(self.res(self.pr(title="feat: thing (wip)"))[0])            # repo keyword "WIP"
        self.assertFalse(self.res(self.pr(title="x"), override={"ignore_usernames": [], "ignore_title_keywords": ["X"]})[0])
        self.assertFalse(self.res(self.pr(title="feat: wiping the cache"))[0])  # a substring, as CodeRabbit matches

    def test_usernames_are_exact(self):
        o = {"ignore_usernames": ["kodflow-ci[bot]"], "ignore_title_keywords": []}
        self.assertTrue(self.res(self.pr(user={"login": "Kodflow-CI[bot]"}), override=o)[0])
        self.assertFalse(self.res(self.pr(user={"login": "kodflow-ci[bot]"}), override=o)[0])

    def test_drafts(self):
        self.assertEqual(self.res(self.pr(draft=True)), (False, "draft"))
        s = copy.deepcopy(self.ktn)
        s["reviews"]["auto_review"]["drafts"] = True
        self.assertTrue(self.res(self.pr(draft=True), settings=s)[0])

    def test_base_branches_are_unanchored_regexes_beside_the_default(self):
        s = {"reviews": {"auto_review": {"base_branches": ["release/.*"]}}}
        base = lambda ref: {"ref": ref, "repo": {"default_branch": "main"}}  # noqa: E731
        self.assertTrue(self.res(self.pr(base=base("main")), settings=s)[0])
        self.assertTrue(self.res(self.pr(base=base("release/1.2")), settings=s)[0])
        self.assertTrue(self.res(self.pr(base=base("old-release/1")), settings=s)[0])   # unanchored
        self.assertFalse(self.res(self.pr(base=base("feat/x")), settings=s)[0])

    def test_all_files_filtered(self):
        self.assertFalse(self.res(self.pr(), files=["go.sum", "a/go.sum"])[0])
        self.assertTrue(self.res(self.pr(), files=["go.sum", "main.go"])[0])

    def test_files_read_only_when_filters_decide(self):
        def boom():
            raise AssertionError("files fetched")
        probe.resolve_eligibility(self.pr(title="WIP"), self.ktn, self.none, boom)
        probe.resolve_eligibility(self.pr(), {}, self.none, boom)

    def test_policy(self):
        self.assertIsNone(probe.load_policy(None, "kodflow"))
        self.assertIsNone(probe.load_policy(os.path.join(FIX, "nowhere"), "kodflow"))
        p = probe.load_policy(POLICY, "kitsunium")                          # no override file: empty lists
        self.assertEqual(p["override"], self.none)
        self.assertIn("reviews", p["settings"])

    def test_eligibility_reads_the_repo_file_at_the_head_else_the_policy(self):
        fx = load("kodflow_ktn-linter_816")
        api = Api(routes_for(fx, "kodflow/ktn-linter", yaml_text=read(os.path.join(FIX, "kodflow_ktn-linter_816.coderabbit.yaml"))))
        ok, _ = probe.eligibility(api, "kodflow/ktn-linter", fx["pr"], probe.load_policy(POLICY, "kodflow"))
        self.assertIs(ok, False)
        self.assertTrue(any(fx["pr"]["head"]["sha"] in p for p in api.paths if "contents" in p), api.paths)
        # no repository file: settings.yaml decides (dependabot ignored there)
        api = Api(routes_for(fx, "kodflow/ktn-linter"))
        dep = dict(fx["pr"], user={"login": "dependabot[bot]"}, title="build(deps): bump x")
        self.assertIs(probe.eligibility(api, "kodflow/ktn-linter", dep, probe.load_policy(POLICY, "kodflow"))[0], False)

    def test_inheritance_true_merges_the_organisation_layer(self):
        fx = load("kodflow_ktn-linter_816")
        human = dict(fx["pr"], user=HUMAN, title="ci: run every job on the self-hosted kodflow-runner")
        policy = probe.load_policy(POLICY, "kodflow")
        own = "inheritance: true\nreviews:\n  auto_review:\n    ignore_title_keywords: [DRAFT]\n"
        api = Api(routes_for(fx, "kodflow/ktn-linter", yaml_text=own))
        ok, why = probe.eligibility(api, "kodflow/ktn-linter", human, policy)
        self.assertIs(ok, False)                               # keyword of settings.yaml, inherited
        self.assertIn("self-hosted kodflow-runner", why)
        # inheritance: false (ktn-linter's real file): the organisation keyword does not apply
        api = Api(routes_for(fx, "kodflow/ktn-linter", yaml_text=read(os.path.join(FIX, "kodflow_ktn-linter_816.coderabbit.yaml"))))
        self.assertIs(probe.eligibility(api, "kodflow/ktn-linter", human, policy)[0], True)
        # inherits but nothing to inherit from: unknown, not a guess
        api = Api(routes_for(fx, "kodflow/ktn-linter", yaml_text=own))
        no_settings = dict(policy, settings=None)
        self.assertEqual(probe.eligibility(api, "kodflow/ktn-linter", human, no_settings)[0], "unknown")

    def test_merge_inherited_follows_coderabbit(self):
        child = {"language": "de-DE", "reviews": {"auto_review": {"drafts": False}, "path_instructions": [
            {"path": "src/**", "instructions": "repo"}, {"path": "api/**", "instructions": "repo"}]}}
        parent = {"language": "en-US", "chat": {"art": False}, "reviews": {"auto_review": {"enabled": True, "drafts": True},
                  "path_instructions": [{"path": "src/**", "instructions": "central"}, {"path": "docs/**", "instructions": "central"}]}}
        m = probe.merge_inherited(child, parent)
        self.assertEqual(m["language"], "de-DE")
        self.assertEqual(m["chat"], {"art": False})
        self.assertEqual(m["reviews"]["auto_review"], {"enabled": True, "drafts": False})
        self.assertEqual([(x["path"], x["instructions"]) for x in m["reviews"]["path_instructions"]],
                         [("src/**", "repo"), ("api/**", "repo"), ("docs/**", "central")])
        self.assertEqual(probe.merge_inherited(["a", "b"], ["b", "c"]), ["a", "b", "c"])

    def test_eligibility_unknown(self):
        fx = load("kodflow_ktn-linter_816")
        pr = fx["pr"]
        self.assertEqual(probe.eligibility(Api({}), "kodflow/ktn-linter", pr, None)[0], "unknown")
        with tempfile.TemporaryDirectory() as d:          # readable dir, no settings, no repo file
            self.assertEqual(probe.eligibility(Api({}), "kodflow/ktn-linter", pr, probe.load_policy(d, "kodflow"))[0], "unknown")
        bad = Api(routes_for(fx, "kodflow/ktn-linter", yaml_text="reviews: &a {}\n"))
        self.assertEqual(probe.eligibility(bad, "kodflow/ktn-linter", pr, probe.load_policy(POLICY, "kodflow"))[0], "unknown")
        down = Api({r"/repos/.*/contents/.*": probe.ApiError(502, "Bad Gateway")})
        self.assertEqual(probe.eligibility(down, "kodflow/ktn-linter", pr, probe.load_policy(POLICY, "kodflow"))[0], "unknown")


# --------------------------------------------------------------- last reviewed


class LastReviewed(unittest.TestCase):
    def lr(self, comments, reviews=()):
        return probe.last_reviewed(comments, lambda: list(reviews))

    def test_forgejo_raft_8_older_layout(self):
        fx = load("kodflow_forgejo-raft_8")
        self.assertEqual(self.lr(fx["comments"], fx["reviews"]), (N9, "final_review_risk_coverage"))

    def test_sdk_1314_newer_layout(self):
        fx = load("kitsunium_sdk_1314")
        self.assertEqual(self.lr(fx["comments"]), (EF, "final_review_risk_coverage"))

    def strip(self, comments, rx):
        out = copy.deepcopy(comments)
        for c in out:
            c["body"] = re.sub(rx, "", c["body"], flags=re.S)
        return out

    def test_fallbacks_in_order(self):
        fx = load("kodflow_forgejo-raft_8")
        c = self.strip(fx["comments"], r"<!-- final_review_risk_coverage:.*?-->")
        self.assertEqual(self.lr(c, fx["reviews"]), (N9, "last_reviewed_commit"))
        c = self.strip(c, r"Last reviewed commit:[^\n]*")
        self.assertEqual(self.lr(c, fx["reviews"]), (N9, "recent_review_range"))
        sdk = self.strip(load("kitsunium_sdk_1314")["comments"], r"<!-- final_review_risk_coverage:.*?-->")
        self.assertEqual(self.lr(sdk), (EF, "recent_review_range"))     # recent_review section after the tips
        # no summary comment at all: the latest review body with a publication marker
        others = [x for x in fx["comments"] if "summarize by coderabbit.ai" not in x["body"]]
        self.assertEqual(self.lr(others, fx["reviews"]), ("af32aa0175902f7815bc01e4bd795573a167a93e", "review_range"))

    def test_empty_body_and_approval_records_say_nothing(self):
        stamped_at_head = [
            {"user": BOT, "body": "", "commit_id": A6, "submitted_at": "2026-10-18T07:01:35Z", "state": "COMMENTED"},
            {"user": BOT, "body": "", "commit_id": A6, "submitted_at": "2026-10-18T07:02:00Z", "state": "APPROVED"},
        ]
        self.assertEqual(self.lr([], stamped_at_head), (None, None))
        fx = load("kodflow_forgejo-raft_8")
        self.assertEqual(self.lr([], fx["reviews"] + stamped_at_head)[0], "af32aa0175902f7815bc01e4bd795573a167a93e")

    def test_reviews_read_only_when_the_summary_is_silent(self):
        def boom():
            raise AssertionError("reviews fetched")
        probe.last_reviewed(load("kitsunium_sdk_1314")["comments"], boom)


# --------------------------------------------------------------------- covered


class Covered(unittest.TestCase):
    def run_cov(self, fx, repo, head=None, **kw):
        api = Api(routes_for(fx, repo, head=head))
        return probe.covered(cov_opts(repo, fx["pr"]["number"], **kw), NOW, api), api

    def test_forgejo_raft_8_both_heads(self):
        fx = load("kodflow_forgejo-raft_8")
        out, _ = self.run_cov(fx, "kodflow/forgejo-raft")
        self.assertEqual((out["head"], out["last_reviewed"], out["covered"]), (A6, N9, False))
        self.assertIs(out["eligible"], True)                           # base forgejo is its default branch
        out, _ = self.run_cov(fx, "kodflow/forgejo-raft", head=N9)
        self.assertIs(out["covered"], True)

    def test_sdk_1314(self):
        out, _ = self.run_cov(load("kitsunium_sdk_1314"), "kitsunium/sdk")
        self.assertEqual((out["last_reviewed"], out["covered"], out["eligible"]), (EF, True, True))

    def test_shape(self):
        out, _ = self.run_cov(load("kitsunium_sdk_1314"), "kitsunium/sdk")
        for k in ("schema_version", "repo", "pr", "head", "last_reviewed", "eligible", "reason", "covered"):
            self.assertIn(k, out)
        json.dumps(out)

    def test_no_policy_dir_eligible_unknown_covered_still_read(self):
        out, _ = self.run_cov(load("kodflow_forgejo-raft_8"), "kodflow/forgejo-raft", policy_dir=None)
        self.assertEqual((out["eligible"], out["covered"]), ("unknown", False))

    def test_no_markers_is_unknown(self):
        fx = load("kodflow_forgejo-raft_8")
        fx["comments"], fx["reviews"] = [], []
        out, _ = self.run_cov(fx, "kodflow/forgejo-raft")
        self.assertEqual((out["last_reviewed"], out["covered"]), (None, "unknown"))

    def test_cache_is_keyed_by_head(self):
        fx = load("kodflow_forgejo-raft_8")
        with tempfile.TemporaryDirectory() as d:
            first, _ = self.run_cov(fx, "kodflow/forgejo-raft", cache_dir=d)
            second, api = self.run_cov(fx, "kodflow/forgejo-raft", cache_dir=d)
            self.assertEqual((first["cache"], second["cache"], api.calls), ("miss", "hit", 1))  # the PR alone
            self.assertEqual(second["covered"], False)
            moved, _ = self.run_cov(fx, "kodflow/forgejo-raft", head=N9, cache_dir=d)
            self.assertEqual((moved["cache"], moved["covered"]), ("miss", True))   # a new head is never certified by the cache

    def test_pr_found_from_the_branch(self):
        fx = load("kitsunium_sdk_1314")
        routes = routes_for(fx, "kitsunium/sdk")
        routes[r"/repos/kitsunium/sdk/pulls"] = [{"number": 1314}]
        api = Api(routes)
        out = probe.covered(cov_opts("kitsunium/sdk", None, branch="chore/x", cwd=None), NOW, api)
        self.assertEqual((out["pr"], out["covered"]), (1314, True))
        routes[r"/repos/kitsunium/sdk/pulls"] = []
        out = probe.covered(cov_opts("kitsunium/sdk", None, branch="chore/x", cwd=None), NOW, Api(routes))
        self.assertEqual(out["covered"], "unknown")
        self.assertIn("no open pull request", out["error"])

    def test_fails_open(self):
        api = Api({r".*": probe.ApiError(401, "Bad credentials")})
        out = probe.covered(cov_opts("o/r", 1), NOW, api)
        self.assertEqual((out["eligible"], out["covered"]), ("unknown", "unknown"))
        self.assertIn("401", out["error"])
        bad = probe.covered(cov_opts("../x", 1), NOW, Api({}))
        self.assertEqual(bad["covered"], "unknown")

    def test_cli_prints_one_json_document(self):
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = probe.main(["covered", "--repo", "a/../b", "--pr", "1"])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(buf.getvalue())["covered"], "unknown")


# ------------------------------------------------- refusal kinds and relaunching


class Kinds(unittest.TestCase):
    def test_split(self):
        fx = load("kodflow_forgejo-raft_8")
        summary = next(c for c in fx["comments"] if "summarize by coderabbit.ai" in c["body"])
        reply = next(c for c in fx["comments"] if "Review rate limited" in c["body"])
        self.assertEqual(probe.refusal_kind(summary["body"]), "paused")
        self.assertEqual(probe.refusal_kind(reply["body"]), "rate_limited")
        self.assertEqual(probe.refusal_kind(LIMIT.format(n=3)), "rate_limited")
        self.assertEqual(probe.refusal_kind("> ## Review paused — included plan limit reached"), "rate_limited")

    def test_a_standing_rate_limit_is_not_hidden_by_a_newer_pause(self):
        pr = {"number": 1, "title": "t", "created_at": "2026-11-01T00:00:00Z", "head": {"sha": "h1"}, "user": HUMAN}
        comments = [comment(BOT, LIMIT.format(n=10), "2026-11-08T11:00:00Z"), comment(BOT, PAUSED, "2026-11-08T11:30:00Z")]
        rec = probe.analyze_pr(Api({r".*/reviews": []}), "o/r", pr, NOW, OPTS, comments)
        self.assertEqual(rec["kind"], "rate_limited")
        rec = probe.analyze_pr(Api({r".*/reviews": []}), "o/r", pr, NOW, OPTS, [comments[1]])
        self.assertEqual(rec["kind"], "paused")

    def test_capacity_counts_no_pause(self):
        pulls = [{"number": 1, "title": "t", "created_at": "2026-11-01T00:00:00Z", "updated_at": "2026-11-08T11:50:00Z",
                  "head": {"sha": "h1", "ref": "feat/a"}, "user": HUMAN, "draft": False}]
        api = Api({r"/repos/o/r/pulls": pulls, r".*/1/comments": [comment(BOT, PAUSED, "2026-11-08T11:50:00Z")], r".*/reviews": []})
        opts = argparse.Namespace(**vars(OPTS), action="pr_create", cwd=".", repo="o/r", branch="feat/x", cache_dir="",
                                  cache_minutes=5, recent=5, window_hours=3, deadline=4.0)
        self.assertEqual(probe.capacity(opts, NOW, api)["state"], "available")


def cmd(origin, at, head=None, user=HUMAN):
    body = probe.command_body(origin, head) if origin != "manual" else "@coderabbitai review"
    return comment(user, body, at)


class Markers(unittest.TestCase):
    since = probe.parse_time("2026-11-08T09:00:00Z")

    def st(self, *cmds, head=H1):
        return probe.relaunch_state(list(cmds), self.since, NOW, 30, 3, head, 3)

    def test_marker_follows_the_command(self):
        body = probe.command_body("cron", "abc1234")
        self.assertTrue(probe.COMMAND_RE.match(body))
        self.assertEqual(probe.parse_command(comment(HUMAN, body, "2026-11-08T10:00:00Z"))["origin"], "cron")
        hook = probe.parse_command(comment(HUMAN, probe.command_body("hook"), "2026-11-08T10:00:00Z"))
        self.assertEqual((hook["origin"], hook["head"]), ("hook", None))
        # a marker BEFORE the command hides it from CodeRabbit: not a command
        self.assertIsNone(probe.parse_command(comment(HUMAN, "<!-- kodflow-relaunch:cron -->\n@coderabbitai review", "2026-11-08T10:00:00Z")))

    def test_only_cron_holds_the_owner_slot(self):
        s = self.st(cmd("hook", "2026-11-08T11:50:00Z"))
        self.assertEqual((s["state"], s["owner_pending"]), ("pending", False))
        s = self.st(cmd("manual", "2026-11-08T11:50:00Z"))
        self.assertEqual((s["state"], s["owner_pending"]), ("pending", False))
        s = self.st(cmd("cron", "2026-11-08T11:50:00Z", H1))
        self.assertEqual((s["state"], s["owner_pending"]), ("pending", True))

    def test_only_cron_counts_toward_abandoning(self):
        hooks = [cmd("hook", t, "0123456789abcdef") for t in ("2026-11-08T09:10:00Z", "2026-11-08T09:40:00Z", "2026-11-08T10:10:00Z")]
        s = self.st(*hooks)
        self.assertEqual((s["state"], s["attempts"]), ("stale", 0))       # other heads: no cap either
        crons = [cmd("cron", t, "0123456789abcdef") for t in ("2026-11-08T09:10:00Z", "2026-11-08T09:40:00Z", "2026-11-08T10:10:00Z")]
        self.assertEqual(self.st(*crons)["state"], "abandoned")

    def test_cap_is_per_head_and_counts_every_origin(self):
        mixed = [cmd("cron", "2026-11-08T09:10:00Z", H1), cmd("hook", "2026-11-08T09:40:00Z", H1),
                 cmd("manual", "2026-11-08T10:10:00Z")]
        s = self.st(*mixed)
        self.assertEqual((s["state"], s["head_attempts"]), ("capped", 3))
        s = self.st(*mixed, head=H2)                                   # a new head starts over (the manual one is unmarked)
        self.assertEqual((s["state"], s["head_attempts"]), ("stale", 1))
        # commands on this head made before the refusal still count toward its cap
        early = [cmd("cron", "2026-11-08T08:00:00Z", H1), cmd("hook", "2026-11-08T08:10:00Z", H1), cmd("hook", "2026-11-08T08:20:00Z", H1)]
        self.assertEqual(self.st(*early)["state"], "capped")

    def test_bot_commands_are_nothing(self):
        self.assertEqual(self.st(cmd("cron", "2026-11-08T11:50:00Z", H1, user={"login": "github-actions[bot]", "type": "Bot"}))["state"], "none")

    def test_retry_after_refusal(self):
        # a command answered by a refusal is no longer pending: the refusal moves `since`
        pr = {"number": 1, "title": "t", "created_at": "2026-11-01T00:00:00Z", "head": {"sha": H1}, "user": HUMAN}
        cs = [cmd("cron", "2026-11-08T11:40:00Z", H1), comment(BOT, LIMIT.format(n=1), "2026-11-08T11:41:00Z")]
        rec = probe.analyze_pr(Api({r".*/reviews": []}), "o/r", pr, NOW, OPTS, cs)
        self.assertEqual((rec["relaunch"]["state"], rec["ready"], rec["eligible"]), ("none", True, True))
        early = probe.analyze_pr(Api({r".*/reviews": []}), "o/r", pr, probe.parse_time("2026-11-08T11:42:00Z"), OPTS, cs)
        self.assertFalse(early["eligible"])                               # the announced time has not passed


# ------------------------------------------------------------ uncovered class


def uncovered_api(fx, repo, pushed="2026-11-08T11:00:00Z", pending=False, comments=None):
    head = fx["pr"]["head"]["sha"]
    r = routes_for(fx, repo)
    if comments is not None:
        r[rf"/repos/{repo}/issues/{fx['pr']['number']}/comments"] = comments
        r[rf"/repos/{repo}/pulls/{fx['pr']['number']}/reviews"] = []
    r[rf"/repos/{repo}/commits/{head}"] = {"commit": {"committer": {"date": pushed}}}
    r[rf"/repos/{repo}/commits/{head}/status"] = {"statuses": [{"context": "CodeRabbit", "state": "pending" if pending else "success"}]}
    r[rf"/repos/{repo}/commits/{head}/check-runs"] = {"check_runs": []}
    r[rf"/repos/{repo}/pulls"] = [fx["pr"]]
    return Api(r)


class Uncovered(unittest.TestCase):
    repo = "kodflow/forgejo-raft"

    def fx(self):
        fx = load("kodflow_forgejo-raft_8")
        fx["pr"]["state"] = "open"
        return fx

    def rec(self, api, fx, opts=OPTS):
        comments = api.paginate("kodflow", f"/repos/{self.repo}/issues/8/comments")
        return probe.analyze_uncovered(api, self.repo, fx["pr"], comments, NOW, opts, probe.load_policy(opts.policy_dir, "kodflow"))[0]

    def test_positive_false_quiet_no_review_running(self):
        fx = self.fx()
        rec = self.rec(uncovered_api(fx, self.repo), fx)
        self.assertTrue(rec["eligible"])
        self.assertEqual(rec["last_reviewed"], N9)

    def test_young_push_or_review_running_waits(self):
        fx = self.fx()
        self.assertFalse(self.rec(uncovered_api(fx, self.repo, pushed="2026-11-08T11:45:00Z"), fx)["eligible"])
        self.assertFalse(self.rec(uncovered_api(fx, self.repo, pending=True), fx)["eligible"])

    def test_a_403_on_checks_makes_no_candidate_and_does_not_stop_the_scan(self):
        fx = self.fx()
        api = uncovered_api(fx, self.repo)
        head = fx["pr"]["head"]["sha"]
        api.routes[rf"/repos/{self.repo}/commits/{head}/check-runs"] = probe.ApiError(403, "Resource not accessible by personal access token")
        rec = self.rec(api, fx)
        self.assertFalse(rec["eligible"])
        self.assertEqual(rec["review_in_progress"], "unknown")
        self.assertIn("403", rec["error"])
        # a rate-limited PR listed after it is still found and selected
        later = copy.deepcopy(fx["pr"])
        later.update(number=9, created_at="2026-11-01T00:00:00Z", head={"sha": "9999999aaaaaaa", "ref": "x"})
        api.routes[rf"/repos/{self.repo}/pulls"] = [fx["pr"], later]
        api.routes[rf"/repos/{self.repo}/issues/9/comments"] = [comment(BOT, LIMIT.format(n=5), "2026-11-08T10:00:00Z")]
        api.routes[rf"/repos/{self.repo}/pulls/9/reviews"] = []
        doc = probe.probe(api, [self.repo], [], NOW, argparse.Namespace(**vars(OPTS), exclude=""))
        self.assertEqual(doc["candidates"], [{"owner": "kodflow", "repo": self.repo, "number": 9, "class": "rate_limited"}])
        self.assertEqual(doc["errors"], [])
        # a status read refused too, or the commit itself: never a candidate
        api.routes[rf"/repos/{self.repo}/commits/{head}"] = probe.ApiError(403, "forbidden")
        self.assertFalse(self.rec(api, fx)["eligible"])

    def test_unknown_never_makes_a_record(self):
        fx = self.fx()
        no_policy = argparse.Namespace(**dict(vars(OPTS), policy_dir=None))
        self.assertIsNone(self.rec(uncovered_api(fx, self.repo), fx, no_policy))       # eligible unknown
        self.assertIsNone(self.rec(uncovered_api(fx, self.repo, comments=[]), fx))      # no marker anywhere: covered unknown

    def test_covered_head_makes_no_record(self):
        fx = self.fx()
        fx["pr"]["head"]["sha"] = N9
        self.assertIsNone(self.rec(uncovered_api(fx, self.repo), fx))

    def test_probe_selects_it_and_relaunch_posts_cron(self):
        fx = self.fx()
        # real data: the "Review rate limited" reply of 01:02 was followed by a
        # review, the pause of 07:00 stands: a paused PR goes through this class
        api = uncovered_api(fx, self.repo)
        doc = probe.probe(api, [self.repo], [], NOW, argparse.Namespace(**vars(OPTS), exclude=""))
        self.assertEqual(doc["candidates"], [{"owner": "kodflow", "repo": self.repo, "number": 8, "class": "uncovered"}])
        self.assertEqual(doc["coverage"]["uncovered"], 1)
        self.assertEqual([b["kind"] for b in doc["blocked"]], ["paused"])
        ropts = argparse.Namespace(**vars(OPTS), dry_run=False, delay=0)
        self.assertEqual(probe.relaunch(api, doc, NOW, ropts), 0)
        self.assertEqual(api.posted, [(self.repo, 8, probe.command_body("cron", A6))])

    def test_without_policy_dir_nothing_is_selected(self):
        fx = self.fx()
        doc = probe.probe(uncovered_api(fx, self.repo), [self.repo], [], NOW,
                          argparse.Namespace(**dict(vars(OPTS), policy_dir=None), exclude=""))
        self.assertEqual(doc["candidates"], [])
        self.assertEqual(doc["uncovered"], [])


class Select(unittest.TestCase):
    def b(self, owner, number, created, kind="rate_limited", eligible=True, ready=True, owner_pending=False):
        return {"owner": owner, "repo": f"{owner}/r", "number": number, "created_at": created, "kind": kind,
                "ready": ready, "eligible": eligible, "relaunch": {"state": "none", "owner_pending": owner_pending}}

    def u(self, owner, number, created, eligible=True, owner_pending=False):
        return {"owner": owner, "repo": f"{owner}/r", "number": number, "created_at": created, "eligible": eligible,
                "relaunch": {"state": "none", "owner_pending": owner_pending}}

    def test_rate_limited_first(self):
        got = probe.select_candidates([self.b("a", 5, "2026-11-05T00:00:00Z")], [self.u("a", 1, "2026-11-01T00:00:00Z")])
        self.assertEqual([(c["number"], c["class"]) for c in got], [(5, "rate_limited")])

    def test_uncovered_when_no_rate_limit(self):
        got = probe.select_candidates([self.b("a", 5, "2026-11-05T00:00:00Z", kind="paused")], [self.u("a", 1, "2026-11-01T00:00:00Z")])
        self.assertEqual([(c["number"], c["class"]) for c in got], [(1, "uncovered")])

    def test_no_uncovered_while_a_rate_limit_runs(self):
        got = probe.select_candidates([self.b("a", 5, "2026-11-05T00:00:00Z", eligible=False, ready=False)],
                                      [self.u("a", 1, "2026-11-01T00:00:00Z")])
        self.assertEqual(got, [])

    def test_cron_pending_blocks_the_owner_hook_does_not(self):
        self.assertEqual(probe.select_candidates([], [self.u("a", 1, "2026-11-01T00:00:00Z"),
                                                      self.u("a", 2, "2026-11-02T00:00:00Z", eligible=False, owner_pending=True)]), [])
        got = probe.select_candidates([], [self.u("a", 1, "2026-11-01T00:00:00Z"), self.u("a", 2, "2026-11-02T00:00:00Z", eligible=False)])
        self.assertEqual(got[0]["number"], 1)


if __name__ == "__main__":
    unittest.main()
