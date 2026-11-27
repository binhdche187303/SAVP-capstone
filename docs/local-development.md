# Local Development Guide

## 📝 CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-11-27 | Thêm mục 11 "Sao lưu & khôi phục" (service `backup` trong docker-compose, `scripts/restore.sh`, trách nhiệm phía trường) | Mục 11 (cuối file) |

Hướng dẫn chạy và kiểm tra backend Capstone trên môi trường local.

---

## Prerequisites

- Node.js LTS (>= 20)
- Docker Desktop (để chạy PostgreSQL, Redis, MinIO)
- `npm` >= 9
- PostgreSQL client (tùy chọn, để query DB trực tiếp)

---

## 1. Chuẩn bị môi trường

### 1.1 Clone và cài dependencies

```bash
git clone <repo-url>
cd capstone-be
npm install
```

### 1.2 Tạo file `.env`

```bash
cp .env.example .env
```

Sau đó chỉnh sửa `.env` với giá trị thật của môi trường local. Đặc biệt:

- `DB_PASSWORD` — password PostgreSQL
- `AUTH_ACCESS_TOKEN_SECRET`, `AUTH_REFRESH_TOKEN_SECRET`, `WARNING_TOKEN_SECRET` — cần đặt giá trị random an toàn
- `MAIL_USER`, `MAIL_PASS` — nếu dùng Brevo SMTP thật (`MAIL_ENABLED=true`)

> **Lưu ý**: Không commit file `.env` vào git. File này đã có trong `.gitignore`.

---

## 2. Chạy Docker infrastructure

### 2.1 Khởi động Redis và MinIO

```bash
docker compose -f docker-compose.dev.yml up -d
```

Kiểm tra containers đang chạy:

```bash
docker compose -f docker-compose.dev.yml ps
```

Expected output:
```
NAME                STATUS
capstone-redis      Up
capstone-minio      Up
```

### 2.2 Services ports

| Service    | Port  | Ghi chú                  |
|------------|-------|--------------------------|
| PostgreSQL | 5432  | Chạy local (không Docker) hoặc tự cài |
| Redis      | 6379  | Docker — DB 0: cache, DB 1: BullMQ |
| MinIO      | 9000  | S3-compatible (chỉ dùng nếu `STORAGE_DRIVER=s3`) |
| MinIO UI   | 9001  | http://localhost:9001 (admin/password) |

---

## 3. Chạy backend

### 3.1 Development mode (hot reload)

```bash
npm run start:dev
```

### 3.2 Chạy migrations (nếu cần)

```bash
npm run migration:run
```

### 3.3 Chạy seed data (nếu cần)

Cần đặt `SEED_RUN_ON_STARTUP=true` trong `.env` hoặc chạy seed script trực tiếp.

---

## 4. Test Redis

### 4.1 Test ping qua Health endpoint

```bash
curl http://localhost:3000/api/v1/health
```

Expected response (khi tất cả services up):
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" },
    "bull-redis": { "status": "up" },
    "storage": { "status": "up" }
  }
}
```

### 4.2 Test Redis CLI (nếu có redis-cli)

```bash
redis-cli ping
# Expected: PONG

redis-cli -n 0 keys "capstone:*"
# Liệt kê tất cả keys với prefix
```

### 4.3 Test Redis qua Docker

```bash
docker exec -it capstone-redis redis-cli ping
# Expected: PONG
```

---

## 5. Test Health endpoint

```bash
GET http://localhost:3000/api/v1/health
```

Endpoint này **public** — không cần authentication.

Các indicator được check:
- `database` — PostgreSQL TypeORM connection
- `redis` — ioredis ping (DB=0)
- `bull-redis` — BullMQ Redis ping (DB=1)
- `storage` — local uploads folder accessible

Khi một service down, status sẽ là `"down"` và HTTP response code là `503`.

---

## 6. Test Mail (Brevo SMTP)

### 6.1 Bật mail trong `.env`

```bash
MAIL_ENABLED=true
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=your-brevo-email@example.com
MAIL_PASS=your-brevo-smtp-key
MAIL_FROM=your-from@example.com
MAIL_FROM_NAME=CAPSTONE System
```

### 6.2 Test SMTP connection (không gửi email)

```bash
curl -X POST http://localhost:3000/api/v1/dev/test-mail-verify
```

Expected:
```json
{
  "connected": true,
  "message": "SMTP connection verified successfully."
}
```

### 6.3 Test gửi email thật

```bash
curl -X POST http://localhost:3000/api/v1/dev/test-mail \
  -H "Content-Type: application/json" \
  -d '{ "to": "your-test@email.com", "subject": "Test from CAPSTONE" }'
