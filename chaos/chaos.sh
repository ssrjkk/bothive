#!/usr/bin/env bash
#
# chaos.sh — Compose-level chaos / E2E suite for the BotHive stack.
#
# Verifies the *real* stack (docker compose) survives and recovers from
# infrastructure faults the same way production is expected to:
#
#   postgres_outage          /health/ready -> 503 while Postgres is down, back
#                            to 200 after it returns.
#   redis_outage             /health/ready -> 503, worker gauges flip to 0 while
#                            Redis is down, then workers come back up after it
#                            returns.
#   worker_hang_detection    a SIGSTOPped worker process is detected as down
#                            (heartbeat TTL) and recovers on SIGCONT.
#   worker_crash_recovery    a SIGKILLed worker process comes back after restart.
#
# Job-requeue / at-least-once semantics are covered at the unit level by
# packages/workers/src/__tests__/base-worker.chaos.test.ts; this harness
# validates infrastructure recovery end-to-end against the running stack.
#
# Usage (from the repo root, with the stack up):
#   BOTHIVE_BASE_URL=http://localhost:3000 METRICS_TOKEN=ci bash chaos/chaos.sh
#   bash chaos/chaos.sh postgres_outage redis_outage   # run specific scenarios
#
# Requirements: curl, a `docker compose` CLI, and a running stack with at least
# postgres, redis, api and workers-telegram (see chaos/README.md).
set -uo pipefail

BASE_URL="${BOTHIVE_BASE_URL:-http://localhost:3000}"
METRICS_TOKEN="${METRICS_TOKEN:-ci}"
COMPOSE="${COMPOSE:-docker compose}"
TIMEOUT="${CHAOS_TIMEOUT:-180}"
INTERVAL=2

FAILED=0
PASSED=0

log() { printf '[chaos] %s\n' "$*"; }
pass() { PASSED=$((PASSED + 1)); printf '[chaos] ok:   %s\n' "$*"; }
fail() { FAILED=$((FAILED + 1)); printf '[chaos] FAIL: %s\n' "$*"; }

