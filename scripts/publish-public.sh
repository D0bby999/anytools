#!/usr/bin/env bash
# AnyTools — publish this repository's HEAD to the public repository.
#
#   scripts/publish-public.sh "commit message"
#
# It deploys first, then publishes, the way postclaw's pre-push hook deploys
# before the push (GitHub runs no CI or deploys since 2026-10-20): HEAD goes
# to anytools.world through deploy/scripts/deploy-host.sh, and only a good
# deploy is published, so the public repository never runs ahead of the site.
# A HEAD that changes nothing but docs/, plans/, .claude/ or top-level *.md
# since the live commit deploys nothing. SKIP_DEPLOY=1 publishes without
# deploying; ANYTOOLS_DEPLOY_HOST names another host.
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

host=${ANYTOOLS_DEPLOY_HOST:-root@157.180.70.19}
head=$(git -C "$root" rev-parse --short HEAD)
# Does HEAD change anything the site runs, since the commit that is live?
needs_deploy() {
  local live sha
  live=$(ssh -o BatchMode=yes "$host" "sed -n 's/^ANYTOOLS_IMAGE_TAG=//p' /opt/anytools/.env | tail -1") || return 0
  sha=${live#host-}
  [[ $live == host-* ]] && git -C "$root" merge-base --is-ancestor "$sha" HEAD 2>/dev/null || return 0
  git -C "$root" diff --name-only "$sha" HEAD \
    | grep -vE '^(docs|plans|\.claude)/|^[^/]+\.md$' | grep -q .
}
if [[ ${SKIP_DEPLOY:-} == 1 ]]; then
  echo "publish-public: SKIP_DEPLOY=1, publishing without a deploy"
elif needs_deploy; then
  echo "publish-public: deploying $head to $host first"
  "$root/deploy/scripts/deploy-host.sh" "$host" || die "the deploy failed; nothing was published"
else
  echo "publish-public: nothing the site runs changed since the live commit; no deploy"
fi

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
echo "published $head as $(g rev-parse --short HEAD): $(g diff --stat HEAD~1 | tail -1)"
