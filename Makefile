# The mod lanes of kodflow-ktn (kodflow/ktn-linter#788). Every other check of
# this repository is a step of .github/workflows/ci.yml; these are targets so a
# person runs locally exactly what CI runs.
#
# GATES: the targets a blocking job of ci.yml must run as `make <target>`.
# ADVISORY: the workflows that block nothing — never on a push or a pull
# request, never in another workflow's `needs`. `make ci-gates-check` holds
# both, reading the workflows as YAML.

GATES := mod-check
ADVISORY := mod-latest.yml

KTN := plugins/kodflow-ktn

.PHONY: mod-check mod-pure mod-validate mod-engine ci-gates-check mod-lane-check

## mod-check: kodflow-ktn's lanes — the pure modules under node (always a
## verdict), the validator against the committed surface, the engine suite
## behind its precondition (neutral when hooks modules are turned off).
mod-check: mod-pure mod-validate mod-engine

mod-pure:
	node --test $(KTN)/tests/pure/*.spec.ts

mod-validate:
	bash scripts/sync-ktn-fixtures.sh --pin
	python3 scripts/mod-surface.py validate $(KTN) --baseline $(KTN)/tests/fixtures/surface.json

mod-engine:
	bash scripts/mod-lane.sh $(KTN)

## ci-gates-check: GATES run by ci.yml, every `make` target declared,
## ADVISORY out of every needs and off push/pull_request, setup-node by sha.
ci-gates-check:
	python3 scripts/ci-gates-check.py --gates "$(GATES)" --advisory "$(ADVISORY)"

## mod-lane-check: the lane scripts' own tests (fake engine, fake gh).
mod-lane-check:
	bash scripts/tests/test_mod_lane.sh
