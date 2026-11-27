import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Observable, tap } from 'rxjs';
import { AuditLogSeverity } from '../entities/audit-log.entity.js';
import { AuditLogsService } from '../services/audit-logs.service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const VERB: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Khoá nhạy cảm / nặng — không bao giờ lưu vào nhật ký. */
const SECRET_KEY_RE =
  /pass|otp|token|secret|credential|api_?key|image|base64|photo_?data|file_?data|signature/i;
/** Route tự ghi nhật ký riêng hoặc do thiết bị gọi liên tục — không ghi tự động. */
const SKIP_PATH_RE = /^(auth|health)(\/|$)/i;
const MAX_STRING = 200;
const MAX_KEYS = 40;
const MAX_DEPTH = 3;
const ACTION_MAX = 80;

type AuthedRequest = {
  method: string;
  originalUrl?: string;
  url: string;
  route?: { path?: string };
  params?: Record<string, string>;
  body?: unknown;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  user?: { userId?: string };
};

/**
 * AutoAuditInterceptor — ghi nhật ký cho MỌI thao tác thay đổi dữ liệu (POST/PUT/PATCH/
 * DELETE) của người dùng đã đăng nhập, để không module nào bị sót log.
 *
 * - Service nào đã tự ghi log chi tiết trong cùng request (cùng user, sau mốc bắt đầu
 *   request) → bỏ qua bản tự động, giữ bản chi tiết (không trùng).
 * - action_type = `<tài nguyên>[_<nhánh>]_<create|update|delete>` suy từ route,
 *   entity_type = tài nguyên. FE dịch nhãn tiếng Việt.
 * - Lỗi → vẫn ghi (warning 4xx, error 5xx) kèm mã lỗi.
 * - Request ẩn danh (thiết bị, webhook, đăng nhập) không ghi tại đây.
 * - Body đã lọc mật khẩu/OTP/token/ảnh và cắt ngắn. Ghi lỗi không làm hỏng request.
 */
@Injectable()
export class AutoAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AutoAuditInterceptor.name);

  constructor(
    private readonly audit: AuditLogsService,
    private readonly dataSource: DataSource,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const method = req.method?.toUpperCase();
    const userId = req.user?.userId;
    if (!MUTATING.has(method) || !userId) return next.handle();
    const routePath = stripPrefix(req.route?.path ?? req.url);
    if (SKIP_PATH_RE.test(routePath)) return next.handle();

    const startedAt = new Date();
    return next.handle().pipe(
      tap({
        next: (data) =>
          void this.record(req, routePath, userId, startedAt, 200, data),
        error: (err: unknown) =>
          void this.record(
            req,
            routePath,
            userId,
            startedAt,
            err instanceof HttpException ? err.getStatus() : 500,
            undefined,
            err,
          ),
      }),
    );
  }

  private async record(
    req: AuthedRequest,
    routePath: string,
    userId: string,
    startedAt: Date,
    status: number,
    data: unknown,
    err?: unknown,
  ): Promise<void> {
    try {
      // Service đã tự ghi log trong request này → không ghi trùng.
      if (status < 400 && (await this.alreadyLogged(userId, startedAt))) return;

      const { actionType, entityType } = actionFromRoute(
        req.method.toUpperCase(),
        routePath,
      );
      await this.audit.logAction({
        userId,
        actionType,
        entityType,
        entityId: entityIdOf(req.params, data) ?? undefined,
        ipAddress: clientIp(req) ?? undefined,
        userAgent: header(req, 'user-agent') ?? undefined,
        requestId: header(req, 'x-request-id') ?? undefined,
        severity:
          status >= 500
            ? AuditLogSeverity.ERROR
            : status >= 400
              ? AuditLogSeverity.WARNING
              : AuditLogSeverity.INFO,
        metadataJson: {
          auto: true,
          method: req.method.toUpperCase(),
          path: (req.originalUrl ?? req.url).split('?')[0],
          status,
          ...(err ? { error: errorMessage(err) } : {}),
          ...(req.body && typeof req.body === 'object'
            ? { body: sanitize(req.body, 0) }
            : {}),
        },
      });
    } catch (e) {
      this.logger.warn(
        `Ghi nhật ký tự động lỗi: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async alreadyLogged(userId: string, since: Date): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM audit_logs WHERE user_id = $1 AND created_at >= $2 LIMIT 1`,
      [userId, since],
    );
    return rows.length > 0;
  }
}

const stripPrefix = (path: string): string =>
  path
    .split('?')[0]
    .replace(/^\/?api\/v\d+\/?/i, '')
    .replace(/^\/+/, '');

/** `camera-groups/:id/members` + POST → camera_groups_members_create. */
export function actionFromRoute(
  method: string,
  routePath: string,
): { actionType: string; entityType: string } {
  const statics = stripPrefix(routePath)
    .split('/')
    .filter((s) => s && !s.startsWith(':'))
    .map((s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase());
  const entityType = statics[0] || 'system';
  const actionType = [...statics, VERB[method] ?? method.toLowerCase()]
    .join('_')
    .slice(0, ACTION_MAX);
  return { actionType, entityType };
}

function entityIdOf(
  params: Record<string, string> | undefined,
  data: unknown,
): string | null {
  for (const v of Object.values(params ?? {})) if (UUID_RE.test(v)) return v;
  const body = data as { id?: unknown; data?: { id?: unknown } } | undefined;
  const id = body?.data?.id ?? body?.id;
  return typeof id === 'string' && UUID_RE.test(id) ? id : null;
}

export function sanitize(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const out = value.slice(0, 20).map((v) => sanitize(v, depth + 1));
    return value.length > 20 ? [...out, `… +${value.length - 20}`] : out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).slice(0, MAX_KEYS)) {
    out[k] = SECRET_KEY_RE.test(k) ? '[ẩn]' : sanitize(v, depth + 1);
  }
  return out;
}

function header(req: AuthedRequest, name: string): string | null {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

function clientIp(req: AuthedRequest): string | null {
  const fwd = header(req, 'x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : req.ip) || null;
}

function errorMessage(err: unknown): string {
  if (err instanceof HttpException) {
    const r = err.getResponse();
    const m = typeof r === 'string' ? r : (r as { message?: unknown }).message;
    return String(Array.isArray(m) ? m.join('; ') : (m ?? err.message)).slice(
      0,
      MAX_STRING,
    );
  }
  return (err instanceof Error ? err.message : String(err)).slice(
    0,
    MAX_STRING,
  );
}
