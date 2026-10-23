import { Injectable, Logger } from '@nestjs/common';
import { EventsGateway } from './events.gateway.js';

/**
 * WebsocketService — Helper emit events qua Socket.IO.
 *
 * Inject service này vào bất kỳ module nào cần push realtime event.
 * Không implement business realtime events tại đây.
 *
 * Naming convention cho rooms:
 * - User room:    `user:{userId}`
 * - Meeting room: `meeting:{meetingId}`
 * - Admin room:   `admin`
 */
@Injectable()
export class WebsocketService {
  private readonly logger = new Logger(WebsocketService.name);

  constructor(private readonly gateway: EventsGateway) {}

  /**
   * Emit event đến một room.
   * @param room  - tên room (VD: 'meeting:uuid', 'user:uuid')
   * @param event - tên event (VD: 'meeting.status_changed')
   * @param data  - payload
   */
  emitToRoom(room: string, event: string, data: unknown): void {
    if (!this.gateway.server) {
      this.logger.warn('[WS] Server not initialized — cannot emit event.');
      return;
    }
    this.gateway.server.to(room).emit(event, data);
    this.logger.debug(`[WS] Emitted "${event}" to room "${room}"`);
  }

  /**
   * Emit event đến user cụ thể qua user room.
   * @param userId - UUID của user
   * @param event  - tên event
   * @param data   - payload
   */
  emitToUser(userId: string, event: string, data: unknown): void {
    this.emitToRoom(`user:${userId}`, event, data);
  }

  /**
   * Phát tín hiệu thay đổi lượt khách. Payload chỉ là tín hiệu refetch,
   * không chứa dữ liệu khách nên mỗi màn hình vẫn phải đọc lại API có phân quyền.
   */
  emitVisitorVisitChanged(data: { visitId?: string; status?: string; kind?: string } = {}): void {
    this.broadcast('visitor.visit.changed', {
      ...data,
      occurredAt: new Date().toISOString(),
    });
  }

  /**
   * Broadcast event đến tất cả clients đang kết nối.
   * Dùng cẩn thận — chỉ cho admin broadcasts.
   */
  broadcast(event: string, data: unknown): void {
    if (!this.gateway.server) {
      this.logger.warn('[WS] Server not initialized — cannot broadcast event.');
      return;
    }
    this.gateway.server.emit(event, data);
    this.logger.debug(`[WS] Broadcast "${event}" to all clients`);
  }
}
