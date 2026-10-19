// ── Meeting detail ──
export class DetailMeetingDto {
  meetingId: string;
  meetingCode: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string;
  timezone: string;
  status: string;
  recurrenceRuleId: string | null;
  parentMeetingId: string | null;
  attendanceEnabled?: boolean;
  reminderMinutes?: number;

  constructor(data: DetailMeetingDto) {
    this.meetingId = data.meetingId;
    this.meetingCode = data.meetingCode;
    this.title = data.title;
    this.description = data.description;
    this.startTime = data.startTime;
    this.endTime = data.endTime;
    this.timezone = data.timezone;
    this.status = data.status;
    this.recurrenceRuleId = data.recurrenceRuleId;
    this.parentMeetingId = data.parentMeetingId;
    this.attendanceEnabled = data.attendanceEnabled ?? true;
    this.reminderMinutes = data.reminderMinutes ?? 10;
  }
}

// ── Room detail ──
export class DetailRoomDto {
  id: string;
  roomName: string;
  roomCode: string;
  siteName: string | null;
  areaName: string | null;
  location: string | null;
  hasMicrophone: boolean;
  allowRecording: boolean;

  constructor(data: DetailRoomDto) {
    this.id = data.id;
    this.roomName = data.roomName;
    this.roomCode = data.roomCode;
    this.siteName = data.siteName;
    this.areaName = data.areaName;
    this.location = data.location;
    this.hasMicrophone = data.hasMicrophone;
    this.allowRecording = data.allowRecording;
  }
}

// ── User (organizer/host) ──
export class DetailUserDto {
  id: string;
  fullName: string;
  email: string;

  constructor(data: DetailUserDto) {
    this.id = data.id;
    this.fullName = data.fullName;
    this.email = data.email;
  }
}

// ── Participant ──
export class DetailParticipantDto {
  id: string;
  userId?: string;
  fullName: string;
  email: string;
  participantRole: string;
  invitationStatus: string;
  attendanceStatus: string;

  constructor(data: DetailParticipantDto) {
    this.id = data.id;
    this.userId = data.userId;
    this.fullName = data.fullName;
    this.email = data.email;
    this.participantRole = data.participantRole;
    this.invitationStatus = data.invitationStatus;
    this.attendanceStatus = data.attendanceStatus;
  }
}

// ── External participant ──
export class DetailExternalParticipantDto {
  name: string;
  email: string;

  constructor(data: DetailExternalParticipantDto) {
    this.name = data.name;
    this.email = data.email;
  }
}

// ── Agenda ──
export class DetailAgendaDto {
  id: string;
  title: string;
  durationMinutes: number | null;
  sortOrder: number;
  attachments: DetailAttachmentDto[];

  constructor(data: DetailAgendaDto) {
    this.id = data.id;
    this.title = data.title;
    this.durationMinutes = data.durationMinutes;
    this.sortOrder = data.sortOrder;
    this.attachments = data.attachments ?? [];
  }
}

// ── Attachment ──
export class DetailAttachmentDto {
  id: string;
  fileName: string;
  fileUrl: string | null;
  fileType: string;
  fileSize: string | null;

  constructor(data: DetailAttachmentDto) {
    this.id = data.id;
    this.fileName = data.fileName;
    this.fileUrl = data.fileUrl;
    this.fileType = data.fileType;
    this.fileSize = data.fileSize;
  }
}

// ── Recording config ──
export class DetailRecordingConfigDto {
  autoRecord: boolean;
  allowRecording: boolean;
  enableTranscription: boolean;

  constructor(data: DetailRecordingConfigDto) {
    this.autoRecord = data.autoRecord;
    this.allowRecording = data.allowRecording;
    this.enableTranscription = data.enableTranscription;
  }
}

// ── Main wrapper DTO ──
export class MyScheduleDetailDto {
  meeting: DetailMeetingDto;
  room: DetailRoomDto | null;
  organizer: DetailUserDto;
  host: DetailUserDto | null;
  secretary?: DetailUserDto | null;
  participants: DetailParticipantDto[];
  externalParticipants: DetailExternalParticipantDto[];
  agendas: DetailAgendaDto[];
  attachments: DetailAttachmentDto[];
  recordingConfig: DetailRecordingConfigDto | null;
  userRole: string;

  constructor(data: MyScheduleDetailDto) {
    this.meeting = data.meeting;
    this.room = data.room;
    this.organizer = data.organizer;
    this.host = data.host;
    this.secretary = data.secretary ?? null;
    this.participants = data.participants;
    this.externalParticipants = data.externalParticipants;
    this.agendas = data.agendas;
    this.attachments = data.attachments;
    this.recordingConfig = data.recordingConfig;
    this.userRole = data.userRole;
  }
}
