#!/usr/bin/env bash
# Every deploy: push.sh runs this with sudo on the server after copying the code and installing the dependencies.
# Installs the systemd units and the `halfold` command from this copy, restarts the server, and waits until it answers.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
[ "$(id -u)" = 0 ] || { echo "activate: run with sudo" >&2; exit 1; }

install -m 644 "$HERE/halfold.service" "$HERE/halfold-backup.service" "$HERE/halfold-backup.timer" /etc/systemd/system/
install -m 755 "$HERE/halfold" /usr/local/bin/halfold
systemctl daemon-reload
systemctl enable --quiet halfold halfold-backup.timer
systemctl start halfold-backup.timer
systemctl restart halfold

for _ in $(seq 30); do
  if curl -fs -o /dev/null http://127.0.0.1:8787/; then
    echo "halfold: running $(cat /srv/halfold/REVISION 2>/dev/null)"
    exit 0
  fi
  sleep 1
done
echo "halfold: not answering on 127.0.0.1:8787 after 30 seconds. The last lines of its log:" >&2
journalctl -u halfold -n 30 --no-pager >&2
exit 1
