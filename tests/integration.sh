#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

pass() { ((PASS++)); echo -e "${GREEN}  PASS${NC} $1"; }
fail() { ((FAIL++)); echo -e "${RED}  FAIL${NC} $1: $2"; }

wait_for() {
  local url=$1 name=$2 retries=${3:-30} delay=${4:-2}
  echo -e "${YELLOW}Waiting for ${name}...${NC}"
  for i in $(seq 1 "$retries"); do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo -e "${GREEN}  ${name} is up${NC}"
      return 0
    fi
    sleep "$delay"
  done
  echo -e "${RED}  ${name} did not start in time${NC}"
  return 1
}

API_URL=${API_URL:-http://localhost:3001}
CLUSTERER_URL=${CLUSTERER_URL:-http://localhost:8101}
WEB_URL=${WEB_URL:-http://localhost:3000}

echo ""
echo "=================================="
echo " Körkép Integration Tests"
echo "=================================="
echo ""

# Health checks
echo "--- Health Checks ---"

if wait_for "$API_URL/health" "API" 30 2; then
  resp=$(curl -sf "$API_URL/health")
  if echo "$resp" | grep -q '"ok"'; then
    pass "API health returns ok"
  else
    fail "API health" "unexpected response: $resp"
  fi
else
  fail "API health" "service not reachable"
fi

if wait_for "$CLUSTERER_URL/health" "Clusterer" 30 2; then
  resp=$(curl -sf "$CLUSTERER_URL/health")
  if echo "$resp" | grep -q '"ok"'; then
    pass "Clusterer health returns ok"
  else
    fail "Clusterer health" "unexpected response: $resp"
  fi
else
  fail "Clusterer health" "service not reachable"
fi

# API endpoint tests
echo ""
echo "--- API Endpoints ---"

resp=$(curl -sf "$API_URL/api/stories" || echo "ERROR")
if [ "$resp" != "ERROR" ]; then
  if echo "$resp" | grep -q '"data"'; then
    pass "GET /api/stories returns data array"
  else
    fail "GET /api/stories" "missing data field"
  fi
  if echo "$resp" | grep -q '"pagination"'; then
    pass "GET /api/stories returns pagination"
  else
    fail "GET /api/stories" "missing pagination field"
  fi
else
  fail "GET /api/stories" "request failed"
fi

resp=$(curl -sf "$API_URL/api/stories?page=1&limit=5" || echo "ERROR")
if [ "$resp" != "ERROR" ]; then
  pass "GET /api/stories with query params"
else
  fail "GET /api/stories with query params" "request failed"
fi

resp=$(curl -sf "$API_URL/api/sources" || echo "ERROR")
if [ "$resp" != "ERROR" ]; then
  if echo "$resp" | grep -q '"data"'; then
    pass "GET /api/sources returns data"
  else
    fail "GET /api/sources" "missing data field"
  fi
else
  fail "GET /api/sources" "request failed"
fi

code=$(curl -so /dev/null -w '%{http_code}' "$API_URL/api/stories/999999")
if [ "$code" = "404" ]; then
  pass "GET /api/stories/:id returns 404 for missing"
else
  fail "GET /api/stories/:id" "expected 404, got $code"
fi

code=$(curl -so /dev/null -w '%{http_code}' "$API_URL/api/search")
if [ "$code" = "400" ]; then
  pass "GET /api/search without query returns 400"
else
  fail "GET /api/search" "expected 400, got $code"
fi

resp=$(curl -sf "$API_URL/api/search?q=test" || echo "ERROR")
if [ "$resp" != "ERROR" ]; then
  if echo "$resp" | grep -q '"data"'; then
    pass "GET /api/search with query returns data"
  else
    fail "GET /api/search" "missing data field"
  fi
else
  fail "GET /api/search" "request failed"
fi

# Clusterer tests
echo ""
echo "--- Clusterer Endpoints ---"

resp=$(curl -sf "$CLUSTERER_URL/health" || echo "ERROR")
if [ "$resp" != "ERROR" ]; then
  if echo "$resp" | grep -q '"ok"'; then
    pass "Clusterer /health returns ok"
  else
    fail "Clusterer /health" "unexpected response: $resp"
  fi
else
  fail "Clusterer /health" "request failed"
fi

# Web app test
echo ""
echo "--- Web App ---"

code=$(curl -so /dev/null -w '%{http_code}' "$WEB_URL" 2>/dev/null)
if [ "$code" = "200" ]; then
  pass "Web app serves homepage (HTTP 200)"
else
  fail "Web app homepage" "expected 200, got $code"
fi

# Summary
echo ""
echo "=================================="
echo -e " Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}"
echo "=================================="
echo ""

[ "$FAIL" -eq 0 ]
