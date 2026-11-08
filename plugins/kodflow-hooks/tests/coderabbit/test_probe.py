"""Offline tests of probe.py: a fake API, no network. Run: python3 -I -m unittest discover -s plugins/kodflow-hooks/tests/coderabbit"""
import argparse
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "hooks", "coderabbit"))
import probe  # noqa: E402

NOW = probe.parse_time("2026-11-08T12:00:00Z")
BOT = {"login": "coderabbitai[bot]", "type": "Bot"}
HUMAN = {"login": "kodflow", "type": "User"}
GHA = {"login": "github-actions[bot]", "type": "Bot"}
LIMIT = "<!-- rate limited by coderabbit.ai -->\n> ## Review limit reached\n> **Next included review available in {n} minutes.**"
OPTS = argparse.Namespace(buffer_minutes=2, unknown_wait_minutes=60, stale_minutes=30, max_attempts=3)


def comment(user, body, created, updated=None):
    return {"user": user, "body": body, "created_at": created, "updated_at": updated or created, "html_url": "u"}


def review(body, commit, at, state="COMMENTED"):
    return {"user": BOT, "body": body, "commit_id": commit, "submitted_at": at, "state": state}


def pr(number, created="2026-11-01T00:00:00Z", sha="h1"):
    return {"number": number, "title": "t", "created_at": created, "head": {"sha": sha}, "user": HUMAN, "draft": False, "state": "open"}


class FakeApi(probe.Api):
    def __init__(self, comments=None, reviews=None, pulls=None):
        super().__init__()
        self.c, self.r, self.posted, self.pulls = comments or {}, reviews or {}, [], pulls or []

    def paginate(self, owner, path, params=None, key=None, max_pages=None):
        self.calls += 1
        if path.endswith("/pulls"):
            return self.pulls
        n = int(path.split("/")[-2])
        return (self.c if path.endswith("/comments") else self.r).get(n, [])

    def post_comment(self, owner, repo, number, body):
        self.posted.append((repo, number, body))


class Parse(unittest.TestCase):
    def test_wait_forms(self):
        f = probe.parse_wait_minutes
        self.assertEqual(f("**Next included review available in 16 minutes.**"), 16)
        self.assertEqual(f("Next review available in: 1 hour 5 minutes"), 65)
        self.assertEqual(f("available in 30 seconds"), 1)
        self.assertEqual(f("available in an hour"), 60)
        self.assertEqual(f("**Or wait 40 minutes for your next included review.**"), 40)
        self.assertIsNone(f("no delay here"))
        self.assertIsNone(f("Next review available in"))  # empty capture, once raised TypeError

    def test_reason(self):
        self.assertEqual(probe.refusal_reason("has disabled usage-based review continuation"), "usage_based_disabled")
        self.assertEqual(probe.refusal_reason("available in 3 minutes"), "hourly_limit")
        self.assertEqual(probe.refusal_reason("Review limit reached"), "unknown")


class Analyze(unittest.TestCase):
    def run_pr(self, comments, reviews=None, number=1, sha="h1"):
        api = FakeApi({number: comments}, {number: reviews or []})
        return probe.analyze_pr(api, "o/r", pr(number, sha=sha), NOW, OPTS)

    def test_ready_after_delay(self):
        rec = self.run_pr([comment(BOT, LIMIT.format(n=16), "2026-11-08T10:00:00Z", "2026-11-08T11:00:00Z")])
        self.assertTrue(rec["eligible"])
        self.assertEqual(rec["next_available_minutes"], 16)
        self.assertEqual(rec["refused_at"], "2026-11-08T11:00:00Z")

    def test_not_ready_inside_delay(self):
        rec = self.run_pr([comment(BOT, LIMIT.format(n=30), "2026-11-08T11:45:00Z")])
        self.assertFalse(rec["ready"])
        self.assertFalse(rec["eligible"])
        self.assertEqual(rec["minutes_until_ready"], 17)

    def test_no_refusal(self):
        self.assertIsNone(self.run_pr([comment(BOT, "walkthrough", "2026-11-08T10:00:00Z")]))

    def test_review_on_head_clears(self):
        c = [comment(BOT, LIMIT.format(n=1), "2026-11-08T10:00:00Z")]
        r = [review("**Actionable comments posted: 2**", "h1", "2026-11-08T09:00:00Z")]
        self.assertIsNone(self.run_pr(c, r))

    def test_review_on_old_commit_before_refusal_does_not_clear(self):
        c = [comment(BOT, LIMIT.format(n=1), "2026-11-08T10:00:00Z")]
        r = [review("**Actionable comments posted: 2**", "old", "2026-11-08T09:00:00Z")]
        self.assertIsNotNone(self.run_pr(c, r))

    def test_review_after_refusal_clears(self):
        c = [comment(BOT, LIMIT.format(n=1), "2026-11-08T10:00:00Z")]
        r = [review("No actionable comments were generated.", "old", "2026-11-08T10:30:00Z")]
        self.assertIsNone(self.run_pr(c, r))

    def test_no_delay_uses_default(self):
        rec = self.run_pr([comment(BOT, "<!-- rate limited by coderabbit.ai -->", "2026-11-08T11:30:00Z")])
        self.assertIsNone(rec["next_available_minutes"])
        self.assertEqual(rec["ready_at"], "2026-11-08T12:32:00Z")
        self.assertFalse(rec["ready"])

    def test_relaunch_states(self):
        base = comment(BOT, LIMIT.format(n=1), "2026-11-08T09:00:00Z")
        def st(*cmds):
            return self.run_pr([base, *cmds])["relaunch"]["state"]
        self.assertEqual(st(), "none")
        self.assertEqual(st(comment(HUMAN, "@coderabbitai review", "2026-11-08T11:50:00Z")), "pending")
        self.assertEqual(st(comment(HUMAN, "@coderabbitai review", "2026-11-08T11:00:00Z")), "stale")
        # a bot's command is ignored by CodeRabbit, so it counts for nothing
        self.assertEqual(st(comment(GHA, "@coderabbitai review", "2026-11-08T11:50:00Z")), "none")
        # a command older than the refusal was answered by that refusal
        self.assertEqual(st(comment(HUMAN, "@coderabbitai review", "2026-11-08T08:00:00Z")), "none")
        many = [comment(HUMAN, "@coderabbitai review", t) for t in ("2026-11-08T09:10:00Z", "2026-11-08T09:40:00Z", "2026-11-08T10:10:00Z")]
        self.assertEqual(st(*many), "abandoned")
        self.assertFalse(self.run_pr([base, *many])["eligible"])

    def test_latest_refusal_wins(self):
        old = comment(BOT, LIMIT.format(n=1), "2026-11-08T08:00:00Z")
        new = comment(BOT, LIMIT.format(n=40), "2026-11-08T11:50:00Z")
        rec = self.run_pr([old, new])
        self.assertEqual(rec["next_available_minutes"], 40)


