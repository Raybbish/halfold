#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 server for Halfold. `push.sh <user@server> --setup <domain>` runs it after
# copying the code to /srv/halfold; by hand: sudo bash /srv/halfold/deploy/server/setup.sh <domain>
# Safe to run again: what is already installed is left alone, the Caddyfile is rewritten for the domain given.
#
# Installs: ffmpeg, sqlite3, rclone, Caddy (its own apt repository), Node.js 22 (nodejs.org, checksum verified),
# yt-dlp and deno (GitHub releases, checksums verified), a 2 GB swap file when there is none.
# Creates: the user halfold that runs the server, /srv/halfold/server/data, /var/backups/halfold,
# /etc/halfold/halfold.env (the server's settings, from server/.env.example with your domain), /etc/halfold/backup.env.
set -euo pipefail

DOMAIN=${1:-}
APP=/srv/halfold
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
step() { printf '\n== %s\n' "$*"; }
die() { echo "setup: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run with sudo"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "usage: setup.sh <domain>, e.g. setup.sh halfold.example.com"
[ -f "$APP/server/package.json" ] || die "no code in $APP yet: run push.sh from your computer, it copies the code first"
. /etc/os-release
[ "$ID $VERSION_ID" = "ubuntu 24.04" ] || echo "setup: written for Ubuntu 24.04; this is $PRETTY_NAME, going on" >&2

case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64;   YTDLP_FILE=yt-dlp_linux;         DENO_ZIP=deno-x86_64-unknown-linux-gnu.zip ;;
  arm64) NODE_ARCH=arm64; YTDLP_FILE=yt-dlp_linux_aarch64; DENO_ZIP=deno-aarch64-unknown-linux-gnu.zip ;;
  *) die "unsupported architecture $(dpkg --print-architecture)" ;;
esac
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

step "packages: ffmpeg, sqlite3, rclone, Caddy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
# tzdata: the backup timer runs at 04:30 Asia/Hong_Kong; minimal images leave it out.
apt-get install -y -q --no-install-recommends ca-certificates curl gnupg unzip xz-utils ffmpeg sqlite3 rclone cron tzdata
if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
  # Caddy's own repository (caddyserver.com/docs/install): Ubuntu's caddy package is years behind.
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
fi
apt-get install -y -q caddy

step "Node.js 22"
if node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' 2>/dev/null; then
  echo "already there: node $(node --version)"
else
  base=https://nodejs.org/dist/latest-v22.x
  curl -fsSL -o "$TMP/SHASUMS256.txt" "$base/SHASUMS256.txt"
  file=$(awk -v f="linux-$NODE_ARCH.tar.xz" 'substr($2, length($2) - length(f) + 1) == f { print $2 }' "$TMP/SHASUMS256.txt")
  [ -n "$file" ] || die "no linux-$NODE_ARCH build in $base"
  curl -fsSL -o "$TMP/$file" "$base/$file"
  (cd "$TMP" && grep "  $file\$" SHASUMS256.txt | sha256sum -c --quiet -)
  tar -xJf "$TMP/$file" -C /usr/local --strip-components=1 --no-same-owner --exclude='*.md' --exclude=LICENSE
  echo "installed node $(/usr/local/bin/node --version)"
fi

step "yt-dlp and deno (video links)"
if [ -x /usr/local/bin/yt-dlp ]; then
  echo "already there: yt-dlp $(/usr/local/bin/yt-dlp --version) (updated daily by /etc/cron.daily/yt-dlp-update)"
else
  rel=https://github.com/yt-dlp/yt-dlp/releases/latest/download
  curl -fsSL -o "$TMP/$YTDLP_FILE" "$rel/$YTDLP_FILE"
  curl -fsSL -o "$TMP/SHA2-256SUMS" "$rel/SHA2-256SUMS"
  (cd "$TMP" && grep " $YTDLP_FILE\$" SHA2-256SUMS | sha256sum -c --quiet -)
  install -m 755 "$TMP/$YTDLP_FILE" /usr/local/bin/yt-dlp
  echo "installed yt-dlp $(/usr/local/bin/yt-dlp --version)"
fi
# yt-dlp goes out of date when video sites change; the official binary updates itself.
cat > /etc/cron.daily/yt-dlp-update <<'EOF'
#!/bin/sh
/usr/local/bin/yt-dlp -U 2>&1 | logger -t yt-dlp-update
EOF
chmod 755 /etc/cron.daily/yt-dlp-update
if [ -x /usr/local/bin/deno ]; then
  echo "already there: $(/usr/local/bin/deno --version | head -1)"
else
  # yt-dlp runs YouTube's player code with deno.
  rel=https://github.com/denoland/deno/releases/latest/download
  curl -fsSL -o "$TMP/$DENO_ZIP" "$rel/$DENO_ZIP"
  curl -fsSL -o "$TMP/$DENO_ZIP.sha256sum" "$rel/$DENO_ZIP.sha256sum"
  (cd "$TMP" && sha256sum -c --quiet "$DENO_ZIP.sha256sum")
  unzip -o -q "$TMP/$DENO_ZIP" -d "$TMP" && install -m 755 "$TMP/deno" /usr/local/bin/deno
  echo "installed $(/usr/local/bin/deno --version | head -1)"
fi

step "swap"
if [ -n "$(swapon --noheadings)" ]; then
  echo "already there: $(swapon --noheadings --show=NAME,SIZE | tr -s ' ' | paste -sd ',')"
elif fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "added a 2 GB swap file"
else
  rm -f /swapfile
  echo "this machine does not allow a swap file; going on without one"
fi

step "the halfold user and its folders"
id halfold >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin halfold
install -d -o halfold -g halfold -m 750 "$APP/server/data" /var/backups/halfold
install -d -o root -g halfold -m 750 /etc/halfold

step "settings"
# The server's settings live outside the code folder, which push.sh replaces on every deploy.
if [ -f /etc/halfold/halfold.env ]; then
  echo "kept /etc/halfold/halfold.env"
else
  { cat "$APP/server/.env.example"
    printf '\n# --- set by deploy/server/setup.sh ---\nPUBLIC_URL=https://%s\nWEB_URL=https://%s\n' "$DOMAIN" "$DOMAIN"
  } > /etc/halfold/halfold.env
  echo "wrote /etc/halfold/halfold.env (server/.env.example with your domain): fill in the keys with: halfold env"
fi
chown root:halfold /etc/halfold/halfold.env && chmod 640 /etc/halfold/halfold.env
if [ -f /etc/halfold/backup.env ]; then
  echo "kept /etc/halfold/backup.env"
else
  install -o root -g halfold -m 640 "$HERE/backup.env.example" /etc/halfold/backup.env
  echo "wrote /etc/halfold/backup.env: R2 for the backup, see deploy/server/README.md"
fi

step "Caddy: https://$DOMAIN"
sed "s/halfold\.example\.com/$DOMAIN/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
systemctl enable --quiet caddy
systemctl reload-or-restart caddy

step "done"
echo "The server itself starts with activate.sh (push.sh runs it next)."
