#!/usr/bin/env bash
# AnyTools — publish this repository's HEAD to the public repository.
#
#   scripts/publish-public.sh "commit message"
#
# The public repository (github.com/D0bby999/anytools) began as one commit
# made by export-public.sh. Later updates keep its history: this exports HEAD
# the same way (the same exclusions, gitleaks and home-path checks), lays that
# tree over a fresh clone of the public repository, and pushes one commit with
# the given message. Nothing from this repository's own history, plans/ or
# .claude/ is pushed.
set -euo pipefail

die() { echo "publish-public: $*" >&2; exit 1; }
[[ $# -eq 1 && -n "$1" ]] || die 'usage: scripts/publish-public.sh "commit message"'
msg=$1
remote=${ANYTOOLS_PUBLIC_REMOTE:-https://github.com/D0bby999/anytools.git}
author=${ANYTOOLS_EXPORT_AUTHOR:-AnyTools contributors <noreply@anytools.world>}
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ -z "$(git -C "$root" status --porcelain)" ]] || die "uncommitted changes; publish a commit"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ANYTOOLS_EXPORT_AUTHOR="$author" "$root/scripts/export-public.sh" "$work/export" >/dev/null
git clone -q "$remote" "$work/public"
rsync -a --delete --exclude=.git "$work/export/" "$work/public/"

g() { git -C "$work/public" "$@"; }
g add -A
if g diff --cached --quiet; then
  echo "publish-public: the public repository already matches $(git -C "$root" rev-parse --short HEAD)"
  exit 0
fi
name=${author% <*}; email=${author##*<}; email=${email%>}
g -c user.name="$name" -c user.email="$email" commit -q -m "$msg"
g push -q origin HEAD:main
echo "published $(git -C "$root" rev-parse --short HEAD) as $(g rev-parse --short HEAD): $(g diff --stat HEAD~1 | tail -1)"
# .github/workflows/deploy.yml takes it from here: Test and Images, then the
# deploy to anytools.world when both pass (docs-only pushes excepted).
slug=${remote#https://github.com/}; slug=${slug%.git}
echo "deploys to anytools.world when Test and Images pass: gh run list -R $slug -w Deploy"
