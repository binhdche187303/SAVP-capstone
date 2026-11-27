#!/bin/sh
# Chạy TRONG container backup: khôi phục DB + file từ 1 thư mục bản sao lưu.
set -eu
DIR="$1"; SRC=${BACKUP_SRC:-/data}
[ -f "$DIR/db.dump" ] || { echo "Không thấy $DIR/db.dump"; exit 1; }
export PGPASSWORD="${DB_PASSWORD:-123456}"
pg_restore --clean --if-exists --no-owner -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USERNAME:-postgres}" -d "${DB_DATABASE:-capstone_db}" "$DIR/db.dump"
if [ -f "$DIR/files.tgz" ]; then
  for p in $(cat "$DIR/PARTS"); do find "$SRC/$p" -mindepth 1 -delete 2>/dev/null || true; done
  tar xzf "$DIR/files.tgz" -C "$SRC"
fi
echo "[restore] xong từ $DIR"
