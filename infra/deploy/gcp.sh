#!/usr/bin/env bash
# GCP stub (Cloud Run + GCS + Firebase Hosting). Not configured on purpose (ADR-004).
# To enable: install gcloud/firebase, log in yourself, set budget alerts, then fill:
set -euo pipefail
: "${GCP_PROJECT:?set GCP_PROJECT}"; : "${GCP_REGION:=europe-west1}"; : "${GCS_BUCKET:?set GCS_BUCKET}"
echo "Would run (review first):"
cat <<CMD
  gcloud builds submit --project $GCP_PROJECT --tag gcr.io/$GCP_PROJECT/lunar-compute -f services/compute/Dockerfile .
  gcloud run deploy lunar-compute --project $GCP_PROJECT --region $GCP_REGION --image gcr.io/$GCP_PROJECT/lunar-compute --allow-unauthenticated --memory 2Gi
  gsutil -m rsync -r data/web gs://$GCS_BUCKET/data && gsutil iam ch allUsers:objectViewer gs://$GCS_BUCKET
  VITE_DATA_BASE=https://storage.googleapis.com/$GCS_BUCKET/data/ VITE_COMPUTE_BASE=<cloud-run-url>/api/ make web-build
  firebase deploy --only hosting   # public dir: apps/web/dist
CMD
echo "Remove the 'echo' wrapper above once the variables are verified."
