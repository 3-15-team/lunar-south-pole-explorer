set minimum-version := "1.59.0"
set dotenv-load
[windows]
set shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]
[unix]
set shell := ["sh", "-eu", "-c"]

default:
    @just --list

# Complete application, including automatic real-data generation (Docker only).
compose-up:
    docker compose up --build --wait --wait-timeout 3600

# Stop the local application; retain downloaded/generated data.
compose-down:
    docker compose down

# Requires images and data from a completed bootstrap; stop normal mode first.
compose-offline:
    docker compose -f compose.yaml -f infra/offline.compose.yaml up --wait --wait-timeout 300

compose-offline-down:
    docker compose -f compose.yaml -f infra/offline.compose.yaml down

compose-offline-smoke:
    docker compose -f compose.yaml -f infra/offline.compose.yaml --profile tools run --rm smoke

compose-logs:
    docker compose logs --follow --tail=100

compose-status:
    docker compose ps --all

# Prepare/resume data without starting the app. Stop runtime before regenerating.
compose-bootstrap:
    docker compose run --build --rm data-init

# Bootstrap honors DATA_TIER and REGION_RES from .env.
alias compose-data-build := compose-bootstrap

# Scientific and frontend checks inside containers; no host language runtimes.
compose-check:
    docker compose --profile tools run --build --rm science python tools/project.py lint
    docker compose --profile tools run --build --rm science
    docker compose --profile tools run --build --rm web-check

# Starts dependencies and checks real HTTP data plus every compute operation.
compose-smoke:
    docker compose --profile tools run --build --rm smoke

# Download/read status without installing Python on the host.
compose-data-status:
    docker compose --profile tools run --build --rm science python -m pipeline.jobs.status

# Optional native frontend workflow (Node required).
setup:
    node tools/native.mjs setup

dev:
    node tools/native.mjs dev

web-dev:
    node tools/native.mjs web-dev

build:
    node tools/native.mjs build

check:
    node tools/native.mjs check

web-preview:
    node tools/native.mjs preview

# Optional native scientific workflow (uv and Node required).
setup-py:
    node tools/native.mjs setup-py

compute-dev:
    node tools/native.mjs compute-dev

test-py:
    node tools/native.mjs test-py

api-smoke:
    node tools/native.mjs api-smoke

lint:
    node tools/native.mjs lint

data-min:
    node tools/native.mjs bootstrap

# Individual job: ephem|tiles|sites|psr|horizon|heatmaps|micro|outer|fetch|pull|status.
data job:
    node tools/native.mjs data "{{ job }}"

validate:
    node tools/native.mjs validate

dist: build
    node tools/native.mjs dist

serve-dist:
    node tools/native.mjs serve-dist

smoke:
    node tools/native.mjs smoke

doctor:
    node tools/native.mjs doctor
