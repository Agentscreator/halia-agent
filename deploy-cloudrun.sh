#!/usr/bin/env bash
#
# deploy-cloudrun.sh — Deploy Halia to Google Cloud Run
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated (gcloud auth login)
#   2. A GCP project with billing enabled
#   3. Your GOOGLE_API_KEY for Gemini
#
# Usage:
#   ./deploy-cloudrun.sh                          # interactive prompts
#   GOOGLE_API_KEY=xxx PROJECT_ID=my-proj ./deploy-cloudrun.sh  # non-interactive
#

set -euo pipefail

# ── Configuration ────────────────────────────────────────────
SERVICE_NAME="${SERVICE_NAME:-halia}"
REGION="${REGION:-us-central1}"
PROJECT_ID="${PROJECT_ID:-}"
GOOGLE_API_KEY="${GOOGLE_API_KEY:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ── Preflight checks ────────────────────────────────────────
if ! command -v gcloud &>/dev/null; then
  echo -e "${RED}gcloud CLI not found.${NC}"
  echo "Install it from https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Resolve project
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
  if [ -z "$PROJECT_ID" ]; then
    echo -e "${YELLOW}No GCP project set.${NC}"
    read -rp "Enter your GCP project ID: " PROJECT_ID
  fi
fi
echo -e "${GREEN}Project:${NC} $PROJECT_ID"

# Resolve API key
if [ -z "$GOOGLE_API_KEY" ]; then
  # Try reading from local .env
  if [ -f .env ]; then
    GOOGLE_API_KEY=$(grep -E '^GOOGLE_API_KEY=' .env | cut -d= -f2- | tr -d '"' || true)
  fi
  if [ -z "$GOOGLE_API_KEY" ]; then
    read -rsp "Enter your GOOGLE_API_KEY: " GOOGLE_API_KEY
    echo
  fi
fi

if [ -z "$GOOGLE_API_KEY" ]; then
  echo -e "${RED}GOOGLE_API_KEY is required.${NC}"
  exit 1
fi

echo -e "${GREEN}Region:${NC}  $REGION"
echo -e "${GREEN}Service:${NC} $SERVICE_NAME"
echo

# ── Enable required APIs ────────────────────────────────────
echo -e "${BOLD}Enabling Cloud Run, Cloud Build, and Artifact Registry APIs...${NC}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  --project="$PROJECT_ID" --quiet

# ── Build and deploy ────────────────────────────────────────
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo
echo -e "${BOLD}Building and pushing container image...${NC}"
gcloud builds submit \
  --project="$PROJECT_ID" \
  --tag="$IMAGE" \
  --timeout=600 \
  --quiet

echo
echo -e "${BOLD}Deploying to Cloud Run...${NC}"
gcloud run deploy "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$IMAGE" \
  --platform=managed \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_API_KEY=${GOOGLE_API_KEY}" \
  --port=8787 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=300 \
  --session-affinity \
  --quiet

# ── Done ────────────────────────────────────────────────────
echo
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="value(status.url)")

echo -e "${GREEN}${BOLD}Deployed!${NC}"
echo
echo -e "  URL: ${BOLD}${SERVICE_URL}${NC}"
echo
echo "Users can open that URL and start talking — no API key needed on their end."
