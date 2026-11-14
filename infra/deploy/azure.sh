#!/usr/bin/env bash
# Azure stub (Container Apps + Blob + Static Web Apps). Not configured on purpose (ADR-004).
set -euo pipefail
: "${AZ_RG:?set AZ_RG}"; : "${AZ_STORAGE:?set AZ_STORAGE}"; : "${AZ_ENV:?set AZ_ENV}"
echo "Would run (review first):"
cat <<CMD
  az containerapp up -g $AZ_RG --environment $AZ_ENV -n lunar-compute --source . --dockerfile services/compute/Dockerfile --ingress external --target-port 8000
  az storage blob upload-batch --account-name $AZ_STORAGE -d '\$web/data' -s data/web
  VITE_DATA_BASE=https://$AZ_STORAGE.z6.web.core.windows.net/data/ VITE_COMPUTE_BASE=<containerapp-url>/api/ make web-build
  swa deploy apps/web/dist --env production
CMD
