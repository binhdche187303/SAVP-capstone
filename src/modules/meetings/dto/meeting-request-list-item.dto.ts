import { Expose, Type } from 'class-transformer';
import { UserSummaryDto } from './user-summary.dto.js';
import { RoomSummaryDto } from './room-summary.dto.js';
import { MeetingRequestType } from '../entities/meeting-request.entity.js';
import { ConflictDetailDto } from './conflict-detail.dto.js';
import {
  ParticipantConflictDetailDto,
  ParticipantConflictSummaryDto,
} from './participant-conflict-detail.dto.js';

const EDIT_REQUEST_TYPES: readonly MeetingRequestType[] = [
  MeetingRequestType.UPDATE_TIME,
  MeetingRequestType.UPDATE_ROOM,
];

export class MeetingRequestListItemDto {
  @Expose()
  id: string;

  @Expose()
  requestCode: string;

  @Expose()
  requestType: string;

  @Expose()
  approvalStatus: string;

  @Expose()
  requestedAt: Date;

  @Expose()
  requestedStartTime: Date | null;

  @Expose()
  requestedEndTime: Date | null;

  @Expose()
  conflictCheckStatus: string;

  @Expose()
  conflictSummary: Record<string, unknown> | null;

  /**
   * Nhóm E (2026-08-08) — bản "làm giàu" của conflictSummary CHỈ khi đó là
   * xung đột phòng (bookingId/roomId), enrich sang tên phòng/tên cuộc
   * họp/tên host để Manager không phải tự tra id. null nếu không có xung đột
   * phòng nào (kể cả khi conflictSummary có dữ liệu xung đột participant).
   */
  @Expose()
  conflictDetails: ConflictDetailDto[] | null;

  /**
   * Nhóm F (2026-08-16) — request PENDING khác đang xin cùng phòng/khung giờ
   * (KHÔNG phải APPROVED/ACTIVE — xem conflictDetails). Chỉ mang tính cảnh
   * báo mềm cho Manager biết có nhiều request đang tranh cùng slot, KHÔNG
   * chặn approve() — Manager vẫn là người quyết duyệt request nào. FE nên
   * hiện badge/banner màu vàng-cam riêng, không gộp chung với conflictDetails
   * (màu đỏ, xung đột với booking đã duyệt) để tránh Manager hiểu nhầm mức độ
   * nghiêm trọng.
   */
  @Expose()
  pendingConflictDetails: ConflictDetailDto[] | null;

  /**
   * MKM-PCONF-01 (2026-08-22) — xung đột NGƯỜI THAM DỰ, check TƯƠI và gom
   * theo cuộc họp gây trùng (kèm danh sách người + thông tin cuộc họp đó).
   * Thay cho việc FE phải suy ra từ `conflictCheckStatus === 'warning'` — cờ
   * đó chỉ nói "có trùng ai đó" tại thời điểm tạo, không nói trùng với ai và
   * ở cuộc họp nào.
   *
   * CẢNH BÁO MỀM: khác `conflictDetails` (xung đột phòng, approve() chặn),
   * Manager vẫn duyệt được CẢ HAI cuộc họp — FE chỉ cần hỏi xác nhận.
   */
  @Expose()
  participantConflictDetails: ParticipantConflictDetailDto[] | null;

  /** Số liệu gộp sẵn của `participantConflictDetails` cho badge/dialog. */
  @Expose()
  participantConflictSummary: ParticipantConflictSummaryDto | null;

  @Expose()
  decisionAt: Date | null;

  @Expose()
  rejectionReason: string | null;

  @Expose()
  requestedBy: UserSummaryDto;

  @Expose()
  targetRoom: RoomSummaryDto | null;

  @Expose()
  decisionBy: UserSummaryDto | null;

  /**
   * `startTime`/`endTime` la gio HIEN TAI cua cuoc hop. Bat buoc phai co vi
   * `requestedStartTime` chi khac null khi request xin DOI gio (UPDATE_TIME);
   * voi request duyet thuong no la null va FE khong con gi de hien thi.
   */
  @Expose()
  meeting: {
    id: string;
    title: string;
    roomId: string | null;
    hostId: string | null;
    startTime: Date | null;
    endTime: Date | null;
    calendarType?: string;
    attendeeComposition?: string | null;
  } | null;

