#!/usr/bin/env bash
# Deploys the committed code (HEAD) to the server. Run on your own computer, anywhere in the repository:
#
#   deploy/server/push.sh ubuntu@203.0.113.7 --setup halfold.example.com   the first time (installs everything)
#   deploy/server/push.sh ubuntu@203.0.113.7                                after that: new code, restart
#
# Copies HEAD to /srv/halfold (never touching server/data there), runs setup.sh with --setup, installs the
# server's dependencies when package-lock.json changed, then activate.sh (systemd units, restart, wait until it answers).
# Uncommitted changes are not deployed. Another port or key: put the server in ~/.ssh/config, or SSH="ssh -p 2222".
set -euo pipefail

usage() { echo "usage: push.sh <user@server> [--setup <domain>]" >&2; exit 1; }
TARGET=${1:-}; [ -n "$TARGET" ] || usage; shift
DOMAIN=
case "${1:-}" in
  "") ;;
  --setup) DOMAIN=${2:-}; [ -n "$DOMAIN" ] || usage ;;
  *) usage ;;
esac
SSH=${SSH:-ssh}

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "push: you have uncommitted changes; they are not deployed (only commit $(git rev-parse --short HEAD) is)" >&2
fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
chmod 755 "$TMP"   # rsync gives /srv/halfold this folder's mode; mktemp's 700 would lock the server out of its code
git archive HEAD | tar -x -C "$TMP"
[ -f "$TMP/dist/index.html" ] || { echo "push: dist/ is not in this commit: npm run build, then commit dist/" >&2; exit 1; }
[ -f "$TMP/deploy/server/activate.sh" ] || { echo "push: deploy/server/ is not in this commit yet: commit it first" >&2; exit 1; }
echo "$(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD), $(git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M'))" > "$TMP/REVISION"

echo "== copying $(cat "$TMP/REVISION") to $TARGET:/srv/halfold"
$SSH "$TARGET" 'set -e
  command -v rsync >/dev/null || { sudo apt-get update -q >/dev/null && sudo apt-get install -y -q rsync >/dev/null; }
  sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 755 /srv/halfold'
rsync -az --delete -e "$SSH" \
  --exclude=/server/data/ --exclude=/server/node_modules/ --exclude=/node_modules/ \
  "$TMP/" "$TARGET:/srv/halfold/"

if [ -n "$DOMAIN" ]; then
  echo "== setting up the server for https://$DOMAIN"
  $SSH -t "$TARGET" "sudo bash /srv/halfold/deploy/server/setup.sh '$DOMAIN'"
fi

echo "== dependencies"
$SSH "$TARGET" 'set -e
  command -v npm >/dev/null || { echo "push: no Node.js on the server yet: run push.sh with --setup <domain> first" >&2; exit 1; }
  cd /srv/halfold/server
  sum=$(sha256sum package-lock.json | cut -d" " -f1)
  if [ "$(cat node_modules/.lock-sum 2>/dev/null)" = "$sum" ]; then echo "unchanged"
  else npm ci --no-audit --no-fund --loglevel=error && echo "$sum" > node_modules/.lock-sum; fi'

echo "== restarting"
$SSH -t "$TARGET" 'sudo bash /srv/halfold/deploy/server/activate.sh'
