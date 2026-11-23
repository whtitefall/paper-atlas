#!/usr/bin/env bash
# Fetch papers for the CI build within a time budget (used by .github/workflows/deploy.yml).
#
# Quick sources (one or a few requests per venue-year) run first, one after another. The others need
# one request per paper and live on different hosts, so they run side by side; each host still gets
# at most one request per second (see common.Http). Whatever is not fetched before the deadline comes
# from the download cache on the next run, so the first full fetch is spread over a few runs.
#
# Usage: bash scripts/ci_fetch.sh [--refresh]
#   FETCH_BUDGET_MIN  minutes before every fetcher is stopped (default 200)
#   SKIP_ARXIV=1      leave arXiv out
set -u
cd "$(dirname "$0")/.."
BUDGET_MIN=${FETCH_BUDGET_MIN:-200}
EXTRA=("$@")
DEADLINE=$(( $(date +%s) + BUDGET_MIN * 60 ))

fetch() {  # one venue, stopped at the deadline
  local left=$(( DEADLINE - $(date +%s) ))
  if (( left <= 60 )); then
    echo "skipped $1: out of time"
    return 0
  fi
  timeout --signal=INT --kill-after=60 "$left" python scripts/fetch.py --venue "$1" ${EXTRA[@]+"${EXTRA[@]}"} \
    || echo "::warning::fetching $1 stopped early or had failures (exit $?)"
}

group() {  # name venue...: fetch the venues in order, prefixing each log line with the name
  local name=$1
  shift
  for v in "$@"; do fetch "$v"; done 2>&1 | sed -u "s/^/[$name] /"
}

for v in acl emnlp naacl icml aaai; do fetch "$v"; done

pids=()
if [[ ${SKIP_ARXIV:-} != 1 ]]; then group arxiv arxiv & pids+=($!); fi
group neurips neurips & pids+=($!)
group iclr iclr & pids+=($!)
group cvf cvpr iccv & pids+=($!)
group eccv eccv & pids+=($!)
group ijcai ijcai & pids+=($!)
wait "${pids[@]}"
exit 0
