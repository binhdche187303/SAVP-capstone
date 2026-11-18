import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service.js';

const READ_SET_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 ngày (§3B PLAN_THUC_THI_P1)

export interface NotificationReadState {
  readIds: Set<string>;
  readAllAt: Date | null;
  /** Nhóm đã đọc: "loại|YYYY-MM-DD" (ngày theo giờ VN) — đọc cả nhóm 1 lần bấm. */
  readGroups?: Set<string>;
}

/** Ngày (YYYY-MM-DD) theo giờ Việt Nam — khớp to_char(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'). */
export const vnDayOf = (d: Date): string =>
  new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

export const notificationGroupKey = (type: string, day: string): string =>
  `${type}|${day}`;

/**
 * NotificationReadStateService (BE-07) — trạng thái "đã đọc" theo user, lưu hoàn toàn ở Redis.
 *
 * Bảng `notifications` KHÔNG có cột đã đọc theo user (chỉ `read_count` int +
 * `recipient_user_ids_json`); Product Owner đã từ chối tạo bảng `notification_reads`
 * (2026-07-18, xem `spec/features/notifications/feat-notification-inbox/spec.md`).
 *
 * Khóa Redis:
 * - `notif:read:{userId}` — SET chứa notificationId đã đọc. TTL 90 ngày, refresh mỗi lần ghi.
 * - `notif:readall:{userId}` — string ISO timestamp mốc "đọc tất cả". Notification có
 *   `created_at <= mốc` ⇒ coi như đã đọc (không nhồi hàng nghìn id riêng lẻ vào SET).
 * - `isRead = (id ∈ SET) || (createdAt <= readAllAt)`.
 *
 * Fail-soft toàn bộ: Redis lỗi (đọc hoặc ghi) → log lỗi, KHÔNG throw. Đọc lỗi → coi như
 * chưa đọc (isRead=false). Ghi lỗi → API vẫn trả 200 (best-effort, giống pattern audit log
 * trong `DepartmentsService`) — tránh 1 tính năng phụ (đánh dấu đã đọc) làm gãy luồng chính.
 */
@Injectable()
export class NotificationReadStateService {
  private readonly logger = new Logger(NotificationReadStateService.name);

  constructor(private readonly redisService: RedisService) {}

  private readKey(userId: string): string {
    return `notif:read:${userId}`;
  }

  private readAllKey(userId: string): string {
    return `notif:readall:${userId}`;
  }

  private readGroupKey(userId: string): string {
    return `notif:readgrp:${userId}`;
  }

  /** Đánh dấu cả nhóm (loại + ngày) là đã đọc — không phải lưu từng id (1 ngày có thể hàng nghìn). */
  async markGroupRead(
    userId: string,
    type: string,
    day: string,
  ): Promise<void> {
    try {
      const key = this.readGroupKey(userId);
      await this.redisService.sadd(key, notificationGroupKey(type, day));
      await this.redisService.expire(key, READ_SET_TTL_SECONDS);
    } catch (error) {
      this.logger.error(
        `markGroupRead failed for user=${userId} group=${type}|${day}: ${(error as Error).message}`,
      );
    }
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    try {
      const key = this.readKey(userId);
      await this.redisService.sadd(key, notificationId);
      await this.redisService.expire(key, READ_SET_TTL_SECONDS);
    } catch (error) {
      this.logger.error(
        `markRead failed for user=${userId} notification=${notificationId}: ${(error as Error).message}`,
      );
    }
  }

  async markAllRead(userId: string): Promise<void> {
    try {
      await this.redisService.set(
        this.readAllKey(userId),
        new Date().toISOString(),
      );
    } catch (error) {
      this.logger.error(
        `markAllRead failed for user=${userId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Đọc trạng thái đã đọc MỘT LẦN cho cả trang — dùng cho listMyNotifications
   * (cấm N+1: không gọi Redis riêng từng notification).
   */
  async getReadState(userId: string): Promise<NotificationReadState> {
    try {
      const [ids, readAllRaw, groups] = await Promise.all([
        this.redisService.smembers(this.readKey(userId)),
        this.redisService.get(this.readAllKey(userId)),
        this.redisService.smembers(this.readGroupKey(userId)),
      ]);
      return {
        readIds: new Set(ids),
        readAllAt: readAllRaw ? new Date(readAllRaw) : null,
        readGroups: new Set(groups ?? []),
      };
    } catch (error) {
      this.logger.error(
        `getReadState failed for user=${userId}, fail-soft to unread: ${(error as Error).message}`,
      );
      return { readIds: new Set(), readAllAt: null, readGroups: new Set() };
    }
  }

  computeIsRead(
    state: NotificationReadState,
    notificationId: string,
    createdAt: Date,
    notificationType?: string,
  ): boolean {
    if (state.readIds.has(notificationId)) return true;
    if (
      notificationType &&
      state.readGroups?.has(
        notificationGroupKey(notificationType, vnDayOf(createdAt)),
      )
    ) {
      return true;
    }
    if (state.readAllAt && createdAt.getTime() <= state.readAllAt.getTime()) {
      return true;
    }
    return false;
  }

  /** Kiểm tra 1 notification — dùng cho getMyNotificationDetail (1 item, không cần batch). */
  async isRead(
    userId: string,
    notificationId: string,
    createdAt: Date,
    notificationType?: string,
  ): Promise<boolean> {
    const state = await this.getReadState(userId);
    return this.computeIsRead(
      state,
      notificationId,
      createdAt,
      notificationType,
    );
  }
}
