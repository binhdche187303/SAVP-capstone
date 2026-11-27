#!/bin/sh
# Chạy backup.sh mỗi ngày lúc BACKUP_HOUR giờ (mặc định 2h, theo TZ).
H=${BACKUP_HOUR:-2}
echo "[backup] lịch: hằng ngày ${H}h, giữ ${BACKUP_KEEP_DAILY:-7} ngày + ${BACKUP_KEEP_WEEKLY:-4} tuần"
while true; do
  now=$(( $(date +%s) )); next=$(( $(date -d "$(date +%Y-%m-%d) $H:00:00" +%s 2>/dev/null || date +%s) ))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  sh /scripts/backup.sh || echo "[backup] LỖI"
done
