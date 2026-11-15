# Lunar South Pole Site Explorer — NASA Space Apps 2026
# Fresh clone:         make bootstrap [DATA=min]                  → http://localhost:8642
# Quick start (local):  make setup && make data-min && make dev   → http://localhost:5173
# Primary demo:         make up                                     → http://localhost:8642
# GNU make 3.81 compatible (macOS default).

SHELL          := /bin/bash
ROOT           := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
VENV           ?= $(ROOT)/.venv
PY             ?= $(VENV)/bin/python
PYTHON_BOOT    ?= python3
NPM            ?= npm
WEB            := $(ROOT)/apps/web
DATA_DIR       ?= $(ROOT)/data
DATA_TIER      ?= 1
DATA           ?= full
WEB_PORT       ?= 5173
COMPUTE_PORT   ?= 8000
COMPOSE_PORT   ?= 8642
DEPLOY_TARGET  ?= none
DATA_BASE_URL  ?=
PANO_TERRAIN_INTERP ?= catmull
PANO_RELIEF_AA ?= 1
PANO_MICRO ?= 1
PANO_MICRO_DEFAULT ?=
MAP_EARTH_ANTENNA ?=
COMPOSE        := docker compose -f $(ROOT)/infra/docker-compose.yml --project-directory $(ROOT)
export DATA_DIR COMPUTE_PORT COMPOSE_PORT DATA_BASE_URL PANO_TERRAIN_INTERP PANO_RELIEF_AA PANO_MICRO PANO_MICRO_DEFAULT MAP_EARTH_ANTENNA

.DEFAULT_GOAL := help
.PHONY: bootstrap help setup setup-py setup-web doctor data data-min data-fetch data-build data-ephem data-tiles \
        data-sites data-psr data-horizon data-heatmaps data-micro data-outer data-pull data-status validate dev web-dev \
        compute-dev web-build web-preview up up-ai down logs ps lint typecheck test test-py test-web \
        build smoke verify dist serve-dist deploy clean clean-data

help: ## Show this help
	@echo "Lunar South Pole Site Explorer — make targets"
	@grep -E '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | sed -e 's/:.*## /|/' | \
	  awk -F'|' '{printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------- from an empty machine
bootstrap: ## Fresh clone -> running app: setup, data (DATA=full or min), up, smoke. Done steps are skipped
	$(MAKE) setup
	$(MAKE) $(if $(filter min,$(DATA)),data-min,data)
	$(MAKE) up
	@for i in $$(seq 30); do curl -fsS -o /dev/null http://localhost:$(COMPOSE_PORT)/ && break; sleep 1; done
	$(MAKE) smoke

# ---------------------------------------------------------------- setup
setup: setup-py setup-web ## Install Python venv (.venv) and web dependencies

setup-py: $(VENV)/.installed ## Python venv + pipeline/compute/dev requirements + editable lunarcore

$(VENV)/.installed: requirements-dev.txt pipeline/requirements.txt services/compute/requirements.txt libs/lunarcore/pyproject.toml
	@test -x $(PY) || $(PYTHON_BOOT) -m venv $(VENV)
	$(PY) -m pip install -q -U pip wheel
	$(PY) -m pip install -q -r requirements-dev.txt -e libs/lunarcore
	@touch $@

setup-web: $(WEB)/node_modules/.installed ## npm install for apps/web

$(WEB)/node_modules/.installed: $(WEB)/package-lock.json
	cd $(WEB) && ($(NPM) ci --no-audit --no-fund || $(NPM) install --no-audit --no-fund)
	@touch $@

doctor: ## Check tools, versions, disk, data presence/checksums, ports
	@bash infra/scripts/doctor.sh

# ---------------------------------------------------------------- data (see docs/DATA.md)
data: data-fetch data-build ## Download sources (tier <= DATA_TIER) and build every product

data-min: ## Smallest working set: kernels + 80 m DEM -> ephemeris, tiles, sites, PSR
	$(PY) pipeline/jobs/download.py --tier 0
	$(MAKE) data-ephem data-tiles data-sites data-psr data-micro data-outer

data-fetch: ## Resumable, verified downloads into data/raw (records data/manifest.json)
	$(PY) pipeline/jobs/download.py --tier $(DATA_TIER)

data-build: data-ephem data-tiles data-sites data-psr data-horizon data-heatmaps data-micro data-outer ## Build all products (idempotent)

data-ephem: ## Sun/Earth tables in MOON_ME 2026-2036 -> data/web/ephem
	$(PY) -m pipeline.jobs.ephemeris

