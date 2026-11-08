#!/usr/bin/env python3
"""CodeRabbit review-limit probe and relauncher.

Single source of the CodeRabbit quota logic: kodflow-hooks' PreToolUse hint
(`capacity`, via hooks/scripts/lib/coderabbit.sh) and kodflow/labs' scheduled
relaunch workflow (`probe` and `relaunch`, which checks this file out at a
pinned commit) both run THIS file. Nothing else reads CodeRabbit's messages.

Three subcommands, standard library only (Python 3.9+), no third-party import:

  probe      list the open, non-draft pull requests whose last CodeRabbit action
             is a refusal for quota and that no review has followed. Prints ONE
             JSON document on stdout; writes nothing, posts nothing.
  relaunch   post `@coderabbitai review` on the candidates of a probe document
             (at most one pull request per owner), after re-checking each one.
  capacity   for ONE repository and the action about to run (`gh pr create`,
             `git push`): is CodeRabbit rate limited there, for how long, and
             what to do. Cached, bounded by a deadline, never raises: the answer
             is JSON on stdout, exit 0, `state` unknown on any failure.

The JSON contract of `probe` is the stable interface (it feeds a workflow now,
a Claude Code hook later). `schema_version` moves only on a breaking change;
fields may be added. See docs/runbooks/coderabbit-relaunch.md for the schema.

What counts as what (read from real comments, 2026-11-08):

  refusal      a comment of `coderabbitai[bot]` on the pull request whose body
               carries the marker `rate limited by coderabbit.ai` (an HTML
               comment) or the heading `Review limit reached`. The comment is
               edited in place, so its `updated_at` is when it was written.
                 free OSS plan  "Next included review available in N minutes."
                 paid plan      "...has disabled usage-based review continuation"
                                (no delay announced)
  real review  a pull request review of the bot whose body contains
               `Actionable comments posted` or `No actionable comments were
               generated` (or whose state is APPROVED / CHANGES_REQUESTED).
  covered      a real review on the head commit, or submitted after the refusal.
  relaunch     a comment of a NON-bot account, posted after the refusal, that
               starts with `@coderabbitai review` or `@coderabbitai full review`.
               CodeRabbit ignores commands from bot accounts (github-actions[bot]
               included), so the comment must come from a person's token.

Authentication, per owner (a fine-grained token has ONE resource owner):
  GH_TOKEN_<OWNER> (upper case, every non-alphanumeric as `_`), then GH_TOKEN,
  then GITHUB_TOKEN, then `gh auth token` for a laptop. A token is never
  printed, logged or put on a command line.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple

SCHEMA_VERSION = 1
API = "https://api.github.com"
BOT_LOGIN = "coderabbitai[bot]"
COMMAND = "@coderabbitai review"

# The HTML marker is the stable signal; the headings vary ("Review limit reached",
# "Review paused — included plan limit reached").
REFUSAL_RE = re.compile(r"rate limited by coderabbit\.ai|Review limit reached|Review paused", re.I)
USAGE_BASED_RE = re.compile(r"usage-based review continuation", re.I)
REAL_REVIEW_RE = re.compile(
    r"Actionable comments posted|No actionable comments were generated", re.I
)
COMMAND_RE = re.compile(r"^\s*@coderabbitai\s+(?:full\s+)?review\b", re.I)
# "Next included review available in 16 minutes." / "in: 1 hour 5 minutes" /
# "Or wait 40 minutes for your next included review."
WAIT_RE = re.compile(r"available\s+in\s*:?\s*[*_ ]*([^\n]{0,80})|\bwait\s+([^\n]{0,40}?)\s+for\s+your\s+next", re.I)
UNIT_RE = re.compile(r"(\d+)\s*(hour|hr|minute|min|second|sec)", re.I)
UNIT_MINUTES = {"hour": 60.0, "hr": 60.0, "minute": 1.0, "min": 1.0, "second": 1 / 60, "sec": 1 / 60}

DEFAULT_BUFFER_MINUTES = 2      # past the announced delay, as the stated reset is exact
DEFAULT_UNKNOWN_WAIT_MINUTES = 60  # no delay announced (paid plan): rolling hourly refill
DEFAULT_STALE_MINUTES = 30      # a relaunch with no answer after this is lost
DEFAULT_MAX_ATTEMPTS = 3        # relaunches left unanswered before giving up on a PR
DEFAULT_EXCLUDE = r"-ghsa-"     # temporary private forks of security advisories


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


# ---------------------------------------------------------------- time helpers


def parse_time(value: str) -> dt.datetime:
    return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)


def fmt_time(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------- GitHub API


def token_for(owner: str, timeout: float = 3.0) -> Optional[str]:
    suffix = re.sub(r"[^A-Za-z0-9]", "_", owner).upper()
    for var in (f"GH_TOKEN_{suffix}", "GH_TOKEN", "GITHUB_TOKEN"):
        if os.environ.get(var):
            return os.environ[var]
    if timeout <= 0.2:
        return None
    try:
        out = subprocess.run(
            ["gh", "auth", "token"], capture_output=True, text=True, timeout=timeout, check=False
        )
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return None


class Api:
    """Minimal GitHub REST client; one token per owner."""

    def __init__(self, deadline: Optional[float] = None) -> None:
        self._tokens: Dict[str, Optional[str]] = {}
        self.calls = 0                       # requests actually sent
        self._deadline = deadline            # time.monotonic() instant, or None

    def _token(self, owner: str) -> Optional[str]:
        if owner not in self._tokens:
            budget = 3.0 if self._deadline is None else min(3.0, self._deadline - time.monotonic())
            self._tokens[owner] = token_for(owner, budget)
        return self._tokens[owner]

    def _request(self, owner: str, url: str, method: str = "GET", payload: Any = None) -> Tuple[Any, Dict[str, str]]:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "kodflow-coderabbit-probe",
        }
        token = self._token(owner)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        for attempt in range(3):
            timeout = 30.0
            if self._deadline is not None:
                timeout = min(timeout, self._deadline - time.monotonic())
                if timeout <= 0.2:
                    raise ApiError(0, "deadline reached")
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (https only)
                    body = resp.read()
                    return (json.loads(body) if body else None), dict(resp.headers)
            except urllib.error.HTTPError as err:
                # Only the status and GitHub's message: never headers (the token).
                try:
                    message = json.loads(err.read()).get("message", err.reason)
                except (ValueError, AttributeError):
                    message = str(err.reason)
                if err.code in (502, 503, 504) and attempt < 2 and self._deadline is None:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise ApiError(err.code, message) from None
            except (urllib.error.URLError, OSError) as err:
                if attempt < 2 and self._deadline is None:
                    time.sleep(2 * (attempt + 1))
                    continue
                raise ApiError(0, str(getattr(err, "reason", err))) from None
        raise ApiError(0, "unreachable")

    def paginate(self, owner: str, path: str, params: Optional[Dict[str, Any]] = None, key: Optional[str] = None, max_pages: Optional[int] = None) -> List[Any]:
        query = dict(params or {})
        query.setdefault("per_page", 100)
        url = f"{API}{path}?{urllib.parse.urlencode(query)}"
        out: List[Any] = []
        pages = 0
        while url:
            data, headers = self._request(owner, url)
            out.extend(data[key] if key else data)
            pages += 1
            if max_pages is not None and pages >= max_pages:
                break
            link = {k.lower(): v for k, v in headers.items()}.get("link", "")
            m = re.search(r'<([^>]+)>;\s*rel="next"', link)
            url = m.group(1) if m else ""
        return out

    def post_comment(self, owner: str, repo: str, number: int, body: str) -> None:
        self._request(owner, f"{API}/repos/{repo}/issues/{number}/comments", "POST", {"body": body})

    def get(self, owner: str, path: str) -> Any:
        return self._request(owner, f"{API}{path}")[0]


# ---------------------------------------------------------------------- parsing


def parse_wait_minutes(body: str) -> Optional[int]:
    """Minutes announced by "available in ...", rounded up; None when absent."""
    m = WAIT_RE.search(body)
    if not m:
        return None
    segment = m.group(1) or m.group(2) or ""
    total = sum(int(n) * UNIT_MINUTES[u.lower()] for n, u in UNIT_RE.findall(segment))
    if total:
        return int(math.ceil(total))
    if re.search(r"\ban?\s+hour\b", segment, re.I):
        return 60
    if re.search(r"\b(?:less than )?an?\s+minute\b", segment, re.I):
        return 1
    return None


def refusal_reason(body: str) -> str:
    if USAGE_BASED_RE.search(body):
        return "usage_based_disabled"
    if parse_wait_minutes(body) is not None:
        return "hourly_limit"
    return "unknown"


def is_bot(user: Optional[Dict[str, Any]]) -> bool:
    return bool(user) and (user.get("type") == "Bot" or str(user.get("login", "")).endswith("[bot]"))


def latest_refusal(comments: Iterable[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    best = None
    for c in comments:
        if (c.get("user") or {}).get("login") != BOT_LOGIN:
            continue
        if not REFUSAL_RE.search(c.get("body") or ""):
            continue
        stamp = c.get("updated_at") or c.get("created_at")
        if best is None or stamp > (best.get("updated_at") or best.get("created_at")):
            best = c
    return best


def covering_review(reviews: Iterable[Dict[str, Any]], head_sha: str, refused_at: dt.datetime) -> Optional[Dict[str, Any]]:
    for r in reviews:
        if (r.get("user") or {}).get("login") != BOT_LOGIN:
            continue
        real = bool(REAL_REVIEW_RE.search(r.get("body") or "")) or r.get("state") in ("APPROVED", "CHANGES_REQUESTED")
        if not real or not r.get("submitted_at"):
            continue
        if r.get("commit_id") == head_sha or parse_time(r["submitted_at"]) > refused_at:
            return r
    return None


def relaunch_state(comments: Iterable[Dict[str, Any]], refused_at: dt.datetime, now: dt.datetime, stale_minutes: int, max_attempts: int) -> Dict[str, Any]:
    sent = [
        c for c in comments
        if not is_bot(c.get("user"))
        and COMMAND_RE.match(c.get("body") or "")
        and parse_time(c["created_at"]) > refused_at
    ]
    sent.sort(key=lambda c: c["created_at"])
    if not sent:
        return {"state": "none", "attempts": 0, "last_commented_at": None}
    last = parse_time(sent[-1]["created_at"])
    if len(sent) >= max_attempts:
        state = "abandoned"
    elif now - last < dt.timedelta(minutes=stale_minutes):
        state = "pending"
    else:
        state = "stale"
    return {"state": state, "attempts": len(sent), "last_commented_at": fmt_time(last)}


# --------------------------------------------------------------------- analysis


def analyze_pr(api: Api, repo: str, pr: Dict[str, Any], now: dt.datetime, opts: argparse.Namespace) -> Optional[Dict[str, Any]]:
    """The blocked-PR record, or None when the PR is not blocked by the quota."""
    owner = repo.split("/")[0]
    number = pr["number"]
    comments = api.paginate(owner, f"/repos/{repo}/issues/{number}/comments")
    refusal = latest_refusal(comments)
    if refusal is None:
        return None
    refused_at = parse_time(refusal.get("updated_at") or refusal["created_at"])
    head_sha = pr["head"]["sha"]
    reviews = api.paginate(owner, f"/repos/{repo}/pulls/{number}/reviews")
    if covering_review(reviews, head_sha, refused_at):
        return None

    body = refusal.get("body") or ""
    wait = parse_wait_minutes(body)
    wait_used = wait if wait is not None else opts.unknown_wait_minutes
    available_at = refused_at + dt.timedelta(minutes=wait_used)
    ready_at = available_at + dt.timedelta(minutes=opts.buffer_minutes)
    relaunch = relaunch_state(comments, refused_at, now, opts.stale_minutes, opts.max_attempts)
    ready = now >= ready_at
    seconds_left = max(0.0, (ready_at - now).total_seconds())
    return {
        "repo": repo,
        "owner": owner,
        "number": number,
        "title": pr.get("title", ""),
        "url": pr.get("html_url", f"https://github.com/{repo}/pull/{number}"),
        "author": (pr.get("user") or {}).get("login"),
        "created_at": pr["created_at"],
        "head_sha": head_sha,
        "reason": refusal_reason(body),
        "refused_at": fmt_time(refused_at),
        "refusal_comment_url": refusal.get("html_url"),
        "next_available_minutes": wait,
        "next_available_at": fmt_time(available_at) if wait is not None else None,
        "ready_at": fmt_time(ready_at),
        "ready": ready,
        "minutes_until_ready": int(math.ceil(seconds_left / 60)),
        "relaunch": relaunch,
        "eligible": ready and relaunch["state"] in ("none", "stale"),
    }


def select_candidates(blocked: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """At most one PR per owner: the oldest eligible, none while a relaunch of that owner awaits its answer."""
    by_owner: Dict[str, List[Dict[str, Any]]] = {}
    for rec in blocked:
        by_owner.setdefault(rec["owner"], []).append(rec)
    out = []
    for owner in sorted(by_owner):
        recs = by_owner[owner]
        if any(r["relaunch"]["state"] == "pending" for r in recs):
            continue
        eligible = sorted((r for r in recs if r["eligible"]), key=lambda r: (r["created_at"], r["repo"], r["number"]))
        if eligible:
            out.append({"owner": owner, "repo": eligible[0]["repo"], "number": eligible[0]["number"]})
    return out


def list_open_prs(api: Api, repo: str) -> List[Dict[str, Any]]:
    owner = repo.split("/")[0]
    prs = api.paginate(owner, f"/repos/{repo}/pulls", {"state": "open"})
    return [p for p in prs if not p.get("draft")]


def repos_of_owner(api: Api, owner: str) -> List[str]:
    items = api.paginate(owner, "/search/issues", {"q": f"is:pr is:open archived:false user:{owner}"}, key="items")
    seen = []
    for it in items:
        name = "/".join(it["repository_url"].split("/")[-2:])
        if name not in seen:
            seen.append(name)
    return seen


def probe(api: Api, repos: List[str], owners: List[str], now: dt.datetime, opts: argparse.Namespace) -> Dict[str, Any]:
    errors: List[Dict[str, str]] = []
    exclude = re.compile(opts.exclude) if opts.exclude else None
    targets: List[str] = []
    for owner in owners:
        try:
            targets.extend(repos_of_owner(api, owner))
        except ApiError as err:
            errors.append({"scope": owner, "error": str(err)})
    targets.extend(repos)
    targets = [r for i, r in enumerate(targets) if r not in targets[:i] and not (exclude and exclude.search(r))]

    blocked: List[Dict[str, Any]] = []
    scanned_prs = 0
    scanned_repos = 0
    for repo in targets:
        try:
            prs = list_open_prs(api, repo)
            scanned_repos += 1
            scanned_prs += len(prs)
            for pr in prs:
                rec = analyze_pr(api, repo, pr, now, opts)
                if rec:
                    blocked.append(rec)
        except ApiError as err:
            errors.append({"scope": repo, "error": str(err)})
    blocked.sort(key=lambda r: (r["created_at"], r["repo"], r["number"]))
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": fmt_time(now),
        "bot_login": BOT_LOGIN,
        "scanned": {"repos": scanned_repos, "pull_requests": scanned_prs},
        "blocked": blocked,
        "candidates": select_candidates(blocked),
        "errors": errors,
    }


# ------------------------------------------------------------------- relaunching


def relaunch(api: Api, document: Dict[str, Any], now: dt.datetime, opts: argparse.Namespace) -> int:
    if document.get("schema_version") != SCHEMA_VERSION:
        print(f"unsupported schema_version {document.get('schema_version')!r}", file=sys.stderr)
        return 1
    status = 0
    for cand in document.get("candidates", []):
        repo, number = cand["repo"], cand["number"]
        # Re-read the pull request just before posting: the document may be minutes old.
        try:
            pr = api.get(cand["owner"], f"/repos/{repo}/pulls/{number}")
            if pr.get("state") != "open" or pr.get("draft"):
                print(f"skip {repo}#{number}: no longer an open non-draft pull request")
                continue
            rec = analyze_pr(api, repo, pr, now, opts)
            if rec is None or not rec["eligible"]:
                print(f"skip {repo}#{number}: no longer blocked or not eligible")
                continue
            if opts.dry_run:
                print(f"dry-run: would post '{COMMAND}' on {repo}#{number}")
                continue
            api.post_comment(cand["owner"], repo, number, COMMAND)
            print(f"posted '{COMMAND}' on {repo}#{number}")
            time.sleep(opts.delay)
        except ApiError as err:
            print(f"error on {repo}#{number}: {err}", file=sys.stderr)
            status = 1
    return status


# ---------------------------------------------------------------------- capacity

DEFAULT_CACHE_MINUTES = 5
DEFAULT_RECENT = 5          # open non-draft PRs read per refresh (one comments call each)
DEFAULT_WINDOW_HOURS = 3    # a PR untouched for longer cannot hold a live refusal
DEFAULT_DEADLINE_SECONDS = 4.0
# GitHub's own alphabet: an owner is alphanumerics and single hyphens, a name
# alphanumerics, `_`, `-` and `.`, never `.` or `..` alone.
_OWNER = r"([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*)"
_NAME = r"((?!\.{1,2}(?:\.git)?/?$)[A-Za-z0-9_.-]+?)"
REMOTE_RES = (
    re.compile(r"^https?://(?:[^/@]*@)?github\.com/" + _OWNER + "/" + _NAME + r"(?:\.git)?/?$"),
    re.compile(r"^(?:ssh://)?git@github\.com[:/]" + _OWNER + "/" + _NAME + r"(?:\.git)?/?$"),
)


def git_output(cwd: str, *args: str, timeout: float = 3.0) -> Optional[str]:
    if timeout <= 0.2:
        return None
    try:
        out = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return out.stdout.strip() if out.returncode == 0 and out.stdout.strip() else None


def valid_repo(repo: str) -> bool:
    """OWNER/NAME in GitHub's alphabet, with no `.` or `..` segment."""
    return bool(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo)) and not {".", ".."} & set(repo.split("/"))


