PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
SCENARIO ?= overflow

.PHONY: check check-api smoke dev

check:
	$(PYTHON) -m unittest discover -s tests/integration -v

check-api:
	PYTHONPATH=services/incident-api $(PYTHON) -m unittest discover -s services/incident-api/tests -v

smoke:
	$(PYTHON) -m scripts.fixture_server --scenario "$(SCENARIO)" --smoke

dev:
	$(PYTHON) -m scripts.fixture_server --scenario "$(SCENARIO)"
