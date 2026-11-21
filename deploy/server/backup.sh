#!/usr/bin/env bash
# The daily backup (halfold-backup.timer at 04:30 Hong Kong time, or `halfold backup`), run as the user halfold:
#   1. a consistent copy of the database, checked and gzipped, in /var/backups/halfold (the newest KEEP_LOCAL kept);
#   2. with R2 set up in /etc/halfold/backup.env: that copy to R2 (db/, KEEP_REMOTE_DAYS days kept), and the lecture
#      files mirrored to R2 (lectures/), so a recording deleted here, by the student or past its plan's keep date,
#      goes from R2 too.
# Restoring: deploy/server/README.md, "恢复".
set -euo pipefail

DATA=${DATA:-/srv/halfold/server/data}
LOCAL=${LOCAL:-/var/backups/halfold}
KEEP_LOCAL=${KEEP_LOCAL:-7}
KEEP_REMOTE_DAYS=${KEEP_REMOTE_DAYS:-30}

mkdir -p "$LOCAL"
name="halfold-$(date -u +%Y%m%d-%H%M%S).db"
# .backup takes a consistent snapshot while the server keeps writing; copying the file could catch it mid-write.
sqlite3 "$DATA/sidenote.db" ".backup '$LOCAL/$name'"
check=$(sqlite3 "$LOCAL/$name" "PRAGMA integrity_check")
if [ "$check" != ok ]; then
  rm -f "$LOCAL/$name"
  echo "backup: the database copy failed its check: $check" >&2
  exit 1
fi
gzip -f "$LOCAL/$name"
echo "backup: database -> $LOCAL/$name.gz ($(du -h "$LOCAL/$name.gz" | cut -f1))"
# shellcheck disable=SC2012
ls -1t "$LOCAL"/halfold-*.db.gz | tail -n +"$((KEEP_LOCAL + 1))" | xargs -r rm -f --

if [ -z "${R2_BUCKET:-}" ]; then
  echo "backup: R2 is not set up (/etc/halfold/backup.env), so the copies stay on this server only"
  exit 0
fi
: "${R2_ACCOUNT_ID:?is empty in /etc/halfold/backup.env}" "${R2_ACCESS_KEY_ID:?is empty}" "${R2_SECRET_ACCESS_KEY:?is empty}"
# rclone without a config file: the remote is ":s3:" with these settings, kept out of the process list.
export RCLONE_CONFIG=/dev/null RCLONE_S3_PROVIDER=Cloudflare RCLONE_S3_NO_CHECK_BUCKET=true \
  RCLONE_S3_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
  RCLONE_S3_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_S3_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
remote=":s3:$R2_BUCKET"

rclone copyto "$LOCAL/$name.gz" "$remote/db/$name.gz"
rclone delete --min-age "${KEEP_REMOTE_DAYS}d" "$remote/db"
rclone sync --stats-one-line --stats-log-level NOTICE "$DATA/lectures" "$remote/lectures"
echo "backup: database and lecture files -> R2 bucket $R2_BUCKET"
