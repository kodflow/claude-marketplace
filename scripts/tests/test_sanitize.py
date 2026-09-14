#!/usr/bin/env python3
"""Adversarial tests for the secret scanner.

Written after the scanner shipped a leak and then passed 10 of 11 planted
credentials. Both failures were invisible without a test that tries to defeat
it, so this runs in CI: a gate nobody attacks is a gate nobody has measured.
"""
import pathlib, string, subprocess, sys, tempfile

HERE = pathlib.Path(__file__).resolve().parent
SANITIZE = HERE.parent / "sanitize.py"
# Every credential-shaped string is ASSEMBLED, never written as a literal, so
# this file contains no secret shape of its own and needs no scanner exemption.
# An exempted file is a file nobody scans, which is where the next one hides.
_A = string.ascii_letters + string.digits
PAT  = "gh" + "p_" + _A[:36]                       # a real-shaped GitHub PAT
PWD  = "Hunter" + "2Real"                          # a password-shaped literal
AWSK = "AK" + "IA" + "IOSFODNN7EXAMPLE"            # AWS's own documented sample
USER = "ad" + "min"                                # a non-placeholder username

MUST_BLOCK = {
    "bare":            f"GITHUB_TOKEN={PAT}",
    # Each of these words previously disabled detection for its whole line.
    "word-example":    f"GITHUB_TOKEN={PAT} # example",
    "word-scan":       f"the scan job uses {PAT}",
    "word-block":      f"block deploys with {PAT}",
    "word-detect":     f"detect drift using {PAT}",
    "word-pattern":    f"the pattern below uses {PAT}",
    "word-forbidden":  f"forbidden: {PAT}",
    # A documentation curl is the most natural way to write a live token down.
    "curl-header":     f"curl -H 'PRIVATE-TOKEN: {PAT}' https://gitlab.example.com/api",
    # Regex-shaped noise elsewhere on the line must not excuse the match.
    "quantifier":      f"retry {{20}} times with {PAT}",
    "charclass":       f"name must match [a-zA-Z]+ token {PAT}",
    # The forges' own documented clone URLs put a placeholder in the user slot.
    "url-token-user":  f"git clone https://token:{PAT}@github.com/acme/x.git",
    "url-oauth2-user": f"git clone https://oauth2:{PAT}@gitlab.example.com/acme/x.git",
    "url-both-real":   f"psql postgres://{USER}:{PWD}@prod.internal/app",
    "aws":             f"AWS_ACCESS_KEY_ID={AWSK}",
}

# Invariants, not just shapes: each of these was a working bypass once.
MUST_BLOCK.update({
    # a regex-looking comment after a live token is not a pattern definition
    "token-then-regex-comment": f'GITHUB_TOKEN="{PAT}" # .*',
    # the first URL is a placeholder; the second is not, and must still be seen
    # (the live halves are joined at runtime so this file itself carries no credential)
    "second-url-live":  "docs=postgres://user:pass@host/db live=postgres://admin:" + "Hunter2Real@prod.internal/app",
    # punctuation in a password is not evidence of a pattern
    "url-pw-with-dotstar": "DATABASE_URL=postgres://admin:" + "Hunter2.*Real@prod.internal/app",
})

MUST_PASS = {
    # Detection patterns are not secrets; a security skill must be able to ship them.
    "regex-pat":       'SECRETS = [("GitHub PAT", r"ghp_[A-Za-z0-9]{36}\\b")]',
    "regex-key":       '  - "-----BEGIN.*PRIVATE KEY-----"',
    "placeholder-url": "connection: postgres://user:pass@host/db",
    "template-url":    "connection_url=postgresql://{{username}}:{{password}}@db:5432/app",
    "env-url":         "DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@db/app",
}

def blocked(content: str) -> bool:
    with tempfile.TemporaryDirectory() as d:
        (pathlib.Path(d) / "case.txt").write_text(content + "\n")
        return subprocess.run([sys.executable, str(SANITIZE), d],
                              capture_output=True).returncode != 0

def main() -> int:
    fails = []
    for name, c in MUST_BLOCK.items():
        if not blocked(c): fails.append(f"NOT BLOCKED (should be): {name}")
    for name, c in MUST_PASS.items():
        if blocked(c): fails.append(f"BLOCKED (should pass): {name}")

    total = len(MUST_BLOCK) + len(MUST_PASS)
    if fails:
        print(f"sanitize: {len(fails)}/{total} cases wrong")
        for f in fails: print("  " + f)
        return 1
    print(f"sanitize: {total}/{total} cases correct "
          f"({len(MUST_BLOCK)} credentials blocked, {len(MUST_PASS)} patterns allowed)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
