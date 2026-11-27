#!/bin/sh
# Sao lưu 1 lần: pg_dump + tar uploads/storage(/minio). Giữ BACKUP_KEEP_DAILY bản ngày, BACKUP_KEEP_WEEKLY bản tuần (Chủ nhật).
set -eu
OUT=${BACKUP_ROOT:-/backups}
SRC=${BACKUP_SRC:-/data}
KEEP_D=${BACKUP_KEEP_DAILY:-7}
KEEP_W=${BACKUP_KEEP_WEEKLY:-4}
TS=$(date +%Y-%m-%d_%H%M)
DIR="$OUT/daily/$TS"
mkdir -p "$DIR" "$OUT/weekly"
export PGPASSWORD="${DB_PASSWORD:-123456}"
echo "[backup] $TS bắt đầu"
pg_dump -Fc -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USERNAME:-postgres}" "${DB_DATABASE:-capstone_db}" > "$DIR/db.dump"
PARTS=""
for p in uploads storage minio; do
  [ -d "$SRC/$p" ] && [ -n "$(ls -A "$SRC/$p" 2>/dev/null)" ] && PARTS="$PARTS $p"
done
[ -n "$PARTS" ] && tar czf "$DIR/files.tgz" -C "$SRC" $PARTS
echo "$PARTS" > "$DIR/PARTS"
# Chủ nhật → giữ thêm bản tuần
[ "$(date +%u)" = "7" ] && cp -r "$DIR" "$OUT/weekly/$TS"
prune() { ls -1 "$1" 2>/dev/null | sort -r | tail -n +$(($2 + 1)) | while read -r d; do rm -rf "${1:?}/$d"; done; }
prune "$OUT/daily" "$KEEP_D"
prune "$OUT/weekly" "$KEEP_W"
echo "[backup] xong: $DIR ($(du -sh "$DIR" | cut -f1))"
