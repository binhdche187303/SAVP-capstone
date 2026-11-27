import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthConfigService } from '../auth/services/auth-config.service.js';
import { GuestAccessConfigService } from '../guest-access/config/guest-access-config.service.js';
import { GuestAccessCacheService } from '../guest-access/services/guest-access-cache.service.js';
import { GuestAttendanceService } from '../guest-access/services/guest-attendance.service.js';
import { GUEST_TOKEN_TYPE } from '../guest-access/constants/guest-access.constants.js';
import { GuestJwtPayload } from '../guest-access/types/guest-jwt-payload.type.js';
import { MeetingParticipantEntity } from '../meetings/entities/meeting-participant.entity.js';
import { MeetingEntity } from '../meetings/entities/meeting.entity.js';
import { AuthzReadRepository } from '../auth/repositories/authz-read.repository.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IVSS_MEETING_ROOM = (meetingId: string): string =>
  `ivss:meeting:${meetingId}`;
const MEETING_ROOM = (meetingId: string): string => `meeting:${meetingId}`;
const USER_ROOM = (userId: string): string => `user:${userId}`;
// B2 (Zone realtime) — room MỚI HOÀN TOÀN cho zone.presence.updated, KHÔNG
// liên quan ivss:meeting:<id> cũ (không auth).
const ZONE_ROOM = (zoneId: string): string => `zone:${zoneId}`;

type SocketIdentity =
  | { type: 'employee'; userId: string }
  | {
      type: 'guest';
      externalParticipantId: string;
      meetingId: string;
      jti: string;
    };

/**
 * EventsGateway — Socket.IO gateway.
 *
 * GLA-001 (FR-GLA-035/036) — xác thực handshake + kiểm tra phạm vi khi
 * subscribe phòng cuộc họp. Đây là ĐIỀU KIỆN CHẶN RELEASE của feature khách
 * ngoài công ty: không có bước này, mọi lớp OTP/token/lobby bị đi vòng qua
 * chỉ bằng `socket.emit('meeting:subscribe', { meetingId })` vì trước đây
 * gateway không xác thực gì.
 *
 * PHẠM VI CỐ Ý THU HẸP so với đọc theo nghĩa đen của spec: KHÔNG disconnect
 * mọi kết nối thiếu token ở `handleConnection()` (sẽ phá vỡ 2 luồng khác
 * đang dùng chung gateway này mà auth vốn đã là ticket riêng, chưa làm:
 * `ivss:subscribe` — có OWED-BLOCKER ghi rõ "auth handshake = ticket riêng",
 * và `agenda:present`). Thay vào đó, CHỈ chặn cứng ở `meeting:subscribe` —
 * đúng nơi lỗ hổng thật sự nằm (room này phát dữ liệu cuộc họp, bao gồm cho
 * khách). Kết nối vẫn được nhận nếu không có token, chỉ không lấy được
 * `identity` nên `meeting:subscribe` sẽ từ chối.
 */
