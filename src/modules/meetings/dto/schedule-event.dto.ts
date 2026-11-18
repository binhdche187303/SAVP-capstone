import { ScheduleRoomDto } from './schedule-room.dto.js';

export class ScheduleHostDto {
  id: string;
  fullName: string;

  constructor(data: ScheduleHostDto) {
    this.id = data.id;
    this.fullName = data.fullName;
  }
}

export class ScheduleEventDto {
  meetingId: string;
  meetingCode: string;
  title: string;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  userRole: 'organizer' | 'host' | 'attendee';
  room: ScheduleRoomDto | null;
  // Người chủ trì hiển thị = host nếu có, không thì fallback organizer
  // (khớp quy tắc resolveEffectiveUserRole ở getMySchedule()).
  host: ScheduleHostDto | null;
  recordingEnabled: boolean;
  colorKey: string;
  isCurrent: boolean;
  isPast: boolean;
  /** Lịch tuần UEL: UNIT | SCHOOL_LEADERSHIP | SCHOOL_OTHER. */
  calendarType?: string;

  constructor(data: ScheduleEventDto) {
    this.meetingId = data.meetingId;
    this.meetingCode = data.meetingCode;
    this.title = data.title;
    this.startTime = data.startTime;
    this.endTime = data.endTime;
    this.timezone = data.timezone;
    this.status = data.status;
    this.userRole = data.userRole;
    this.room = data.room;
    this.host = data.host;
    this.recordingEnabled = data.recordingEnabled;
    this.colorKey = data.colorKey;
    this.isCurrent = data.isCurrent;
    this.isPast = data.isPast;
    this.calendarType = data.calendarType;
  }
}
