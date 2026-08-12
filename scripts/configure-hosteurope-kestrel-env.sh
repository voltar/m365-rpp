#!/usr/bin/env bash
# =============================================================================
# configure-hosteurope-kestrel-env.sh
# =============================================================================
# Merges Entra / API settings into the per-instance kestrel.env used by the
# Host Europe systemd template unit:
#
#   /etc/systemd/system/kestrel-rpp@.service
#     EnvironmentFile=/var/www/vhosts/example.com/apps/%i/kestrel.env
#     WorkingDirectory=/var/www/vhosts/example.com/apps/%i
#
# Instance example: rpp-organisation-a  →  .../apps/rpp-organisation-a/kestrel.env
#                   service   →  kestrel-rpp@rpp-organisation-a
#
# Design rules:
#   - Never commits secrets; ClientSecret is only written on the server.
#   - Merges keys into an existing kestrel.env (keeps ConnectionStrings, etc.).
#   - Public identifiers default to the Voltar profile (rpp-config-example).
#
# Run ON the Host Europe server (SSH), typically as root/sudo.
#
# Usage:
#   sudo ./scripts/configure-hosteurope-kestrel-env.sh --instance rpp-organisation-a --show
#   sudo ./scripts/configure-hosteurope-kestrel-env.sh --instance rpp-organisation-a \
#        --client-secret '***' --restart --verify
#   sudo RPP_CLIENT_SECRET='***' ./scripts/configure-hosteurope-kestrel-env.sh \
#        --instance rpp-organisation-a --restart --verify
#
#   # dry-run (print planned keys, no write):
#   sudo ./scripts/configure-hosteurope-kestrel-env.sh --instance rpp-organisation-a \
#        --client-secret '***' --dry-run
# =============================================================================

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

# Defaults aligned with scripts/rpp-config-example.psd1 (public identifiers only).
DEFAULT_INSTANCE="rpp-organisation-a"
DEFAULT_APPS_ROOT="/var/www/vhosts/example.com/apps"
DEFAULT_TENANT_ID="00000000-0000-0000-0000-000000000001"
DEFAULT_CLIENT_ID="00000000-0000-0000-0000-000000000003"
DEFAULT_API_DOMAIN="rpp.example.com"
DEFAULT_PUBLIC_ORIGIN="https://rpp.example.com"
DEFAULT_UNIT_PREFIX="kestrel-rpp"

INSTANCE="$DEFAULT_INSTANCE"
APPS_ROOT="$DEFAULT_APPS_ROOT"
TENANT_ID="$DEFAULT_TENANT_ID"
CLIENT_ID="$DEFAULT_CLIENT_ID"
API_DOMAIN="$DEFAULT_API_DOMAIN"
PUBLIC_ORIGIN="$DEFAULT_PUBLIC_ORIGIN"
CLIENT_SECRET="${RPP_CLIENT_SECRET:-}"
ENV_FILE=""
DO_SHOW=0
DO_DRY_RUN=0
DO_RESTART=0
DO_VERIFY=0
DO_WRITE=1
PROMPT_SECRET=0

usage() {
  cat <<EOF
Usage: sudo $SCRIPT_NAME [options]

  --instance NAME          systemd instance / app folder (default: $DEFAULT_INSTANCE)
  --apps-root PATH         parent of instance folders (default: $DEFAULT_APPS_ROOT)
  --env-file PATH          explicit kestrel.env path (overrides instance layout)
  --tenant-id GUID         Entra tenant id (default: Voltar tenant)
  --client-id GUID         Entra app client id (default: RPP Example app)
  --api-domain HOST        host part of Application ID URI (default: $DEFAULT_API_DOMAIN)
  --public-origin URL      CORS origin (default: $DEFAULT_PUBLIC_ORIGIN)
  --client-secret VALUE    Entra client secret (or set RPP_CLIENT_SECRET)
  --prompt-secret          read client secret from TTY (hidden)
  --show                   print current kestrel.env with secrets redacted
  --dry-run                show planned AzureAd keys; do not write
  --restart                systemctl restart kestrel-rpp@INSTANCE after write
  --verify                 curl /health and anonymous /api/planning/absences
  --help                   this help

Examples:
  sudo $SCRIPT_NAME --instance rpp-organisation-a --show
  sudo $SCRIPT_NAME --instance rpp-organisation-a --prompt-secret --restart --verify
EOF
}

