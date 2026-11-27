#!/bin/sh
# Khôi phục từ bản sao lưu. Dùng: ./scripts/restore.sh            (liệt kê bản)
#                                 ./scripts/restore.sh daily/2026-11-27_0200
set -eu
cd "$(dirname "$0")/.."
if [ $# -eq 0 ]; then docker compose exec -T backup sh -c 'ls -1 /backups/daily /backups/weekly'; exit 0; fi
printf "Khôi phục %s sẽ GHI ĐÈ DB + file hiện tại. Gõ yes: " "$1"; read -r a; [ "$a" = yes ] || exit 1
docker compose stop backend
docker compose exec -T backup sh /scripts/restore-inside.sh "/backups/$1"
docker compose start backend