class Select(unittest.TestCase):
    def rec(self, owner, number, created, state="none", eligible=True):
        return {"owner": owner, "repo": f"{owner}/r", "number": number, "created_at": created,
                "relaunch": {"state": state}, "eligible": eligible}

    def test_one_per_owner_oldest(self):
        got = probe.select_candidates([
            self.rec("a", 2, "2026-11-02T00:00:00Z"), self.rec("a", 1, "2026-11-01T00:00:00Z"),
            self.rec("b", 9, "2026-11-05T00:00:00Z")])
        self.assertEqual([(c["owner"], c["number"]) for c in got], [("a", 1), ("b", 9)])

    def test_pending_blocks_owner(self):
        got = probe.select_candidates([
            self.rec("a", 1, "2026-11-01T00:00:00Z", state="pending", eligible=False),
            self.rec("a", 2, "2026-11-02T00:00:00Z")])
        self.assertEqual(got, [])

    def test_ineligible_skipped(self):
        got = probe.select_candidates([
            self.rec("a", 1, "2026-11-01T00:00:00Z", eligible=False), self.rec("a", 2, "2026-11-02T00:00:00Z")])
        self.assertEqual(got[0]["number"], 2)


class Relaunch(unittest.TestCase):
    def test_posts_once_and_rechecks(self):
        api = FakeApi({1: [comment(BOT, LIMIT.format(n=1), "2026-11-08T09:00:00Z")]}, {1: []})
        api.get = lambda owner, path: pr(1)
        opts = argparse.Namespace(**vars(OPTS), dry_run=False, delay=0)
        doc = {"schema_version": 1, "candidates": [{"owner": "o", "repo": "o/r", "number": 1}]}
        self.assertEqual(probe.relaunch(api, doc, NOW, opts), 0)
        self.assertEqual(api.posted, [("o/r", 1, "@coderabbitai review")])

    def test_skips_when_no_longer_blocked(self):
        api = FakeApi({1: []}, {1: []})
        api.get = lambda owner, path: pr(1)
        opts = argparse.Namespace(**vars(OPTS), dry_run=False, delay=0)
        doc = {"schema_version": 1, "candidates": [{"owner": "o", "repo": "o/r", "number": 1}]}
        probe.relaunch(api, doc, NOW, opts)
        self.assertEqual(api.posted, [])

    def test_dry_run_posts_nothing(self):
        api = FakeApi({1: [comment(BOT, LIMIT.format(n=1), "2026-11-08T09:00:00Z")]}, {1: []})
        api.get = lambda owner, path: pr(1)
        opts = argparse.Namespace(**vars(OPTS), dry_run=True, delay=0)
        probe.relaunch(api, {"schema_version": 1, "candidates": [{"owner": "o", "repo": "o/r", "number": 1}]}, NOW, opts)
        self.assertEqual(api.posted, [])


