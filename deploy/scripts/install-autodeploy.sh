#!/usr/bin/env bash
# install-autodeploy.sh HOST [PUBKEY_FILE]
#
# Installs deploy/scripts/autodeploy.sh on HOST as /opt/anytools/bin/autodeploy.
# With PUBKEY_FILE it also authorizes that key for root, bound to the script:
#
#   restrict,command="/opt/anytools/bin/autodeploy" ssh-ed25519 AAAA… comment
#
# `restrict` takes away the pty and every kind of forwarding, and the forced
# command ignores whatever the client asks to run (it reaches the script only
# as SSH_ORIGINAL_COMMAND, which the script reads as a commit SHA). So the
# private half, kept in GitHub as DEPLOY_SSH_KEY, can deploy a commit and do
# nothing else. Running it again replaces the script and never adds a key twice.
#
# Run it again after changing autodeploy.sh: the host runs its installed copy,
# not the one in the repository.
set -euo pipefail

host=${1:?usage: install-autodeploy.sh HOST [PUBKEY_FILE]}
pub=${2:-}
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ssh -o BatchMode=yes "$host" 'install -d -m 755 /opt/anytools/bin'
scp -q "$here/autodeploy.sh" "$host:/opt/anytools/bin/autodeploy.new"
ssh -o BatchMode=yes "$host" 'chmod 755 /opt/anytools/bin/autodeploy.new && mv -f /opt/anytools/bin/autodeploy.new /opt/anytools/bin/autodeploy'
echo "installed /opt/anytools/bin/autodeploy on $host"

if [[ -n $pub ]]; then
  key=$(head -1 "$pub")
  [[ $key =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ .*)?$ ]] || { echo "error: $pub is not one ed25519 public key" >&2; exit 2; }
  line="restrict,command=\"/opt/anytools/bin/autodeploy\" $key"
  # The key travels as an argument (base64, so no quoting), never as a file.
  ssh -o BatchMode=yes "$host" "line=\$(echo $(printf '%s' "$line" | base64 | tr -d '\n') | base64 -d)
    install -d -m 700 ~/.ssh; touch ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys
    body=\$(echo \"\$line\" | cut -d' ' -f3)
    if grep -qF \"\$body\" ~/.ssh/authorized_keys; then echo 'key already authorized'; else echo \"\$line\" >> ~/.ssh/authorized_keys; echo 'key authorized for the deploy command only'; fi"
fi
