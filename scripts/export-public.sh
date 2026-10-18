#!/usr/bin/env bash
# AnyTools — export the public repository.
#
#   scripts/export-public.sh DEST [REV]
#
# Writes a fresh git repository at DEST holding ONE commit: the tree tracked at
# REV (default HEAD), minus everything listed in public-exclude.txt beside this
# script. The private repository keeps its full history; the public one starts
# here (anytools-merge, owner decision 2).
#
# It refuses to make the commit when gitleaks finds anything, or when any file
# holds a macOS home path (the Users directory). Every path it rejects is printed, so the
# fix is to clean that file or add it to the exclusion list with a reason.
#
# Needs git and gitleaks on PATH. DEST must not exist, or be an empty directory.
#
# The commit's author is ANYTOOLS_EXPORT_AUTHOR ("Name <email>"), by default
# "AnyTools contributors <noreply@anytools.world>", so the owner's own address
# is not published unless they choose it.
set -euo pipefail

die() { echo "export-public: $*" >&2; exit 1; }

[[ $# -ge 1 && $# -le 2 ]] || die "usage: scripts/export-public.sh DEST [REV]"
dest=$1
rev=${2:-HEAD}

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(git -C "$here" rev-parse --show-toplevel)
exclude_file="$here/public-exclude.txt"

command -v gitleaks >/dev/null || die "gitleaks is not installed (brew install gitleaks)"
[[ -f "$exclude_file" ]] || die "missing $exclude_file"
git -C "$root" rev-parse --verify --quiet "$rev^{commit}" >/dev/null || die "unknown revision $rev"

if [[ -e "$dest" ]]; then
  [[ -d "$dest" && -z "$(ls -A "$dest")" ]] || die "$dest exists and is not an empty directory"
fi
mkdir -p "$dest"
dest=$(cd "$dest" && pwd)

# ---- the tree -------------------------------------------------------------
# git archive carries exactly what is tracked at $rev: nothing untracked,
# ignored, or merely sitting in the working tree.
git -C "$root" archive --format=tar "$rev" | tar -x -C "$dest"

while IFS= read -r line; do
  path=${line%%#*}
  path=${path%"${path##*[![:space:]]}"}
  [[ -z "$path" ]] && continue
  # A pattern that climbs out of the tree, or is absolute, is a typo that
  # could delete something real.
  [[ "$path" == /* || "$path" == *..* ]] && die "bad exclusion: $path"
  rm -rf "${dest:?}/${path%/}"
done <"$exclude_file"

# ---- checks ---------------------------------------------------------------
# Binary files too: a PDF's metadata can carry the path it was made from.
# Spelled in two pieces, so this script is not a hit itself.
home="/Us""ers/"
home_hits=$(cd "$dest" && grep -rla --exclude-dir=.git "$home" . | sed 's#^\./##' | sort || true)
echo "files containing $home: $(printf '%s' "$home_hits" | grep -c . || true)"
if [[ -n "$home_hits" ]]; then
  sed 's/^/  /' <<<"$home_hits" >&2
  die "refusing: the tree holds a macOS home path; no commit was made"
fi

# The repository's own config: the default rules plus the hand-read fixtures.
leaks_cfg=()
[[ -f "$dest/.gitleaks.toml" ]] && leaks_cfg=(--config "$dest/.gitleaks.toml")
if ! (cd "$dest" && gitleaks dir . --no-banner --redact "${leaks_cfg[@]}" --log-level warn); then
  die "refusing: gitleaks found a possible secret in the tree; no commit was made"
fi

# ---- the one commit ---------------------------------------------------------
author=${ANYTOOLS_EXPORT_AUTHOR:-AnyTools contributors <noreply@anytools.world>}
[[ "$author" =~ ^(.+)\ \<([^<>]+)\>$ ]] || die "ANYTOOLS_EXPORT_AUTHOR must look like 'Name <email>'"
export GIT_AUTHOR_NAME=${BASH_REMATCH[1]} GIT_AUTHOR_EMAIL=${BASH_REMATCH[2]}
export GIT_COMMITTER_NAME=$GIT_AUTHOR_NAME GIT_COMMITTER_EMAIL=$GIT_AUTHOR_EMAIL

# The owner's global hooks and signing setup belong to the private repo.
g() { git -C "$dest" -c core.hooksPath=/dev/null -c commit.gpgsign=false "$@"; }
g init -q -b main
# -f: a tracked file that matches .gitignore (say, a fixture named *.out) is
# still part of the tree.
g add -A -f .
g commit -q -m "AnyTools: first public commit"

# The same scan over the history, which is now that one commit.
if ! (cd "$dest" && gitleaks git . --no-banner --redact "${leaks_cfg[@]}" --log-level warn); then
  rm -rf "$dest/.git"
  die "refusing: gitleaks found a possible secret in the commit; the commit was removed"
fi

echo "exported $(g ls-files | wc -l | tr -d ' ') files from $(git -C "$root" rev-parse --short "$rev") to $dest"
echo "commits: $(g rev-list --count HEAD)"