@WebSocketGateway({
  path: process.env['WS_PATH'] ?? '/ws',
  cors: {
    origin: (
      process.env['WS_CORS_ORIGIN'] ??
      'http://localhost:5173,http://localhost:3000'
    )
      .split(',')
      .map((o: string) => o.trim()),
    credentials: true,
  },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly authConfigService: AuthConfigService,
    private readonly guestAccessConfigService: GuestAccessConfigService,
    private readonly guestAccessCacheService: GuestAccessCacheService,
    private readonly guestAttendanceService: GuestAttendanceService,
    private readonly dataSource: DataSource,
    private readonly authzReadRepository: AuthzReadRepository,
  ) {}

  afterInit(server: Server): void {
    const wsEnabled = this.configService.get<boolean>('WS_ENABLED', true);
    if (!wsEnabled) {
      this.logger.warn(
        'WS_ENABLED=false — WebSocket gateway initialized but disabled.',
      );
    } else {
      this.logger.log('EventsGateway initialized — WebSocket server ready.');
    }
    void server;
  }

  async handleConnection(client: Socket): Promise<void> {
    this.logger.debug(`[WS] Client connected: ${client.id}`);
    const identity = await this.resolveIdentity(client);
    (client.data as { identity?: SocketIdentity | null }).identity = identity;
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`[WS] Client disconnected: ${client.id}`);
    const identity = (client.data as { identity?: SocketIdentity | null })
      .identity;
    if (identity?.type === 'guest') {
      // Best-effort — không await để không giữ handler disconnect.
      void this.guestAttendanceService.logLeave({
        externalParticipantId: identity.externalParticipantId,
        meetingId: identity.meetingId,
        jti: identity.jti,
      });
    }
  }

  /**
   * Thử verify token nhân viên trước (secret nội bộ), fallback sang token
   * khách (secret riêng, spec FR-GLA-020). KHÔNG throw — trả `null` nếu cả 2
   * đều thất bại hoặc không có token, để không phá vỡ các luồng WS khác
   * chưa yêu cầu auth (xem doc class).
   */
  private async resolveIdentity(
    client: Socket,
  ): Promise<SocketIdentity | null> {
    const token = this.extractToken(client);
    if (!token) return null;

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(
        token,
        { secret: this.authConfigService.getAccessTokenSecret() },
      );
      if (payload?.sub) {
        return { type: 'employee', userId: payload.sub };
      }
    } catch {
      // không phải token nhân viên hợp lệ — thử token khách
    }

    try {
      const payload = await this.jwtService.verifyAsync<GuestJwtPayload>(
        token,
        { secret: this.guestAccessConfigService.getGuestTokenSecret() },
      );
      if (payload?.typ === GUEST_TOKEN_TYPE) {
        const isRevoked = await this.guestAccessCacheService.isSessionRevoked(
          payload.jti,
        );
        if (isRevoked) return null;
        return {
          type: 'guest',
          externalParticipantId: payload.sub,
          meetingId: payload.mid,
          jti: payload.jti,
        };
      }
    } catch {
      // không phải token khách hợp lệ
    }

    return null;
  }

  private extractToken(client: Socket): string | undefined {
    const authToken: unknown = client.handshake.auth?.['token'];
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }
    const queryToken: unknown = client.handshake.query?.['token'];
    if (typeof queryToken === 'string' && queryToken.length > 0) {
      return queryToken;
    }
    return undefined;
  }

  /**
   * IRP-001 (#40): client subscribe nhận realtime presence của 1 cuộc họp.
   * Room socket.io = ivss:meeting:<meetingId> — khớp emitToRoom phía ingestion.
   * KHÔNG auth ở đây (OWED-BLOCKER C2: WS auth handshake = ticket riêng;
   * realtime presence chỉ bật prod sau khi có auth — gate IVSS_REALTIME_ENABLED OFF mặc định).
   */
  @SubscribeMessage('ivss:subscribe')
  async handleIvssSubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean; room?: string }> {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    // Kênh này đẩy realtime họ tên + giờ vào/ra phòng họp. Trước đây KHÔNG kiểm tra danh tính:
    // socket ẩn danh (không token) cũng nghe được. Nay cùng quy tắc với meeting:subscribe cho
    // tài khoản nội bộ: phải là chủ trì / người tham dự cuộc họp.
    const identity = (client.data as { identity?: SocketIdentity | null })
      .identity;
    if (!identity || identity.type !== 'employee') {
      this.logger.warn(
        `[WS] ivss:subscribe rejected — no valid employee identity (socket=${client.id}, meetingId=${meetingId})`,
      );
      return { ok: false };
    }
    const isParticipant = await this.isEmployeeMeetingParticipant(
      identity.userId,
      meetingId,
    );
    if (!isParticipant) {
      this.logger.warn(
        `[WS] ivss:subscribe rejected — user ${identity.userId} is not host/participant of meeting ${meetingId}`,
      );
      return { ok: false };
    }
    const room = IVSS_MEETING_ROOM(meetingId);
    void client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('ivss:unsubscribe')
  handleIvssUnsubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean; room?: string } {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    const room = IVSS_MEETING_ROOM(meetingId);
    void client.leave(room);
    return { ok: true, room };
  }

  /**
   * GLA-001 (FR-GLA-036): điểm chặn thật sự. Nhân viên phải là
   * participant/host của meetingId; khách phải khớp đúng `mid` trong token.
   * Không có identity hợp lệ, hoặc sai phạm vi → từ chối, KHÔNG join room,
   * ghi log cảnh báo (NFR-GLA-011 — tín hiệu dò quét/leo thang).
   */
  @SubscribeMessage('meeting:subscribe')
  async handleMeetingSubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean; room?: string }> {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }

    const identity = (client.data as { identity?: SocketIdentity | null })
      .identity;
    if (!identity) {
      this.logger.warn(
        `[WS] meeting:subscribe rejected — no valid identity (socket=${client.id}, meetingId=${meetingId})`,
      );
      return { ok: false };
    }

    if (identity.type === 'guest') {
      if (identity.meetingId !== meetingId) {
        this.logger.warn(
          `[WS] meeting:subscribe rejected — GUEST_MEETING_SCOPE_MISMATCH (ep=${identity.externalParticipantId}, tokenMid=${identity.meetingId}, requested=${meetingId})`,
        );
        return { ok: false };
      }
    } else {
      const isParticipant = await this.isEmployeeMeetingParticipant(
        identity.userId,
        meetingId,
      );
      if (!isParticipant) {
        this.logger.warn(
          `[WS] meeting:subscribe rejected — user ${identity.userId} is not host/participant of meeting ${meetingId}`,
        );
        return { ok: false };
      }
    }

    const room = MEETING_ROOM(meetingId);
    void client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('meeting:unsubscribe')
  handleMeetingUnsubscribe(
    @MessageBody() body: { meetingId?: string },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean; room?: string } {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    const room = MEETING_ROOM(meetingId);
    void client.leave(room);
    return { ok: true, room };
  }

  /**
   * Cho phép bất kỳ nhân viên đã đăng nhập nhận realtime update dành riêng
   * cho họ — hàng đợi phê duyệt (`meeting_request.updated`) VÀ chuông thông
   * báo chung (`notification.created`, xem NotificationsService.createNotification).
   * Room = `user:{userId}` — CHỈ tự subscribe cho chính mình (bỏ qua mọi
   * userId trong body), server chỉ emit vào room này những sự kiện đã lọc
   * đúng theo `identity.userId` nên không cần thêm permission gate: join
   * room của chính mình không lộ dữ liệu của người khác.
   * [Sửa 2026-08-21] Bỏ yêu cầu quyền `meeting_request.read` — gate này chặn
   * luôn cả nhân viên thường (không có quyền đó) nhận thông báo no-show/biên
   * bản/... vốn không liên quan gì đến hàng đợi phê duyệt.
   */
  @SubscribeMessage('user:subscribe')
  handleUserSubscribe(@ConnectedSocket() client: Socket): {
    ok: boolean;
    room?: string;
  } {
    const identity = (client.data as { identity?: SocketIdentity | null })
      .identity;
    if (!identity || identity.type !== 'employee') {
      this.logger.warn(
        `[WS] user:subscribe rejected — no valid employee identity (socket=${client.id})`,
      );
      return { ok: false };
    }

    const room = USER_ROOM(identity.userId);
    void client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('user:unsubscribe')
  handleUserUnsubscribe(@ConnectedSocket() client: Socket): {
    ok: boolean;
    room?: string;
  } {
    const identity = (client.data as { identity?: SocketIdentity | null })
      .identity;
    if (!identity || identity.type !== 'employee') {
      return { ok: false };
    }
    const room = USER_ROOM(identity.userId);
    void client.leave(room);
    return { ok: true, room };
  }

  /**
   * B2 (Zone realtime): client subscribe nhận "có sự kiện zone mới" (mirror
   * meeting:subscribe/FR-GLA-036) — dùng để FE (ZoneManagement) refetch ngay
   * thay vì chỉ đợi polling. Room = zone:<zoneId>. Auth THẬT ngay từ đầu
   * (KHÁC ivss:subscribe cũ — không auth): chỉ nhân viên có permission
   * 'zones.gate_log.read' (đúng permission đang gate HTTP route
   * admin/gate-access-logs, xem gate-access-log.controller.ts) mới được join.
   * Khách (guest) KHÔNG có use-case xem zone nội bộ → luôn từ chối.
   */
  @SubscribeMessage('zone:subscribe')
  async handleZoneSubscribe(
    @MessageBody() body: { zoneId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean; room?: string }> {
    const zoneId = body?.zoneId;
    if (typeof zoneId !== 'string' || !UUID_RE.test(zoneId)) {
      return { ok: false };
    }

    const identity = (client.data as { identity?: SocketIdentity | null })
      .identity;
    if (!identity || identity.type !== 'employee') {
      this.logger.warn(
        `[WS] zone:subscribe rejected — no valid employee identity (socket=${client.id}, zoneId=${zoneId})`,
      );
      return { ok: false };
    }

    const { permissions } =
      await this.authzReadRepository.getEffectiveRolesAndPermissions(
        identity.userId,
      );
    if (!permissions.includes('zones.gate_log.read')) {
      this.logger.warn(
        `[WS] zone:subscribe rejected — user ${identity.userId} thiếu quyền zones.gate_log.read`,
      );
      return { ok: false };
    }

    const room = ZONE_ROOM(zoneId);
    void client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage('zone:unsubscribe')
  handleZoneUnsubscribe(
    @MessageBody() body: { zoneId?: string },
    @ConnectedSocket() client: Socket,
  ): { ok: boolean; room?: string } {
    const zoneId = body?.zoneId;
    if (typeof zoneId !== 'string' || !UUID_RE.test(zoneId)) {
      return { ok: false };
    }
    const room = ZONE_ROOM(zoneId);
    void client.leave(room);
    return { ok: true, room };
  }

  private async isEmployeeMeetingParticipant(
    userId: string,
    meetingId: string,
  ): Promise<boolean> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId } });
    if (!meeting || meeting.deletedAt) return false;
    if (meeting.hostId === userId) return true;

    const participant = await this.dataSource
      .getRepository(MeetingParticipantEntity)
      .findOne({ where: { meetingId, userId } });
    return !!participant;
  }

  /**
   * feat-live-meeting-agenda-presentation (2026-08-05): host "trình chiếu" 1
   * agenda attachment cho mọi người trong phòng họp đang xem tự do — không
   * đồng bộ pixel màn hình (không screen-share), chỉ broadcast "đang xem file
   * nào" để client tự mở link `downloadUrl` tương ứng (đã có sẵn qua
   * `GET /media-files/:fileId`). Không có business validation/persist ở đây —
   * cùng mức tin cậy với `meeting:subscribe` TRƯỚC bản vá GLA-001. FE chịu
   * trách nhiệm chỉ hiện nút "Trình chiếu" cho host.
   */
  @SubscribeMessage('agenda:present')
  handleAgendaPresent(
    @MessageBody()
    body: {
      meetingId?: string;
      agendaId?: string;
      fileId?: string;
      fileName?: string;
      presentedBy?: string;
    },
  ): { ok: boolean } {
    const { meetingId, agendaId, fileId } = body ?? {};
    if (
      typeof meetingId !== 'string' ||
      !UUID_RE.test(meetingId) ||
      typeof agendaId !== 'string' ||
      !UUID_RE.test(agendaId) ||
      typeof fileId !== 'string' ||
      !UUID_RE.test(fileId)
    ) {
      return { ok: false };
    }
    const room = MEETING_ROOM(meetingId);
    this.server.to(room).emit('agenda:presented', {
      meetingId,
      agendaId,
      fileId,
      fileName: typeof body.fileName === 'string' ? body.fileName : null,
      presentedBy:
        typeof body.presentedBy === 'string' ? body.presentedBy : null,
      presentedAt: new Date().toISOString(),
    });
    return { ok: true };
  }

  /**
   * Host tắt trình chiếu (hoặc chuyển sang mục agenda khác) — broadcast để
   * mọi client gỡ banner "đang trình chiếu" đang hiện.
   */
  @SubscribeMessage('agenda:present_stop')
  handleAgendaPresentStop(@MessageBody() body: { meetingId?: string }): {
    ok: boolean;
  } {
    const meetingId = body?.meetingId;
    if (typeof meetingId !== 'string' || !UUID_RE.test(meetingId)) {
      return { ok: false };
    }
    const room = MEETING_ROOM(meetingId);
    this.server.to(room).emit('agenda:present_stopped', { meetingId });
    return { ok: true };
  }
}