log()  { printf '%s\n' "$*"; }
err()  { printf 'ERROR: %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "Run as root (sudo). Needed to write kestrel.env and restart systemd."
  fi
}

redact_line() {
  # KEY=value → mask secret-like keys
  local line="$1"
  if [[ "$line" =~ ^(AzureAd__ClientSecret|ConnectionStrings__DefaultConnection|ApprovalFlow__CallbackSecret)= ]]; then
    printf '%s=***\n' "${line%%=*}"
  else
    printf '%s\n' "$line"
  fi
}

show_env_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    die "Env file not found: $file"
  fi
  log "=== $file (secrets redacted) ==="
  # strip comments/blank for readability but keep order
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    redact_line "$line"
  done <"$file"
}

# Set or replace KEY=value in a file; preserves other keys and comments.
upsert_env_key() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"

  if [[ -f "$file" ]]; then
    # drop existing key lines (exact key=)
    grep -v -E "^${key}=" "$file" >"$tmp" || true
  else
    : >"$tmp"
  fi

  # ensure trailing newline before append
  if [[ -s "$tmp" ]] && [[ -n "$(tail -c 1 "$tmp" || true)" ]]; then
    printf '\n' >>"$tmp"
  fi

  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  mv "$tmp" "$file"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --instance)      INSTANCE="${2:-}"; shift 2 ;;
      --apps-root)     APPS_ROOT="${2:-}"; shift 2 ;;
      --env-file)      ENV_FILE="${2:-}"; shift 2 ;;
      --tenant-id)     TENANT_ID="${2:-}"; shift 2 ;;
      --client-id)     CLIENT_ID="${2:-}"; shift 2 ;;
      --api-domain)    API_DOMAIN="${2:-}"; shift 2 ;;
      --public-origin) PUBLIC_ORIGIN="${2:-}"; shift 2 ;;
      --client-secret) CLIENT_SECRET="${2:-}"; shift 2 ;;
      --prompt-secret) PROMPT_SECRET=1; shift ;;
      --show)          DO_SHOW=1; DO_WRITE=0; shift ;;
      --dry-run)       DO_DRY_RUN=1; shift ;;
      --restart)       DO_RESTART=1; shift ;;
      --verify)        DO_VERIFY=1; shift ;;
      --help|-h)       usage; exit 0 ;;
      *)               die "Unknown option: $1 (try --help)" ;;
    esac
  done
}

resolve_paths() {
  if [[ -z "$ENV_FILE" ]]; then
    ENV_FILE="${APPS_ROOT}/${INSTANCE}/kestrel.env"
  fi
  APP_DIR="$(dirname "$ENV_FILE")"
  UNIT="${DEFAULT_UNIT_PREFIX}@${INSTANCE}"
  AUDIENCE="api://${API_DOMAIN}/${CLIENT_ID}"
}

print_plan() {
  log "Instance     : $INSTANCE"
  log "Unit         : $UNIT"
  log "App dir      : $APP_DIR"
  log "Env file     : $ENV_FILE"
  log "TenantId     : $TENANT_ID"
  log "ClientId     : $CLIENT_ID"
  log "Audience     : $AUDIENCE"
  log "CORS origin  : $PUBLIC_ORIGIN"
  if [[ -n "$CLIENT_SECRET" ]]; then
    log "ClientSecret : *** (provided)"
  else
    log "ClientSecret : (not provided — existing value kept if present)"
  fi
  log ""
}

