# Running the ADR lint in CI

`adr_lint.py` ships with the kodflow-hooks plugin
(`plugins/kodflow-hooks/hooks/scripts/lib/adr_lint.py`, Python stdlib only). It
checks the header contract of every `docs/adr/NNNN-slug.md`: file name, unique
number, `Status`, ISO `Date`, `Area` (against `docs/adr/areas.txt` when present),
`Need`, and that a `superseded by NNNN` target exists.

`--check <dir|file>` prints one line per defect and exits 0; add `--strict` to
exit 1 on any defect. A repository that has not yet filled `Area` and `Need` in
its old ADRs starts without `--strict`.

## GitHub Actions step

```yaml
      - uses: actions/checkout@v4
      - name: ADR header lint
        run: |
          curl -fsSL -o /tmp/adr_lint.py \
            https://raw.githubusercontent.com/kodflow/claude-marketplace/<sha>/plugins/kodflow-hooks/hooks/scripts/lib/adr_lint.py
          python3 -I /tmp/adr_lint.py --check docs/adr --strict
```

Pin `<sha>` to a marketplace commit. Drop `--strict` to only report.