# Every fault the scenarios inject targets one of these services; restore them
# on ANY exit path (scenario failure, Ctrl-C, SIGTERM, preflight abort) so a
# stopped/paused stack is never left behind. Each action is a no-op when the
# service is already running/unpaused, so running the cleanup unconditionally
# is safe and idempotent.
cleanup() {
  $COMPOSE start postgres redis workers-telegram >/dev/null 2>&1 || true
  $COMPOSE unpause workers-telegram >/dev/null 2>&1 || true
  log "cleanup: services restored"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
metrics_body() { curl -s --max-time 10 -H "Authorization: Bearer ${METRICS_TOKEN}" "${BASE_URL}/metrics"; }

# wait_until <description> <timeout-seconds> <predicate ...>
wait_until() {
  local desc="$1" timeout="$2"
  shift 2
  local deadline=$(( $(date +%s) + timeout ))
  while :; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    if (( $(date +%s) >= deadline )); then
      log "timed out waiting for: ${desc}"
      return 1
    fi
    sleep "$INTERVAL"
  done
}

# ---- predicates ------------------------------------------------------------
ready_is_200() { [ "$(http_code "${BASE_URL}/health/ready")" = "200" ]; }
ready_is_503() { [ "$(http_code "${BASE_URL}/health/ready")" = "503" ]; }
ready_has() { curl -s --max-time 10 "${BASE_URL}/health/ready" | grep -q "$1"; }

worker_up_is() {
  local platform="$1" expect="$2"
  metrics_body | grep -q "^bothive_worker_up{platform=\"${platform}\"} ${expect}\$"
}

# ---- scenarios -------------------------------------------------------------
scenario_postgres_outage() {
  log "scenario: postgres_outage"
  wait_until "stack ready before fault" 60 ready_is_200 || {
    fail "postgres_outage: stack not ready before fault"
    return 1
  }
  pass "postgres_outage: stack ready before fault"

  $COMPOSE stop postgres >/dev/null 2>&1
  wait_until "ready probe reports 503 while postgres down" "$TIMEOUT" ready_is_503 || {
    fail "postgres_outage: expected 503 while postgres is down"
    $COMPOSE start postgres >/dev/null 2>&1
    return 1
  }
  if ready_has '"database":"unavailable"'; then
    pass "postgres_outage: /health/ready reports database unavailable"
  else
    fail "postgres_outage: /health/ready did not report database unavailable"
  fi

  $COMPOSE start postgres >/dev/null 2>&1
  wait_until "ready probe recovers to 200" "$TIMEOUT" ready_is_200 || {
    fail "postgres_outage: /health/ready did not recover to 200"
    return 1
  }
  pass "postgres_outage: /health/ready recovers to 200"
}

scenario_redis_outage() {
  log "scenario: redis_outage"
  wait_until "stack ready before fault" 60 ready_is_200 || {
    fail "redis_outage: stack not ready before fault"
    return 1
  }
  wait_until "telegram worker up before fault" 60 worker_up_is telegram 1 || {
    fail "redis_outage: telegram worker not up before fault"
    return 1
  }
  pass "redis_outage: worker up before fault"

  $COMPOSE stop redis >/dev/null 2>&1
  wait_until "ready probe reports 503 while redis down" "$TIMEOUT" ready_is_503 || {
    fail "redis_outage: expected 503 while redis is down"
    $COMPOSE start redis >/dev/null 2>&1
    return 1
  }
  if ready_has '"redis":"unavailable"'; then
    pass "redis_outage: /health/ready reports redis unavailable"
  else
    fail "redis_outage: /health/ready did not report redis unavailable"
  fi
  wait_until "worker gauge flips to down while redis down" "$TIMEOUT" worker_up_is telegram 0 || {
    fail "redis_outage: worker_up did not drop to 0 while redis down"
    $COMPOSE start redis >/dev/null 2>&1
    return 1
  }
  pass "redis_outage: worker_up drops to 0 while redis down"

  $COMPOSE start redis >/dev/null 2>&1
  wait_until "ready probe recovers to 200" "$TIMEOUT" ready_is_200 || {
    fail "redis_outage: /health/ready did not recover to 200"
    return 1
  }
  pass "redis_outage: /health/ready recovers to 200"
  wait_until "worker recovers after redis returns" "$TIMEOUT" worker_up_is telegram 1 || {
    fail "redis_outage: worker_up did not return to 1 after redis recovery"
    return 1
  }
  pass "redis_outage: worker_up returns to 1 after redis recovery"
}

scenario_worker_hang_detection() {
  log "scenario: worker_hang_detection"
  wait_until "telegram worker up before fault" 60 worker_up_is telegram 1 || {
    fail "worker_hang: worker not up before fault"
    return 1
  }
  pass "worker_hang: worker up before fault"

  # SIGSTOP freezes the process so it cannot renew its heartbeat; the API must
  # mark it down once the 30s heartbeat TTL expires. Deterministic — no
  # restart-policy race, unlike kill.
  $COMPOSE pause workers-telegram >/dev/null 2>&1
  wait_until "worker gauge flips to down while hung" "$TIMEOUT" worker_up_is telegram 0 || {
    fail "worker_hang: worker_up did not drop to 0 while paused"
    $COMPOSE unpause workers-telegram >/dev/null 2>&1
    return 1
  }
  pass "worker_hang: worker_up drops to 0 while process is hung"

  $COMPOSE unpause workers-telegram >/dev/null 2>&1
  wait_until "worker recovers after unpause" "$TIMEOUT" worker_up_is telegram 1 || {
    fail "worker_hang: worker_up did not recover after unpause"
    return 1
  }
  pass "worker_hang: worker_up returns to 1 after unpause"
}

scenario_worker_crash_recovery() {
  log "scenario: worker_crash_recovery"
  wait_until "telegram worker up before fault" 60 worker_up_is telegram 1 || {
    fail "worker_crash: worker not up before fault"
    return 1
  }
  pass "worker_crash: worker up before fault"

  # SIGKILL simulates a crash. The compose restart policy (unless-stopped) or
  # the explicit start below brings the process back; we assert recovery.
  $COMPOSE kill workers-telegram >/dev/null 2>&1
  sleep 2
  $COMPOSE start workers-telegram >/dev/null 2>&1
  wait_until "worker recovers after restart" "$TIMEOUT" worker_up_is telegram 1 || {
    fail "worker_crash: worker_up did not recover after restart"
    return 1
  }
  pass "worker_crash: worker_up returns to 1 after restart"
  wait_until "stack ready after worker recovery" 60 ready_is_200 || {
    fail "worker_crash: /health/ready not 200 after recovery"
    return 1
  }
  pass "worker_crash: stack ready after recovery"
}

scenario_redis_eviction() {
  log "scenario: redis_eviction"
  wait_until "stack ready before fault" 60 ready_is_200 || {
    fail "redis_eviction: stack not ready before fault"
    return 1
  }
  pass "redis_eviction: stack ready before fault"

  # BullMQ queue metadata keys have no TTL and must survive eviction. Pick one
  # to use as the canary for "non-volatile data must not be lost".
  local queue_key
  queue_key=$($COMPOSE exec -T redis redis-cli --scan --pattern 'bull:*:meta' | head -n 1 | tr -d '\r')
  if [ -z "$queue_key" ]; then
    fail "redis_eviction: no BullMQ queue metadata key found; is a worker running?"
    return 1
  fi
  pass "redis_eviction: queue metadata key ${queue_key}"

  # Create a disposable TTL key. Under volatile-lru it is allowed to disappear.
  $COMPOSE exec -T redis redis-cli SET chaos:ttl:marker "" EX 60 >/dev/null 2>&1
  if ! $COMPOSE exec -T redis redis-cli EXISTS chaos:ttl:marker | grep -q '^1$'; then
    fail "redis_eviction: failed to create TTL marker key"
    return 1
  fi

  # Save the running config and clamp Redis to 1 MB with volatile-lru. This
  # should force eviction of TTL keys while protecting no-TTL queue metadata.
  local orig_maxmemory
  orig_maxmemory=$($COMPOSE exec -T redis redis-cli CONFIG GET maxmemory | tail -n 1 | tr -d '\r')
  $COMPOSE exec -T redis redis-cli CONFIG SET maxmemory 1048576 >/dev/null 2>&1
  $COMPOSE exec -T redis redis-cli CONFIG SET maxmemory-policy volatile-lru >/dev/null 2>&1

  # Flood Redis with TTL filler keys until it exceeds the 1 MB ceiling.
  local i
  for i in $(seq 1 200); do
    $COMPOSE exec -T redis redis-cli SET "chaos:ttl:filler:$i" "$(head -c 20000 /dev/urandom | base64 | head -c 2000)" EX 30 >/dev/null 2>&1
  done

  local marker_exists queue_exists
  marker_exists=$($COMPOSE exec -T redis redis-cli EXISTS chaos:ttl:marker | tr -d '\r')
  queue_exists=$($COMPOSE exec -T redis redis-cli EXISTS "$queue_key" | tr -d '\r')

  # Restore the original limit. Filler keys have TTLs and will expire on their
  # own; the marker is also short-lived, so explicit cleanup is optional.
  $COMPOSE exec -T redis redis-cli CONFIG SET maxmemory "$orig_maxmemory" >/dev/null 2>&1

  if [ "$marker_exists" = "1" ]; then
    fail "redis_eviction: TTL marker was not evicted — volatile-lru did not run"
    return 1
  fi
  pass "redis_eviction: volatile TTL keys were evicted under pressure"

  if [ "$queue_exists" = "0" ]; then
    fail "redis_eviction: non-TTL queue metadata key was evicted — queue jobs are at risk"
    return 1
  fi
  pass "redis_eviction: non-TTL queue metadata survived eviction pressure"
}

# ---- main ------------------------------------------------------------------
summarize() {
  printf '\n==================================================\n'
  printf 'chaos results: %d passed, %d failed\n' "$PASSED" "$FAILED"
  if [ "$FAILED" -eq 0 ]; then
    printf 'status: PASS\n'
  else
    printf 'status: FAIL\n'
  fi
}

main() {
  local -a scenarios
  if [ "$#" -eq 0 ]; then
    scenarios=(postgres_outage redis_outage worker_hang_detection worker_crash_recovery redis_eviction)
  else
    scenarios=("$@")
  fi

  command -v curl >/dev/null 2>&1 || { log "curl is required"; exit 1; }

  log "base url: ${BASE_URL}"
  log "metrics token: $([ -n "$METRICS_TOKEN" ] && printf 'set' || printf 'unset')"

  if ! wait_until "preflight: /health/ready == 200" 120 ready_is_200; then
    fail "preflight: stack is not up (BOTHIVE_BASE_URL=${BASE_URL}); start it first: docker compose up -d postgres redis api workers-telegram"
    summarize
    return 1
  fi
  pass "preflight: stack up and ready"

  local s
  for s in "${scenarios[@]}"; do
    case "$s" in
      postgres_outage) scenario_postgres_outage ;;
      redis_outage) scenario_redis_outage ;;
      worker_hang_detection) scenario_worker_hang_detection ;;
      worker_crash_recovery) scenario_worker_crash_recovery ;;
      redis_eviction) scenario_redis_eviction ;;
      *) fail "unknown scenario: ${s}" ;;
    esac
  done

  summarize
  [ "$FAILED" -eq 0 ]
}

main "$@"