```

Expected:
```json
{
  "success": true,
  "messageId": "<some-message-id>",
  "message": "Test email sent successfully to: your-test@email.com"
}
```

> **Lưu ý**: Endpoint `/dev/*` chỉ hoạt động khi `NODE_ENV=development`. Không expose ở production.

---

## 7. Chạy Unit Tests

```bash
# Tất cả tests
npm test

# Chỉ test một file
npx jest redis.service.spec

# Coverage report
npm run test:cov
```

Tests không kết nối Redis/DB/SMTP thật — tất cả external dependencies được mock.

---

## 8. Kiểm tra MinIO (nếu dùng S3 driver)

### 8.1 Bật MinIO driver

```env
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=http://localhost:9000
STORAGE_S3_BUCKET=capstone-media
STORAGE_S3_ACCESS_KEY=minioadmin
STORAGE_S3_SECRET_KEY=minioadmin
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_S3_REGION=ap-southeast-1
```

### 8.2 Truy cập MinIO Console

Mở trình duyệt: http://localhost:9001

- Username: `minioadmin`
- Password: `minioadmin`

Tạo bucket `capstone-media` nếu chưa có.

---

## 9. Dừng Docker infrastructure

```bash
docker compose -f docker-compose.dev.yml down
```

Dừng và xóa volumes:

```bash
docker compose -f docker-compose.dev.yml down -v
```

---

## 10. Troubleshooting

### Redis không kết nối được

```bash
# Kiểm tra container đang chạy
docker compose -f docker-compose.dev.yml ps

# Restart Redis
docker compose -f docker-compose.dev.yml restart capstone-redis

# Kiểm tra logs
docker compose -f docker-compose.dev.yml logs capstone-redis
```

### Mail không gửi được

1. Kiểm tra `MAIL_ENABLED=true`
2. Kiểm tra `MAIL_USER` và `MAIL_PASS` đúng Brevo credentials
3. Gọi `/dev/test-mail-verify` để check SMTP connection
4. Xem logs backend để biết lỗi cụ thể

### Health endpoint trả về 503

Kiểm tra từng indicator bị "down":
- `database` → PostgreSQL chưa chạy hoặc sai credentials
- `redis` → Docker Redis container chưa up
- `bull-redis` → Tương tự Redis nhưng DB=1
- `storage` → Thư mục `./uploads` không tồn tại hoặc không có quyền ghi

### Build lỗi TypeScript

```bash
npm run build 2>&1
```

Xem chi tiết lỗi và sửa theo hướng dẫn TypeScript compiler.

---

## 11. Sao lưu & khôi phục

### 11.1. Sao lưu tự động (service `backup`)
`docker compose up -d` chạy kèm container `capstone-backup`. Hằng ngày lúc `BACKUP_HOUR` giờ (mặc định 2h, giờ VN), nó làm:
- `pg_dump -Fc` DB SAVP → `db.dump`
- nén volume uploads / storage / minio (nếu có dữ liệu) → `files.tgz`
- giữ `BACKUP_KEEP_DAILY` bản ngày (mặc định 7) + `BACKUP_KEEP_WEEKLY` bản Chủ nhật (mặc định 4), bản cũ hơn tự xoá.

Cấu hình trong `.env`:
```env
BACKUP_DIR=/mnt/backup/savp   # NÊN là ổ thứ 2 / NAS, KHÔNG để chung ổ với DB
BACKUP_HOUR=2
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
```
Sao lưu ngay: `docker compose exec backup sh /scripts/backup.sh` — xem log: `docker compose logs backup`.

**Máy cài Postgres native (không Docker):** chạy cùng script bằng cron trên host (cần `pg_dump`):
```cron
0 2 * * * DB_HOST=127.0.0.1 DB_PASSWORD=*** BACKUP_ROOT=/mnt/backup/savp BACKUP_SRC=/opt/savp sh /opt/savp/scripts/backup/backup.sh >> /var/log/savp-backup.log 2>&1
```
(`BACKUP_SRC` = thư mục chứa `uploads/`, `storage/`.)

### 11.2. Khôi phục
```sh
./scripts/restore.sh                          # liệt kê bản sao lưu
./scripts/restore.sh daily/2026-11-27_0200    # khôi phục (hỏi xác nhận "yes")
```
Script dừng backend → `pg_restore --clean` → giải nén file → bật lại backend. Chuyển sang máy chủ mới: chép thư mục bản sao lưu sang `BACKUP_DIR` máy mới, `docker compose up -d`, rồi chạy restore.

### 11.3. Phía trường cần đảm bảo (ngoài phạm vi SAVP)
- **UPS** cho máy chủ + switch để tắt máy an toàn khi mất điện (tránh hỏng DB).
- **Ổ thứ 2 / NAS** cho `BACKUP_DIR`; định kỳ chép thêm 1 bản ra ngoài máy chủ.
- **HGVision** (video, khuôn mặt, biển số) có DB/ổ lưu riêng — sao lưu do nhà cung cấp HGVision phụ trách; SAVP không sao lưu video.
- Thử khôi phục định kỳ (vd. mỗi quý) để chắc bản sao lưu dùng được.
