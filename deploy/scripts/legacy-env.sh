# legacy-env.sh — sourced, not executed. For one release after the rename to
# AnyTools, every LONGPLAY_* variable fills its ANYTOOLS_* twin when the twin
# is unset or empty, so an old .env or .env.local keeps working. The warning
# names the old variables only, never their values.
legacy_names=""
for legacy_name in $(compgen -e | grep '^LONGPLAY_' || true); do
  legacy_twin="ANYTOOLS_${legacy_name#LONGPLAY_}"
  [ -n "${!legacy_twin:-}" ] || export "$legacy_twin=${!legacy_name}"
  legacy_names="$legacy_names $legacy_name"
done
[ -z "$legacy_names" ] || echo "warning: deprecated variables:$legacy_names — rename each to ANYTOOLS_*" >&2
unset legacy_names legacy_name legacy_twin