write_env() {
  if [[ ! -d "$APP_DIR" ]]; then
    die "App directory does not exist: $APP_DIR
Create/deploy the app first, or pass --apps-root / --env-file."
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    log "Creating new env file: $ENV_FILE"
    umask 077
    : >"$ENV_FILE"
  fi

  # Backup before mutate
  local bak="${ENV_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$ENV_FILE" "$bak"
  log "Backup       : $bak"

  upsert_env_key "$ENV_FILE" "AzureAd__TenantId" "$TENANT_ID"
  upsert_env_key "$ENV_FILE" "AzureAd__ClientId" "$CLIENT_ID"
  upsert_env_key "$ENV_FILE" "AzureAd__Audience" "$AUDIENCE"
  upsert_env_key "$ENV_FILE" "ApiSettings__AllowedOrigins__0" "$PUBLIC_ORIGIN"
  upsert_env_key "$ENV_FILE" "ApiSettings__RequireAuthentication" "true"

  if [[ -n "$CLIENT_SECRET" ]]; then
    upsert_env_key "$ENV_FILE" "AzureAd__ClientSecret" "$CLIENT_SECRET"
  elif ! grep -q -E '^AzureAd__ClientSecret=.' "$ENV_FILE" 2>/dev/null; then
    err "AzureAd__ClientSecret is missing. Pass --client-secret, --prompt-secret, or RPP_CLIENT_SECRET."
    err "Other keys were still written. Add the secret and re-run --restart."
  fi

  chmod 600 "$ENV_FILE"
  log "Updated      : $ENV_FILE"
  log ""
  show_env_file "$ENV_FILE"
}

restart_unit() {
  if ! systemctl cat "$UNIT" &>/dev/null; then
    die "systemd unit not found: $UNIT"
  fi
  log "Restarting $UNIT ..."
  systemctl restart "$UNIT"
  systemctl --no-pager --full status "$UNIT" || true
}

verify_http() {
  local origin="$PUBLIC_ORIGIN"
  log ""
  log "=== verify ${origin} ==="
  local health_code abs_code
  health_code="$(curl -sS -o /tmp/rpp-health.json -w '%{http_code}' "${origin}/health" || true)"
  abs_code="$(curl -sS -o /dev/null -w '%{http_code}' "${origin}/api/planning/absences" || true)"

  log "GET /health                  → HTTP $health_code (expect 200)"
  if [[ -f /tmp/rpp-health.json ]]; then
    # compact one-line if jq missing
    if command -v jq &>/dev/null; then
      jq -c '{status,version,environment,planningStore,databaseName,backendProvider}' /tmp/rpp-health.json || cat /tmp/rpp-health.json
    else
      cat /tmp/rpp-health.json
      log ""
    fi
  fi
  log "GET /api/planning/absences   → HTTP $abs_code (expect 401 = auth on)"

  if [[ "$health_code" != "200" ]]; then
    err "Health check failed. See: journalctl -u $UNIT -n 80 --no-pager"
    return 1
  fi
  if [[ "$abs_code" != "401" ]]; then
    err "Expected 401 on anonymous planning call (got $abs_code). Check RequireAuthentication and AzureAd settings."
    return 1
  fi
  log "Verify OK."
}

main() {
  parse_args "$@"
  resolve_paths

  if [[ "$DO_SHOW" -eq 1 ]]; then
    require_root
    show_env_file "$ENV_FILE"
    exit 0
  fi

  if [[ "$PROMPT_SECRET" -eq 1 ]]; then
    if [[ ! -t 0 ]]; then
      die "--prompt-secret requires an interactive TTY"
    fi
    read -r -s -p "Entra client secret (input hidden): " CLIENT_SECRET
    printf '\n'
    [[ -n "$CLIENT_SECRET" ]] || die "Empty secret"
  fi

  print_plan

  if [[ "$DO_DRY_RUN" -eq 1 ]]; then
    log "Dry-run only — no file changes, no restart."
    log "Would upsert:"
    log "  AzureAd__TenantId=$TENANT_ID"
    log "  AzureAd__ClientId=$CLIENT_ID"
    log "  AzureAd__Audience=$AUDIENCE"
    log "  ApiSettings__AllowedOrigins__0=$PUBLIC_ORIGIN"
    log "  ApiSettings__RequireAuthentication=true"
    if [[ -n "$CLIENT_SECRET" ]]; then
      log "  AzureAd__ClientSecret=***"
    fi
    exit 0
  fi

  if [[ "$DO_WRITE" -eq 1 ]]; then
    require_root
    write_env
  fi

  if [[ "$DO_RESTART" -eq 1 ]]; then
    require_root
    restart_unit
  fi

  if [[ "$DO_VERIFY" -eq 1 ]]; then
    verify_http
  fi
}

main "$@"
