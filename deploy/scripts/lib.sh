# Shared by backup.sh and restore.sh. Sourced, not executed.
#
# ANYTOOLS_BACKUP_MODE decides how the database and the data directory are
# reached, and nothing else differs between the two modes:
#   compose (default) — the production stack on the VPS, through `docker compose`;
#   local             — a Postgres DSN and a directory on this machine, which is
#                       what the restore drill on a spare box uses.

set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/legacy-env.sh"

MODE="${ANYTOOLS_BACKUP_MODE:-compose}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

compose() {
  docker compose --project-directory "$REPO_DIR" \
    -f "$REPO_DIR/docker-compose.yml" -f "$REPO_DIR/deploy/docker-compose.prod.yml" "$@"
}

need() { [ -n "${!1:-}" ] || { echo "error: $1 is not set" >&2; exit 2; }; }

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

case "$MODE" in
  compose)
    : "${POSTGRES_USER:=anytools}" "${POSTGRES_DB:=anytools}"
    ;;
  local)
    need ANYTOOLS_POSTGRES_DSN
    need ANYTOOLS_DATA_DIR
    ;;
  *) echo "error: ANYTOOLS_BACKUP_MODE must be compose or local" >&2; exit 2 ;;
esac

# dump_db writes a custom-format pg_dump to stdout.
dump_db() {
  if [ "$MODE" = compose ]; then
    compose exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc
  else
    pg_dump -Fc "$ANYTOOLS_POSTGRES_DSN"
  fi
}

# archive_data writes a gzipped tar of the data directory to stdout. It leaves
# out cache/: copies of files kept in learners' own Drives, which are read
# from Drive again when needed.
archive_data() {
  if [ "$MODE" = compose ]; then
    compose run --rm --no-deps -T --entrypoint tar api -C /var/lib/anytools/data --exclude=./cache -czf - .
  else
    tar -C "$ANYTOOLS_DATA_DIR" --exclude=./cache -czf - .
  fi
}

# restore_db reads a custom-format dump from stdin into the database.
restore_db() {
  if [ "$MODE" = compose ]; then
    compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner
  else
    pg_restore -d "$ANYTOOLS_POSTGRES_DSN" --clean --if-exists --no-owner
  fi
}

# restore_data replaces the data directory's contents with a tar from stdin.
restore_data() {
  if [ "$MODE" = compose ]; then
    compose run --rm --no-deps -T --entrypoint sh api -c \
      'find /var/lib/anytools/data -mindepth 1 -delete && tar -C /var/lib/anytools/data -xzf -'
  else
    mkdir -p "$ANYTOOLS_DATA_DIR"
    find "$ANYTOOLS_DATA_DIR" -mindepth 1 -delete
    tar -C "$ANYTOOLS_DATA_DIR" -xzf -
  fi
}

# verify_restore runs `anytools verify` against what was just restored.
verify_restore() {
  if [ "$MODE" = compose ]; then
    compose run --rm --no-deps api verify
  else
    "${ANYTOOLS_BIN:-anytools}" verify
  fi
}
