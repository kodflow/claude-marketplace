#!/usr/bin/env python3
"""Generate or check the committed migration inventory."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from pluginlib.inventory import build_inventory, canonical_json


ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--write", type=Path)
    group.add_argument("--check", type=Path)
    args = parser.parse_args()
    rendered = canonical_json(build_inventory(ROOT)).encode("utf-8")
    path = args.write or args.check
    if not path.is_absolute():
        path = ROOT / path
    display = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
    if args.check:
        if not path.is_file() or path.read_bytes() != rendered:
            print(f"inventory stale: {display}", file=sys.stderr)
            return 1
        print(f"inventory current: {display}")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(rendered)
    print(f"inventory written: {display}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
