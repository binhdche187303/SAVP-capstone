import * as Joi from 'joi';

/**
 * Joi validation schema cho toàn bộ env variables của backend.
 *
 * Conditional validation:
 * - STORAGE_S3_* chỉ bắt buộc khi STORAGE_DRIVER=s3
 * - MAIL_USER/MAIL_PASS chỉ bắt buộc khi MAIL_ENABLED=true
 *
 * Không log bất kỳ secret nào trong schema này.
 */
export const envValidationSchema = Joi.object({
  // ─── A. Application ─────────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  APP_PORT: Joi.number().integer().min(1).max(65535).default(3000),
  APP_NAME: Joi.string().default('capstone-be'),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  API_PREFIX: Joi.string().default('api'),
  APP_TIMEZONE: Joi.string().default('Asia/Ho_Chi_Minh'),
  CORS_ORIGIN: Joi.string().default(
    'http://localhost:5173,http://localhost:3000',
  ),
  // Trang docs Swagger/OpenAPI phơi toàn bộ bề mặt API ra public — bật mặc
  // định cho demo/bảo vệ, có công tắc tắt khi cần (production siết chặt).
  SWAGGER_ENABLED: Joi.boolean().default(true),

  // ─── B. Database ─────────────────────────────────────────────────────────────
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().integer().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_DATABASE: Joi.string().required(),
  DB_SCHEMA: Joi.string().default('public'),
  DB_SSL: Joi.boolean().default(false),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  DB_MIGRATIONS_RUN: Joi.boolean().default(false),

  // ─── C. Redis ────────────────────────────────────────────────────────────────
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().integer().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DB: Joi.number().integer().default(0),
  REDIS_KEY_PREFIX: Joi.string().default('capstone:'),
  REDIS_TTL_DEFAULT: Joi.number().integer().default(600),

  // ─── D. JWT / Auth ───────────────────────────────────────────────────────────
  AUTH_ACCESS_TOKEN_SECRET: Joi.string().min(16).required(),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: Joi.number().integer().default(900),
  AUTH_REFRESH_TOKEN_SECRET: Joi.string().min(16).required(),
  AUTH_REFRESH_TOKEN_TTL_SECONDS: Joi.number().integer().default(604800),
  AUTH_JWT_ISSUER: Joi.string().default('capstone-be'),
  AUTH_JWT_AUDIENCE: Joi.string().default('capstone-client'),
  AUTH_JWT_BLACKLIST_PREFIX: Joi.string().default('auth:blacklist:jti:'),
  WARNING_TOKEN_SECRET: Joi.string().min(16).required(),

  // --- D1. Signed Download Token ---
  MEDIA_DOWNLOAD_TOKEN_SECRET: Joi.string().min(16).required(),
  MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(3600)
    .default(600),
  API_PUBLIC_BASE_URL: Joi.string().uri().default('http://localhost:3000'),

  // ─── E. OTP ──────────────────────────────────────────────────────────────────
  AUTH_OTP_TTL_SECONDS: Joi.number().integer().default(300),
  AUTH_OTP_LENGTH: Joi.number().integer().default(6),
  AUTH_OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().default(60),
  AUTH_OTP_MAX_RESENDS: Joi.number().integer().default(5),
  AUTH_OTP_MAX_VERIFY_ATTEMPTS: Joi.number().integer().default(5),
  AUTH_OTP_PREFIX: Joi.string().default('auth:otp:password-reset:'),

  // ─── E1. Guest Access (feat-external-guest-live-meeting-access, GLA-001) ──────
  // Secret RIÊNG cho token phiên khách — BẮT BUỘC khác AUTH_ACCESS_TOKEN_SECRET/
  // AUTH_REFRESH_TOKEN_SECRET (ranh giới bảo mật cốt lõi: khách không đi qua
  // JwtAuthGuard nội bộ). Xem spec/features/guest-access/feat-external-guest-live-meeting-access.
  GUEST_TOKEN_SECRET: Joi.string().min(16).required(),
  GUEST_ACCESS_OTP_TTL_SECONDS: Joi.number().integer().default(600),
  GUEST_ACCESS_OTP_MAX_RESENDS: Joi.number().integer().default(3),
  GUEST_ACCESS_OTP_RESEND_WINDOW_SECONDS: Joi.number().integer().default(300),
  GUEST_ACCESS_OTP_MAX_VERIFY_ATTEMPTS: Joi.number().integer().default(5),
  GUEST_ACCESS_OTP_BLOCK_SECONDS: Joi.number().integer().default(900),
  GUEST_ACCESS_SESSION_MAX_HOURS: Joi.number().integer().default(4),
  GUEST_ACCESS_JOIN_WINDOW_BEFORE_MINUTES: Joi.number().integer().default(30),
  GUEST_ACCESS_JOIN_WINDOW_AFTER_MINUTES: Joi.number().integer().default(15),
  GUEST_ACCESS_INVITE_LINK_TTL_HOURS: Joi.number().integer().default(24),
  GUEST_ACCESS_INVITE_BASE_URL: Joi.string()
    .uri()
    .default('http://localhost:5173/guest/join'),
  GUEST_ACCESS_DEVICE_REMEMBER_DAYS: Joi.number().integer().default(30),
  GUEST_ACCESS_LOBBY_ENABLED_DEFAULT: Joi.boolean().default(true),
  GUEST_ACCESS_VERIFICATION_MODE_DEFAULT: Joi.string()
    .valid('otp', 'magic_click')
    .default('otp'),

  // ─── F. Rate Limit ───────────────────────────────────────────────────────────
  RATE_LIMIT_ENABLED: Joi.boolean().default(true),
  AUTH_LOGIN_RATE_LIMIT_MAX_ATTEMPTS: Joi.number().integer().default(5),
  AUTH_LOGIN_RATE_LIMIT_WINDOW_SECONDS: Joi.number().integer().default(300),
  AUTH_OTP_REQUEST_RATE_LIMIT_MAX_ATTEMPTS: Joi.number().integer().default(3),
  AUTH_OTP_REQUEST_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .default(300),
  AUTH_OTP_VERIFY_RATE_LIMIT_MAX_ATTEMPTS: Joi.number().integer().default(5),
  AUTH_OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: Joi.number()
    .integer()
    .default(300),

  // ─── G. BullMQ Queue ─────────────────────────────────────────────────────────
  BULL_REDIS_HOST: Joi.string().default('localhost'),
  BULL_REDIS_PORT: Joi.number().integer().default(6379),
  BULL_REDIS_PASSWORD: Joi.string().allow('').optional(),
  BULL_REDIS_DB: Joi.number().integer().default(1),
  BULL_QUEUE_PREFIX: Joi.string().default('capstone'),
  BULL_DEFAULT_ATTEMPTS: Joi.number().integer().default(3),
  BULL_DEFAULT_BACKOFF_DELAY_MS: Joi.number().integer().default(5000),
  BULL_REMOVE_ON_COMPLETE: Joi.boolean().default(true),
  BULL_REMOVE_ON_FAIL: Joi.boolean().default(false),
  QUEUE_AUTH: Joi.string().default('auth'),
  QUEUE_NOTIFICATION: Joi.string().default('notification'),
  QUEUE_ACCOUNT_IMPORT: Joi.string().default('account-import'),
  QUEUE_MEDIA_PROCESSING: Joi.string().default('media-processing'),
  QUEUE_TRANSCRIPTION: Joi.string().default('transcription'),
  QUEUE_REPORT_EXPORT: Joi.string().default('report-export'),
  QUEUE_MINUTES_EXPORT: Joi.string().default('minutes-export'),
  QUEUE_SCHEDULER: Joi.string().default('scheduler'),
  QUEUE_MINUTES_AI_DRAFT: Joi.string().default('minutes.generate_ai_draft'),

  // ─── H. Notification ─────────────────────────────────────────────────────────
  NOTIFICATION_EMAIL_ENABLED: Joi.boolean().default(true),
  NOTIFICATION_IN_APP_ENABLED: Joi.boolean().default(true),
  NOTIFICATION_WEBSOCKET_ENABLED: Joi.boolean().default(true),
  NOTIFICATION_DEFAULT_CHANNEL: Joi.string().default('email'),
  NOTIFICATION_RETRY_ATTEMPTS: Joi.number().integer().default(3),

  // ─── I. Storage ──────────────────────────────────────────────────────────────
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  STORAGE_LOCAL_PATH: Joi.string().default('./uploads'),
  STORAGE_PUBLIC_BASE_URL: Joi.string().default(
    'http://localhost:3000/uploads',
  ),
  STORAGE_MAX_FILE_SIZE: Joi.number().integer().default(104857600),
  // S3/MinIO: chỉ bắt buộc khi STORAGE_DRIVER=s3
  STORAGE_S3_REGION: Joi.when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  STORAGE_S3_BUCKET: Joi.when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  STORAGE_S3_ACCESS_KEY: Joi.when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  STORAGE_S3_SECRET_KEY: Joi.when('STORAGE_DRIVER', {
    is: 's3',
    then: Joi.string().required(),
    otherwise: Joi.string().optional(),
  }),
  STORAGE_S3_ENDPOINT: Joi.string().optional(),
  STORAGE_S3_PORT: Joi.number().integer().default(9000),
  STORAGE_S3_USE_SSL: Joi.boolean().default(false),
  STORAGE_S3_FORCE_PATH_STYLE: Joi.boolean().default(false),

  // ─── AI Worker (offline transcription pipeline) ───────────────────────────────
  AI_WORKER_JOB_RUNNER_PATH: Joi.string().default(
    './workers/ai-transcription/dist/transcription-job-runner.js',
  ),
  AI_WORKER_JOB_TIMEOUT_MS: Joi.number()
    .integer()
    .default(15 * 60 * 1000),

  // ─── AI Summary (feat-ai-meeting-minutes-draft, MKM-AI-01) ────────────────────
  AI_SUMMARY_LLM_BASE_URL: Joi.string().default('http://localhost:11434'),
  AI_SUMMARY_LLM_TIMEOUT_MS: Joi.number()
    .integer()
    .default(5 * 60 * 1000),

  // ─── J. WebSocket ────────────────────────────────────────────────────────────
  WS_ENABLED: Joi.boolean().default(true),
  WS_PATH: Joi.string().default('/ws'),
  WS_CORS_ORIGIN: Joi.string().default(
    'http://localhost:5173,http://localhost:3000',
  ),
  WS_HEARTBEAT_INTERVAL_MS: Joi.number().integer().default(30000),
  WS_AUTH_REQUIRED: Joi.boolean().default(true),

  // ─── K. Scheduler ────────────────────────────────────────────────────────────
  SCHEDULER_ENABLED: Joi.boolean().default(true),
  SCHEDULER_TIMEZONE: Joi.string().default('Asia/Ho_Chi_Minh'),
  SCHEDULER_NO_SHOW_CHECK_ENABLED: Joi.boolean().default(false),
  SCHEDULER_NO_SHOW_CHECK_CRON: Joi.string().default('*/5 * * * *'),
  SCHEDULER_AUTO_RELEASE_ENABLED: Joi.boolean().default(false),
  SCHEDULER_AUTO_RELEASE_CRON: Joi.string().default('*/5 * * * *'),
  // EVD-001 (#34): cron phát hiện phòng trống sớm (gated default OFF).
  SCHEDULER_EARLY_VACANCY_ENABLED: Joi.boolean().default(false),
  // recon B1: cron auto-complete meeting quá end_time (gated default OFF).
  SCHEDULER_AUTO_COMPLETE_ENABLED: Joi.boolean().default(false),
  // F-A (MST-001): cron lật meetings.status theo thời gian mỗi phút
  // (scheduled→in_progress→completed). Thay thế cờ auto-complete ở trên.
  SCHEDULER_MEETING_STATUS_ENABLED: Joi.boolean().default(false),
  SCHEDULER_NOTIFICATION_REMINDER_ENABLED: Joi.boolean().default(false),
  SCHEDULER_NOTIFICATION_REMINDER_CRON: Joi.string().default('0 * * * *'),

  // ─── K2. Device Probe (IOT-014) ──────────────────────────────────────────────
  DEVICE_OFFLINE_DETECT_ENABLED: Joi.boolean().default(true),
  RTSP_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(3000),
  // A5 (IOT-005): timeout riêng cho runtime RTSP probe (chẩn đoán đơn lẻ, chờ lâu hơn batch).
  RTSP_RUNTIME_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(10000),

  // ─── Q. Recording Capture (IOT-015 / #23) ────────────────────────────────────
  // Khóa mã hóa mật khẩu RTSP (AES-256-GCM, key=sha256(RTSP_CRED_KEY)).
  // ĐỔI key này = KHÔNG giải mã được các password đã lưu trước đó.
  RTSP_CRED_KEY: Joi.string().min(32).required(),
  // REC-002: ffmpeg + nơi lưu file recording.
  FFMPEG_PATH: Joi.string().default('ffmpeg'),
  RECORDING_STORAGE_PATH: Joi.string().default('./storage/recordings'),
  // REC-005: ffprobe trích metadata media (best-effort).
  FFPROBE_PATH: Joi.string().default('ffprobe'),
  // NSC-001 (#31): token nội bộ cho POST /internal/no-show-cases (fail-closed nếu rỗng).
  NOSHOW_INTERNAL_TOKEN: Joi.string().allow('').default(''),
  // NSC-001: ngưỡng no-show (phút) — fallback khi system_configs chưa cấu hình (#35).
  NO_SHOW_THRESHOLD_MINUTES: Joi.number().integer().min(1).default(15),
  // ASC-001: ngưỡng auto-resolve security_alerts (phút) — fallback khi
  // system_configs chưa cấu hình.
  SECURITY_ALERTS_AUTO_RESOLVE_TIMEOUT_MINUTES: Joi.number()
    .integer()
    .min(1)
    .default(15),
  // NSL-001 (#32/#33/#35): grace cảnh báo + grace auto-release (phút) + bật email cảnh báo.
  NO_SHOW_WARNING_GRACE_MINUTES: Joi.number().integer().min(0).default(0),
  NO_SHOW_AUTO_RELEASE_GRACE_MINUTES: Joi.number().integer().min(1).default(5),
  // Việc B (tái đánh giá 2026-08-21): số phút gia hạn khi bấm "Tôi vẫn đến" (snoozed).
  NO_SHOW_CONFIRM_EXTENSION_MINUTES: Joi.number().integer().min(1).default(10),
  NO_SHOW_ALERT_EMAIL_ENABLED: Joi.boolean().default(false),
  // Việc B (Hướng 2): secret riêng ký link xác nhận "Tôi vẫn đến" trong email no-show —
  // mirror GUEST_TOKEN_SECRET (min(16).required()), KHÁC hoàn toàn secret đó.
  NO_SHOW_CONFIRM_LINK_SECRET: Joi.string().min(16).required(),
  // EVD-001 (#34/#48): ngưỡng early-vacancy (phút) + bật email cảnh báo trống sớm.
  EARLY_VACANCY_EMPTY_MINUTES: Joi.number().integer().min(1).default(10),
  EARLY_VACANCY_MIN_REMAINING_MINUTES: Joi.number()
    .integer()
    .min(0)
    .default(15),
  EARLY_VACANCY_MIN_ELAPSED_MINUTES: Joi.number().integer().min(0).default(10),
  EARLY_VACANCY_ALERT_EMAIL_ENABLED: Joi.boolean().default(false),
  // IVS-001 (#36): IVSS bridge sidecar — base URL + shared token (2 chiều, R1) + group + timeout.
  IVSS_BRIDGE_BASE_URL: Joi.string().allow('').default(''),
  IVSS_BRIDGE_TOKEN: Joi.string().allow('').default(''),
  IVSS_DEFAULT_GROUP: Joi.string().allow('').default(''),
  IVSS_BRIDGE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(30000)
    .default(8000),
  // IPS-001 (#37): cron đồng bộ person IVSS (gated default OFF) + lead/grace (phút).
  SCHEDULER_IVSS_SYNC_ENABLED: Joi.boolean().default(false),
  // KPI-001 (#10): cron rollup KPI theo giờ + đối soát 01:00 (gated default OFF).
  SCHEDULER_KPI_ROLLUP_ENABLED: Joi.boolean().default(false),
  // KPI-001: đọc bảng tổng hợp ở API zone traffic / vehicle stats. false ⇒ quay về 100% raw.
  KPI_ROLLUP_READ_ENABLED: Joi.boolean().default(true),
  IVSS_SYNC_LEAD_MINUTES: Joi.number().integer().min(1).default(5),
  IVSS_SYNC_GRACE_MINUTES: Joi.number().integer().min(0).default(5),
  // IRP-001 (#40): broadcast realtime presence qua WS (gated default OFF).
  // OWED-BLOCKER: WS auth handshake là tiền-điều-kiện bật =true trên prod
  // (WS hiện vô danh — bật khi chưa auth = rò vị trí cá nhân).
  IVSS_REALTIME_ENABLED: Joi.boolean().default(false),
  // B2 (Zone realtime): broadcast "zone.presence.updated" qua WS zone:{zoneId}
  // (gate default OFF) — auth THẬT ngay từ đầu (zone:subscribe check permission
  // qua AuthzReadRepository), KHÔNG cùng lỗ hổng với ivss:subscribe cũ.
  ZONE_REALTIME_ENABLED: Joi.boolean().default(false),
  // FGC-001 (Face-access A): timeout call FaceGate (no-hang) + tz format validity + field upload ảnh.
  FACEGATE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(30000)
    .default(8000),
  FACEGATE_TZ: Joi.string().default('Asia/Ho_Chi_Minh'),
  FACEGATE_UPLOAD_FIELD: Joi.string().default('vfileselector'),
  // FPE-001 (Face-access D): giới hạn kích thước ảnh chân dung enroll.
  FACE_PORTRAIT_MAX_BYTES: Joi.number().integer().min(1).default(5242880),
  // FMP-001 (Face-access B): per-meeting provisioning (cron gated OFF mặc định).
  FACE_SYNC_ENABLED: Joi.boolean().default(false),
  FACE_SYNC_LEAD_MINUTES: Joi.number().integer().min(1).default(5),
  FACE_SYNC_GRACE_MINUTES: Joi.number().integer().min(1).default(5),
  // FAT-001 (Face-access C): grace (phút) phân loại late khi điểm danh bằng khuôn mặt.
  ATTENDANCE_LATE_GRACE_MINUTES: Joi.number().integer().min(0).default(0),
  // FAT-001: bật debug log payload verify callback (đã strip SanpPic).
  FACE_VERIFY_DEBUG: Joi.boolean().default(false),
  // DCO-001: giá trị info.Direction = RA (check-out). Giả định 2=out/1=in, xác nhận live.
  FACE_DIRECTION_OUT_VALUE: Joi.string().default('2'),
  // UMR-001: cửa sổ (phút) lấy verify gần đây cho danh sách unmapped (mặc định 24h).
  FACE_UNMAPPED_WINDOW_MINUTES: Joi.number().integer().min(1).default(1440),
  // SAL-001 (#20): throttle cảnh báo stranger (giây/device), window list (phút), email opt-in.
  STRANGER_ALERT_THROTTLE_SECONDS: Joi.number().integer().min(1).default(300),
  STRANGER_ALERT_WINDOW_MINUTES: Joi.number().integer().min(1).default(1440),
  STRANGER_ALERT_EMAIL_ENABLED: Joi.boolean().default(false),

  // ─── L. System Config Cache ──────────────────────────────────────────────────
  SYSTEM_CONFIG_CACHE_ENABLED: Joi.boolean().default(true),
  SYSTEM_CONFIG_CACHE_TTL_SECONDS: Joi.number().integer().default(300),

  // ─── M. Audit Log ────────────────────────────────────────────────────────────
  AUDIT_LOG_ENABLED: Joi.boolean().default(true),
  AUDIT_LOG_FAIL_SAFE: Joi.boolean().default(true),
  AUDIT_LOG_RETENTION_DAYS: Joi.number().integer().default(365),
  AUDIT_LOG_INCLUDE_REQUEST_BODY: Joi.boolean().default(false),
  AUDIT_LOG_INCLUDE_RESPONSE_BODY: Joi.boolean().default(false),

  // ─── N. Health Check ─────────────────────────────────────────────────────────
  HEALTH_CHECK_ENABLED: Joi.boolean().default(true),
  HEALTH_CHECK_DB: Joi.boolean().default(true),
  HEALTH_CHECK_REDIS: Joi.boolean().default(true),
  HEALTH_CHECK_QUEUE: Joi.boolean().default(true),
  HEALTH_CHECK_STORAGE: Joi.boolean().default(true),
  HEALTH_DISK_THRESHOLD_PERCENT: Joi.number()
    .integer()
    .min(1)
    .max(100)
    .default(90),

  // ─── O. Seed ─────────────────────────────────────────────────────────────────
  SEED_RUN_ON_STARTUP: Joi.boolean().default(false),
  SEED_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .default('admin@capstone.local'),
  SEED_ADMIN_PASSWORD: Joi.string().optional(),
  SEED_ADMIN_FULL_NAME: Joi.string().optional(),

  // ─── P. Logging ──────────────────────────────────────────────────────────────
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
  LOG_FORMAT: Joi.string().valid('text', 'json').default('text'),
  REQUEST_ID_HEADER: Joi.string().default('x-request-id'),

  // ─── Mail SMTP ────────────────────────────────────────────────────────────────
  // MAIL_ENABLED=false thì không bắt buộc MAIL_USER/MAIL_PASS
  MAIL_ENABLED: Joi.boolean().default(false),
  MAIL_HOST: Joi.string().default('localhost'),
  MAIL_PORT: Joi.number().integer().default(1025),
  MAIL_SECURE: Joi.boolean().default(false),
  MAIL_USER: Joi.when('MAIL_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAIL_PASS: Joi.when('MAIL_ENABLED', {
    is: true,
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').optional(),
  }),
  MAIL_FROM_NAME: Joi.string().default('CAPSTONE System'),
  MAIL_FROM: Joi.string()
    .email({ tlds: { allow: false } })
    .default('noreply@capstone.local'),
  MAIL_TIMEOUT_MS: Joi.number().integer().default(10000),
})
  .unknown(true) // cho phép các env chưa định nghĩa (tránh strict-mode phá build)
  .options({ allowUnknown: true });
