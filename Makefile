PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
SCENARIO ?= overflow

.PHONY: check smoke dev

check:
	$(PYTHON) -m unittest discover -s tests/integration -v

smoke:
	$(PYTHON) -m scripts.fixture_server --scenario "$(SCENARIO)" --smoke

dev:
	$(PYTHON) -m scripts.fixture_server --scenario "$(SCENARIO)"