data-tiles: ## DEM tile pyramid LPS-2560 -> data/web/dem (+ err)
	$(PY) -m pipeline.jobs.dem_tiles

data-sites: ## Site catalog -> data/web/sites.json
	$(PY) -m pipeline.jobs.sites

data-psr: ## PSR polygons -> data/web/psr.geojson
	$(PY) -m pipeline.jobs.psr

data-horizon: ## Region horizon maps (server-side) -> data/work
	$(PY) -m pipeline.jobs.horizon_maps

data-outer: ## Context Moon outside 80°S for the map: LOLA LDEM_16 -> SPS 2048² (seconds) -> data/web/outer
	$(PY) -m pipeline.jobs.outer_dem

data-micro: ## Statistical micro-relief tiles for the panorama (seconds, deterministic) -> data/web/micro
	$(PY) -m pipeline.jobs.micro_relief

data-heatmaps: ## Pre-baked default suitability heatmaps -> data/web/heatmaps
	$(PY) -m pipeline.jobs.prebake

data-pull: ## Restore processed products from DATA_BASE_URL instead of recomputing
	$(PY) -m pipeline.jobs.pull

data-status: ## Show which data products exist
	@$(PY) -m pipeline.jobs.status

validate: ## Ephemeris vs JPL Horizons + reference illumination maps -> docs/VALIDATION.md
	$(PY) -m pipeline.jobs.validate_horizons
	$(PY) -m pipeline.jobs.validate_reference

# ---------------------------------------------------------------- run locally
dev: ## Web dev server (:5173) + compute API (:8000) together (Ctrl-C stops both)
	@$(MAKE) -j2 web-dev compute-dev

web-dev: ## Vite dev server only (data served from data/web at /data)
	cd $(WEB) && $(NPM) run dev -- --port $(WEB_PORT)

compute-dev: ## FastAPI compute service with reload on :8000
	cd services/compute && $(PY) -m uvicorn app.main:app --reload --port $(COMPUTE_PORT)

web-build: ## Production build of the SPA -> apps/web/dist
	cd $(WEB) && $(NPM) run build

web-preview: web-build ## Preview the production build (:4173)
	cd $(WEB) && $(NPM) run preview

up: ## docker compose up: nginx(web+data) + compute  -> http://localhost:8642
	$(COMPOSE) up -d --build
	@echo "open http://localhost:$(COMPOSE_PORT)"

up-ai: ## Same plus the optional texgen service (profile "ai")
	$(COMPOSE) --profile ai up -d --build

down: ## Stop compose stack
	$(COMPOSE) --profile ai down

logs: ## Follow compose logs
	$(COMPOSE) logs -f --tail=100

ps: ## Compose status
	$(COMPOSE) ps

# ---------------------------------------------------------------- quality
lint: ## ruff + eslint-free TS checks
	$(PY) -m ruff check libs pipeline services
	cd $(WEB) && $(NPM) run lint --if-present

typecheck: ## tsc --noEmit
	cd $(WEB) && $(NPM) run typecheck

test: test-py test-web ## All unit tests

test-py: ## pytest (lunarcore, pipeline, compute)
	$(PY) -m pytest -q libs/lunarcore/tests pipeline/tests services/compute/tests

test-web: ## vitest
	cd $(WEB) && $(NPM) run test

build: web-build ## Build everything that builds

smoke: ## Smoke-test key endpoints of a running stack (BASE_URL, default compose)
	@bash infra/scripts/smoke.sh $${BASE_URL:-http://localhost:$(COMPOSE_PORT)}

verify: ## lint + typecheck + tests + build (+ smoke if the stack is up). Gate for handoff.
	@bash infra/scripts/verify.sh

# ---------------------------------------------------------------- static bundle & deploy
dist: web-build ## Self-contained static site (SPA + data/web) in dist-static/
	@bash infra/scripts/make_dist.sh

serve-dist: ## Serve dist-static/ on :8081 (what any static host would serve)
	cd dist-static && $(PYTHON_BOOT) -m http.server 8081

deploy: ## Deploy: DEPLOY_TARGET=droplet DROPLET=root@<ip> [DOMAIN=…] (make up + Caddy HTTPS); also static, gcp, azure
	@bash infra/deploy/deploy.sh $(DEPLOY_TARGET)

# ---------------------------------------------------------------- housekeeping
clean: ## Remove build outputs (keeps data and deps)
	rm -rf $(WEB)/dist dist-static .pytest_cache .ruff_cache

clean-data: ## Remove generated products (keeps downloads in data/raw)
	rm -rf $(DATA_DIR)/web $(DATA_DIR)/work