def listed(number, ref, draft=False, updated="2026-11-08T11:30:00Z"):
    p = pr(number)
    p.update({"draft": draft, "updated_at": updated, "head": {"sha": "h" + str(number), "ref": ref}})
    return p


def cap_opts(**kw):
    base = dict(OPTS.__dict__, action="pr_create", cwd=".", repo="o/r", branch="feat/x", cache_dir="", cache_minutes=5,
                recent=5, window_hours=3, deadline=4.0)
    base.update(kw)
    return argparse.Namespace(**base)


class Capacity(unittest.TestCase):
    """The hint: limited or not, for which action, at what cost."""

    def api(self, refused=(1,), extra=()):
        pulls = [listed(1, "feat/a"), listed(2, "feat/b"), listed(3, "feat/x", draft=True)] + list(extra)
        comments = {n: [comment(BOT, LIMIT.format(n=30), "2026-11-08T11:50:00Z")] for n in refused}
        return FakeApi(comments, {}, pulls)

    def test_pr_create_limited_gives_the_three_ways_out(self):
        out = probe.capacity(cap_opts(), NOW, self.api())
        self.assertEqual(out["state"], "limited")
        self.assertEqual(out["minutes_until_review"], 22)   # 11:50 + 30 + 2 buffer = 12:22
        for needle in ("#1, #2", "--draft", "about 22 min"):
            self.assertIn(needle, out["context"])
        self.assertNotIn("Wait about", out["context"])      # 22 > 15: waiting is not offered

    def test_short_delay_offers_to_wait(self):
        api = FakeApi({1: [comment(BOT, LIMIT.format(n=3), "2026-11-08T11:57:00Z")]}, {}, [listed(1, "feat/a")])
        out = probe.capacity(cap_opts(), NOW, api)
        self.assertIn("Wait about 2 min", out["context"])
        self.assertIn("(#1)", out["context"])  # the one open PR is offered to group into

    def test_push_on_a_branch_with_a_ready_pr(self):
        out = probe.capacity(cap_opts(action="push", branch="feat/b"), NOW, self.api())
        self.assertIn("PR #2", out["context"])
        self.assertIn("push once", out["context"])

    def test_push_is_silent_without_a_pr_or_on_a_draft(self):
        self.assertEqual(probe.capacity(cap_opts(action="push", branch="feat/none"), NOW, self.api())["context"], "")
        self.assertEqual(probe.capacity(cap_opts(action="push", branch="feat/x"), NOW, self.api())["context"], "")

    def test_available_is_silent(self):
        out = probe.capacity(cap_opts(), NOW, self.api(refused=()))
        self.assertEqual((out["state"], out["context"]), ("available", ""))

    def test_a_refusal_whose_delay_has_passed_is_not_a_limit(self):
        api = FakeApi({1: [comment(BOT, LIMIT.format(n=3), "2026-11-08T10:00:00Z")]}, {}, [listed(1, "feat/a")])
        self.assertEqual(probe.capacity(cap_opts(), NOW, api)["state"], "available")

    def test_cost_is_bounded_and_a_cached_call_is_free(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            api = self.api()
            first = probe.capacity(cap_opts(cache_dir=d), NOW, api)
            # list + comments of PR 1 and 2 (draft 3 skipped) + reviews of PR 1 (a refusal)
            self.assertEqual((first["cache"], first["api_calls"]), ("miss", 4))
            api2 = self.api()
            second = probe.capacity(cap_opts(cache_dir=d), probe.parse_time("2026-11-08T12:04:00Z"), api2)
            self.assertEqual((second["cache"], second["api_calls"], api2.calls), ("hit", 0, 0))
            self.assertEqual(second["minutes_until_review"], 18)   # recomputed from the clock, not stored
            third = probe.capacity(cap_opts(cache_dir=d), probe.parse_time("2026-11-08T12:06:00Z"), self.api())
            self.assertEqual(third["cache"], "miss")               # 6 min: past the 5 min TTL

    def test_old_prs_are_not_read(self):
        api = FakeApi({}, {}, [listed(1, "feat/a", updated="2026-11-07T00:00:00Z")])
        probe.capacity(cap_opts(), NOW, api)
        self.assertEqual(api.calls, 1)                              # the list alone

    def test_fails_open(self):
        class Boom(FakeApi):
            def paginate(self, *a, **k):
                raise probe.ApiError(401, "Bad credentials")
        out = probe.capacity(cap_opts(), NOW, Boom())
        self.assertEqual((out["state"], out["context"]), ("unknown", ""))
        self.assertIn("401", out["error"])

    def test_remote_urls(self):
        f = probe.repo_from_remote
        for url in ("https://github.com/kodflow/labs.git", "git@github.com:kodflow/labs.git", "ssh://git@github.com/kodflow/labs", "https://" + "x-access-token" + ":t" + "@github.com/kodflow/labs/"):
            self.assertEqual(f(url), "kodflow/labs", url)
        self.assertIsNone(f("https://gitlab.com/a/b.git"))


if __name__ == "__main__":
    unittest.main()