def repo_from_remote(url: str) -> Optional[str]:
    for rx in REMOTE_RES:
        m = rx.match(url.strip())
        if m:
            return f"{m.group(1)}/{m.group(2)}"
    return None


def _cache_path(cache_dir: str, repo: str) -> str:
    return os.path.join(cache_dir, re.sub(r"[^A-Za-z0-9_.-]", "_", repo.replace("/", "__")) + ".json")


def _read_cache(path: str, now: dt.datetime, minutes: int) -> Optional[Dict[str, Any]]:
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
        if doc.get("v") == SCHEMA_VERSION and 0 <= (now - parse_time(doc["fetched_at"])).total_seconds() < minutes * 60:
            return doc["sample"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def _write_cache(path: str, sample: Dict[str, Any], now: dt.datetime) -> None:
    try:
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        tmp = f"{path}.{os.getpid()}.tmp"
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump({"v": SCHEMA_VERSION, "fetched_at": fmt_time(now), "sample": sample}, fh)
        os.replace(tmp, path)
    except OSError:
        pass  # a cache that cannot be written only costs the next call


def sample_repo(api: Api, repo: str, now: dt.datetime, opts: argparse.Namespace) -> Dict[str, Any]:
    """What the hint needs of a repository: its open PRs and the refusals still standing.

    Calls: 1 (the list) + 1 per recent non-draft PR (its comments) + 1 per PR
    whose comments hold a refusal (its reviews): at most 1 + 2 * `recent`.
    """
    owner = repo.split("/")[0]
    prs = api.paginate(owner, f"/repos/{repo}/pulls", {"state": "open", "sort": "updated", "direction": "desc", "per_page": 30}, max_pages=1)
    horizon = now - dt.timedelta(hours=opts.window_hours)
    blocked = []
    checked = 0
    for pr in prs:
        if pr.get("draft") or checked >= opts.recent or parse_time(pr["updated_at"]) < horizon:
            continue
        checked += 1
        rec = analyze_pr(api, repo, pr, now, opts)
        if rec:
            blocked.append({"number": rec["number"], "ready_at": rec["ready_at"], "reason": rec["reason"]})
    return {
        "prs": [{"number": p["number"], "head_ref": p["head"]["ref"], "draft": bool(p.get("draft"))} for p in prs],
        "blocked": blocked,
    }


def advise(action: str, repo: str, minutes: int, refused: int, branch_pr: Optional[Dict[str, Any]], others: List[int]) -> str:
    """The text Claude reads; empty when there is nothing to say."""
    if action == "push":
        if not branch_pr or branch_pr["draft"]:
            return ""  # no PR, or a draft CodeRabbit skips: a push spends nothing
        return (
            f"CodeRabbit is rate limited on {repo}: {refused} recent pull request(s) were refused, the next included review frees up in about {minutes} min. "
            f"This branch has PR #{branch_pr['number']}, so this push triggers a review that would be refused. "
            f"If more commits are coming, group them and push once. A refused review is re-requested with a comment `@coderabbitai review` after about {minutes} min."
        )
    lines = [
        f"CodeRabbit is rate limited on {repo}: {refused} recent pull request(s) were refused, the next included review frees up in about {minutes} min "
        "(the quota is per developer: one more ready PR now only queues behind them). Before `gh pr create`, pick one:"
    ]
    n = 1
    if others:
        refs = ", ".join(f"#{x}" for x in others)
        lines.append(f"{n}. An open PR already covers this topic ({refs})? Add the commits there and push once instead of opening another.")
        n += 1
    lines.append(
        f"{n}. Open it as a draft (`gh pr create --draft`): CodeRabbit skips drafts by default (reviews.auto_review.drafts, unless the repo's "
        f".coderabbit.yaml turns it on), so no review is spent; mark it ready in about {minutes} min or comment `@coderabbitai review`."
    )
    n += 1
    if minutes <= 15:
        lines.append(f"{n}. Wait about {minutes} min, then open it ready for review.")
    return "\n".join(lines)


def capacity(opts: argparse.Namespace, now: dt.datetime, api: Optional[Api] = None) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION, "state": "unknown", "action": opts.action, "repo": None, "branch": None,
        "minutes_until_review": None, "refused_pull_requests": [], "branch_pr": None,
        "context": "", "cache": "none", "api_calls": 0,
    }
    end = time.monotonic() + opts.deadline   # one budget for git, gh and the API alike

    def left() -> float:
        return min(3.0, end - time.monotonic())

    api = api or Api(deadline=end)
    try:
        if opts.repo and not valid_repo(opts.repo):
            out["error"] = "--repo is not OWNER/NAME"
            return out
        repo = opts.repo or repo_from_remote(git_output(opts.cwd, "remote", "get-url", "origin", timeout=left()) or "")
        out["repo"] = repo
        if not repo:
            out["error"] = "no github.com remote"
            return out
        branch = opts.branch or git_output(opts.cwd, "symbolic-ref", "--short", "HEAD", timeout=left())
        out["branch"] = branch
        path = _cache_path(opts.cache_dir, repo) if opts.cache_dir else None
        sample = _read_cache(path, now, opts.cache_minutes) if path else None
        if sample is not None:
            out["cache"] = "hit"
        else:
            sample = sample_repo(api, repo, now, opts)
            out["cache"] = "miss"
            if path:
                _write_cache(path, sample, now)
        out["api_calls"] = api.calls
        waiting = []
        for rec in sample["blocked"]:
            left = math.ceil((parse_time(rec["ready_at"]) - now).total_seconds() / 60)
            if left > 0:
                waiting.append((left, rec["number"]))
        branch_pr = next(({"number": p["number"], "draft": p["draft"]} for p in sample["prs"] if p["head_ref"] == branch), None)
        out["branch_pr"] = branch_pr
        out["state"] = "limited" if waiting else "available"
        if waiting:
            minutes = min(w[0] for w in waiting)
            others = [p["number"] for p in sample["prs"] if not p["draft"] and p["head_ref"] != branch][:3]
            out["minutes_until_review"] = minutes
            out["refused_pull_requests"] = sorted(w[1] for w in waiting)
            out["context"] = advise(opts.action, repo, minutes, len(waiting), branch_pr, others)
    except Exception as err:  # noqa: BLE001 - a hint never raises
        out["state"] = "unknown"
        out["error"] = f"{type(err).__name__}: {err}"[:200]
        out["context"] = ""
        out["api_calls"] = api.calls
    return out