  /**
   * F-R3 — true nếu đây là yêu cầu CHỈNH SỬA một meeting đã SCHEDULED trước đó
   * (UPDATE_TIME/UPDATE_ROOM), false nếu là yêu cầu đặt phòng MỚI (CREATE_MEETING).
   * Giúp Manager không nhầm 1 request chỉnh sửa với 1 booking mới hoàn toàn.
   */
  @Expose()
  isEditRequest: boolean;

  /** Nhãn hiển thị sẵn cho FE, tính từ requestType — không cần FE tự map enum. */
  @Expose()
  displayLabel: string;

  /**
   * Giá trị TRƯỚC khi đổi (đang giữ trên meeting hiện tại) — CHỈ có khi
   * isEditRequest=true, vì start_time/room_id của meeting chưa từng bị ghi đè
   * lúc đang PENDING_APPROVAL (xem updateMeetingTime/updateMeetingRoom).
   */
  @Expose()
  oldStartTime: Date | null;

  @Expose()
  oldEndTime: Date | null;

  @Expose()
  oldRoomId: string | null;

  /** Giá trị MỚI đang xin đổi — CHỈ có khi isEditRequest=true. */
  @Expose()
  newStartTime: Date | null;

  @Expose()
  newRoomId: string | null;

  constructor(
    id: string,
    requestCode: string,
    requestType: string,
    approvalStatus: string,
    requestedAt: Date,
    requestedStartTime: Date | null,
    requestedEndTime: Date | null,
    conflictCheckStatus: string,
    conflictSummary: Record<string, unknown> | null,
    conflictDetails: ConflictDetailDto[] | null,
    pendingConflictDetails: ConflictDetailDto[] | null,
    decisionAt: Date | null,
    rejectionReason: string | null,
    requestedBy: UserSummaryDto,
    targetRoom: RoomSummaryDto | null,
    decisionBy: UserSummaryDto | null,
    meeting: {
      id: string;
      title: string;
      roomId: string | null;
      hostId: string | null;
      startTime: Date | null;
      endTime: Date | null;
      calendarType?: string;
      attendeeComposition?: string | null;
    } | null,
    oldMeetingSnapshot: {
      startTime: Date | null;
      endTime: Date | null;
      roomId: string | null;
    } | null = null,
    participantConflictDetails: ParticipantConflictDetailDto[] | null = null,
    participantConflictSummary: ParticipantConflictSummaryDto | null = null,
  ) {
    this.id = id;
    this.requestCode = requestCode;
    this.requestType = requestType;
    this.approvalStatus = approvalStatus;
    this.requestedAt = requestedAt;
    this.requestedStartTime = requestedStartTime;
    this.requestedEndTime = requestedEndTime;
    this.conflictCheckStatus = conflictCheckStatus;
    this.conflictSummary = conflictSummary;
    this.conflictDetails = conflictDetails;
    this.pendingConflictDetails = pendingConflictDetails;
    this.participantConflictDetails = participantConflictDetails;
    this.participantConflictSummary = participantConflictSummary;
    this.decisionAt = decisionAt;
    this.rejectionReason = rejectionReason;
    this.requestedBy = requestedBy;
    this.targetRoom = targetRoom;
    this.decisionBy = decisionBy;
    this.meeting = meeting;

    this.isEditRequest = EDIT_REQUEST_TYPES.includes(
      requestType as MeetingRequestType,
    );
    this.displayLabel = this.isEditRequest
      ? 'Yêu cầu chỉnh sửa'
      : 'Yêu cầu đặt phòng mới';

    if (this.isEditRequest && oldMeetingSnapshot) {
      this.oldStartTime = oldMeetingSnapshot.startTime;
      this.oldEndTime = oldMeetingSnapshot.endTime;
      this.oldRoomId = oldMeetingSnapshot.roomId;
      this.newStartTime = requestedStartTime;
      this.newRoomId = targetRoom?.id ?? null;
    } else {
      this.oldStartTime = null;
      this.oldEndTime = null;
      this.oldRoomId = null;
      this.newStartTime = null;
      this.newRoomId = null;
    }
  }
}
