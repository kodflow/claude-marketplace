#!/usr/bin/env python3
"""Scrub machine- and org-specific detail from files headed for a public repo.

Two jobs, and they are different. `scrub()` rewrites known-private shapes into
neutral equivalents. `scan()` refuses anything that still looks like a live
credential — it is the gate, not the fixer, because a fixer that silently
"handles" an unknown secret shape is how one ships.
"""
import re, sys, pathlib

# Rewrites applied on the way out.
#
# The generic rules below are safe to publish because they name shapes, not
# values. **Organisation-specific values do not belong in a public repository**
# — writing a rule that masks an internal hostname publishes that hostname to
# anyone reading the rule. Those live outside the tree:
#
#   $SANITIZE_EXTRA_RULES            an explicit file, or
#   ~/.config/kodflow-marketplace/private-patterns.tsv
#
# One `pattern<TAB>replacement` per line, `#` for comments. Missing is fine —
# the generic rules still apply, and CI is what proves the result is clean.
SCRUB = [
    (r"/home/[a-z][a-z0-9_-]*(?=/|\b)", "$HOME"),
    (r"/Users/[a-z][a-z0-9_-]*(?=/|\b)", "$HOME"),
    (r"\b(?:192\.168|10\.(?:\d{1,3})|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b",
     "198.51.100.10"),   # RFC 5737 documentation range
]

def _load_private_rules():
    import os
    cands = [os.environ.get("SANITIZE_EXTRA_RULES"),
             os.path.expanduser("~/.config/kodflow-marketplace/private-patterns.tsv")]
    for c in cands:
        if not c: continue
        f = pathlib.Path(c)
        if not f.is_file():
            if c == os.environ.get("SANITIZE_EXTRA_RULES"):
                # Asked for by name and absent: the check the caller wanted is
                # not going to happen. Saying "clean" now would be a lie.
                sys.exit(f"sanitize: SANITIZE_EXTRA_RULES={c!r} does not exist")
            continue
        n = 0
        for line in f.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "\t" not in line: continue
            pat, _, rep = line.partition("\t")
            SCRUB.insert(0, (pat.strip(), rep.strip()))   # private rules win
            n += 1
        return str(f), n
    return None, 0

PRIVATE_SRC, PRIVATE_N = _load_private_rules()

# Live-credential shapes. A match is a hard failure — never auto-fixed.
# The trailing context guards are what stop a detection *regex* in a security
# skill from being mistaken for the secret it detects.
SECRETS = [
    ("GitHub PAT",   r"ghp_[A-Za-z0-9]{36}\b"),
    ("GitHub OAuth", r"gho_[A-Za-z0-9]{36}\b"),
    ("GitLab PAT",   r"glpat-[A-Za-z0-9_\-]{20}\b"),
    ("Anthropic",    r"sk-ant-[A-Za-z0-9_\-]{20,}"),
    ("OpenAI",       r"sk-[A-Za-z0-9]{32,}"),
    ("AWS key",      r"AKIA[0-9A-Z]{16}\b"),
    ("private key",  r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    ("URL creds",    r"://[^/\s:@]+:[^/\s:@]+@"),
]
# There is no "looks like a regex" exemption. A detection *pattern* such as
# `ghp_[A-Za-z0-9]{36}` never matches the credential shape it describes — the
# bracket is not an alphanumeric — so it needs no excuse, and every excuse
# that was tried became a bypass: skipping lines containing "example" hid 10
# of 11 planted credentials; skipping matches followed by regex syntax let
# `TOKEN="<live PAT>" # .*` through. A match is a finding. Full stop.

# A credential whose user or password is itself a placeholder is documentation,
# not a secret. Checked on the matched span rather than the whole line, so a
# real credential sitting next to the word "example" is still caught.
PLACEHOLDER = re.compile(
    r"^(?:"
    r"\{\{[^}]+\}\}"            # {{username}} — templating
    r"|\{[A-Za-z_][A-Za-z0-9_]*\}"  # {PAT} — format interpolation
    r"|<[^>]+>"                   # <user>
    r"|\$\{?[A-Z_][A-Z0-9_]*\}?"  # $VAR / ${VAR}
    r"|user(name)?|pass(word|wd)?|secret|token|oauth2?|changeme|example|xxx+|\*{3,}|REDACTED"
    r")$", re.I)

def _is_placeholder_url(span):
    # span looks like the "://<user>:<pw>@" slice of a URL
    body = span[3:-1]
    if ":" not in body:
        return False
    u, _, pw = body.partition(":")
    # BOTH sides, not either. `https://token:<real PAT>@github.com/...` and
    # `https://oauth2:<real PAT>@gitlab/...` are the canonical clone URLs the
    # forges themselves document — and under an OR the placeholder username
    # excused the live password sitting next to it.
    return bool(PLACEHOLDER.match(u)) and bool(PLACEHOLDER.match(pw))

def scrub(text):
    # Case-insensitive by default. A rule written `\bacme\b` must also catch
    # "Acme" — the capitalised form is how a name appears in prose, which is
    # exactly where it leaks. Getting this wrong published an employer name.
    for pat, rep in SCRUB:
        text = re.sub(pat, rep, text, flags=re.IGNORECASE)
    return text


def scrub_residue(text):
    """Return the rules that match the text AS IT IS — the assertion half.

    An earlier version scrubbed a copy and searched the copy, which proved
    only that the text *could* be cleaned, never that it *was*. The gate asks
    the second question: is a private shape present in what is about to be
    published? `scrub()` is for the export step; this is for the check.
    """
    return [pat for pat, _ in SCRUB if re.search(pat, text, re.IGNORECASE)]

def _hint(match):
    # Enough to find the line, never enough to use: a scanner that prints the
    # credential it found into a CI log has created a second leak.
    return match[:8] + "…" if len(match) > 8 else match

def scan(path, text):
    bad = []
    for i, line in enumerate(text.splitlines(), 1):
        for name, pat in SECRETS:
            # Every match, not the first: an allowed placeholder URL earlier on
            # the line must not excuse a live one after it.
            for m in re.finditer(pat, line):
                if name == "URL creds" and _is_placeholder_url(m.group(0)):
                    continue
                bad.append(f"{path}:{i}: {name}  ->  {_hint(m.group(0))}")
    return bad

if __name__ == "__main__":
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    if not root.is_dir():
        sys.exit(f"sanitize: {root} is not a directory — nothing was scanned")
    findings, residue, unread = [], [], []
    for f in root.rglob("*"):
        if not f.is_file() or ".git/" in str(f): continue
        try: t = f.read_text()
        except UnicodeDecodeError: continue          # binary: not text, not scanned
        except Exception as e: unread.append(f"{f.relative_to(root)}: {e}"); continue
        findings += scan(f.relative_to(root), t)
        if f.name != pathlib.Path(__file__).name:
            for pat in scrub_residue(t):
                residue.append(f"{f.relative_to(root)}: unscrubbed private pattern {pat!r}")
    if findings or residue or unread:
        if findings:
            print("SECRET SCAN FAILED"); [print("  " + x) for x in findings]
        if residue:
            print("PRIVATE-DETAIL SCAN FAILED"); [print("  " + x) for x in residue[:40]]
        if unread:
            print("UNREADABLE — not scanned, so not clean"); [print("  " + x) for x in unread]
        sys.exit(1)
    n = sum(1 for _ in root.rglob("*") if _.is_file())
    extra = f" · {PRIVATE_N} private rules from {PRIVATE_SRC}" if PRIVATE_N else ""
    print(f"secret scan clean ({n} files){extra}")