# --------------------------------------------------------------------------- CLI


def add_policy_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--buffer-minutes", type=int, default=DEFAULT_BUFFER_MINUTES, help="cushion past the announced delay (default %(default)s)")
    p.add_argument("--unknown-wait-minutes", type=int, default=DEFAULT_UNKNOWN_WAIT_MINUTES, help="delay assumed when none is announced (default %(default)s)")
    p.add_argument("--stale-minutes", type=int, default=DEFAULT_STALE_MINUTES, help="a relaunch unanswered after this is lost (default %(default)s)")
    p.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS, help="unanswered relaunches before giving up on a PR (default %(default)s)")
    p.add_argument("--now", help="ISO UTC instant to use as now (tests), e.g. 2026-11-08T10:00:00Z")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("probe", help="print the blocked pull requests as JSON")
    p.add_argument("--repo", action="append", default=[], metavar="OWNER/NAME", help="repository to scan (repeatable)")
    p.add_argument("--owner", action="append", default=[], metavar="OWNER", help="scan every repository of this owner that has an open PR (repeatable)")
    p.add_argument("--exclude", default=DEFAULT_EXCLUDE, help="regex of repositories to skip (default %(default)r; empty keeps all)")
    add_policy_args(p)
    c = sub.add_parser("capacity", help="is CodeRabbit rate limited on this repository, and what to do before the action")
    c.add_argument("--action", choices=("pr_create", "push"), required=True)
    c.add_argument("--cwd", default=".", help="directory whose origin remote and branch are read")
    c.add_argument("--repo", help="OWNER/NAME, instead of the origin remote of --cwd")
    c.add_argument("--branch", help="branch, instead of the one checked out in --cwd")
    c.add_argument("--cache-dir", default="", help="directory of the per-repository cache (none: no cache)")
    c.add_argument("--cache-minutes", type=int, default=DEFAULT_CACHE_MINUTES)
    c.add_argument("--recent", type=int, default=DEFAULT_RECENT, help="open non-draft PRs read per refresh")
    c.add_argument("--window-hours", type=int, default=DEFAULT_WINDOW_HOURS, help="ignore PRs not updated within this")
    c.add_argument("--deadline", type=float, default=DEFAULT_DEADLINE_SECONDS, help="seconds the whole call may take")
    add_policy_args(c)
    r = sub.add_parser("relaunch", help="post the command on the candidates of a probe document")
    r.add_argument("--input", default="-", help="probe JSON file, '-' for stdin (default)")
    r.add_argument("--dry-run", action="store_true", help="re-check and report, post nothing")
    r.add_argument("--delay", type=float, default=5.0, help="seconds between two posts")
    add_policy_args(r)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    opts = build_parser().parse_args(argv)
    now = parse_time(opts.now) if opts.now else dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    if opts.command == "capacity":
        # Fail open by contract: whatever happens, one JSON document and exit 0.
        json.dump(capacity(opts, now), sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    api = Api()
    if opts.command == "probe":
        if not opts.repo and not opts.owner:
            print("probe: give at least one --repo or --owner", file=sys.stderr)
            return 2
        for repo in opts.repo:
            if not valid_repo(repo):
                print(f"probe: '{repo}' is not OWNER/NAME", file=sys.stderr)
                return 2
        doc = probe(api, opts.repo, opts.owner, now, opts)
        json.dump(doc, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        # Total failure (nothing scanned, only errors) is the one non-zero exit.
        return 1 if doc["errors"] and doc["scanned"]["repos"] == 0 else 0
    text = sys.stdin.read() if opts.input == "-" else open(opts.input, encoding="utf-8").read()
    return relaunch(api, json.loads(text), now, opts)


if __name__ == "__main__":
    sys.exit(main())
