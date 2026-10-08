/**
 * Barrel re-export for all TypeORM entities in the project.
 *
 * Usage: import { UserEntity, MeetingEntity } from '../../database/entities/index.js'
 *
 * NOTE: Each entity is still registered via TypeOrmModule.forFeature() in its own
 * module. autoLoadEntities: true in DatabaseModule handles entity discovery.
 * This file is for CONVENIENCE IMPORT ONLY — it is optional, not required for build.
 *
 * IMPORTANT: If you encounter "Cannot find module" errors when importing from here,
 * import directly from the entity file instead:
 *   import { UserEntity } from '../accounts/entities/user.entity.js';
 */

// Group 01: Identity & Access
export { DepartmentEntity } from '../../modules/accounts/entities/department.entity.js';
export {
  UserEntity,
  EmploymentStatus,
  AccountStatus,
} from '../../modules/accounts/entities/user.entity.js';
export { RoleEntity } from '../../modules/accounts/entities/role.entity.js';
export { PermissionEntity } from '../../modules/accounts/entities/permission.entity.js';
export { UserRoleEntity } from '../../modules/accounts/entities/user-role.entity.js';
export { RolePermissionEntity } from '../../modules/accounts/entities/role-permission.entity.js';
export {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../../modules/accounts/entities/face-profile.entity.js';

// Group 02: Meeting Core & Scheduling
export {
  MeetingRecurrenceRuleEntity,
  RecurrenceType,
} from '../../modules/meetings/entities/meeting-recurrence-rule.entity.js';
export {
  MeetingEntity,
  MeetingType,
  MeetingMode,
  MeetingPriority,
  MeetingStatus,
  MeetingVisibilityLevel,
} from '../../modules/meetings/entities/meeting.entity.js';
export {
  MeetingRequestEntity,
  MeetingRequestType,
  ApprovalMode,
  ApprovalStatus,
  ConflictCheckStatus,
} from '../../modules/meetings/entities/meeting-request.entity.js';
export {
  MeetingParticipantEntity,
  ParticipantRole,
  InvitationStatus,
  ParticipantAttendanceStatus,
} from '../../modules/meetings/entities/meeting-participant.entity.js';
export { MeetingExternalParticipantEntity } from '../../modules/meetings/entities/meeting-external-participant.entity.js';
export {
  MeetingAgendaEntity,
  AgendaStatus,
} from '../../modules/meetings/entities/meeting-agenda.entity.js';
export {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../modules/meetings/entities/meeting-event.entity.js';
export {
  MeetingNoteEntity,
  MeetingNoteType,
} from '../../modules/meetings/entities/meeting-note.entity.js';

// Group 03: Room & Utilization
export {
  RoomEntity,
  RoomType,
  RoomStatus,
} from '../../modules/rooms/entities/room.entity.js';
export {
  RoomBookingEntity,
  BookingType,
  RoomBookingStatus,
} from '../../modules/rooms/entities/room-booking.entity.js';
export {
  RoomBookingUsageEntity,
  RoomUsageStatus,
  OccupancySource,
} from '../../modules/rooms/entities/room-booking-usage.entity.js';
export {
  NoShowCaseEntity,
  NoShowDetectionStatus,
  NoShowResolutionStatus,
} from '../../modules/rooms/entities/no-show-case.entity.js';
export { RoomEventEntity } from '../../modules/rooms/entities/room-event.entity.js';

// Group 04: Equipment & IoT
export {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../../modules/equipment/entities/equipment.entity.js';
export {
  IoTDeviceEntity,
  IoTDeviceType,
  IoTDeviceStatus,
  IoTDeviceHealthStatus,
} from '../../modules/iot/entities/iot-device.entity.js';
export { DeviceUserMappingEntity } from '../../modules/iot/entities/device-user-mapping.entity.js';
export {
  IoTDeviceEventEntity,
  IoTDeviceEventType,
  IoTEventSourceProtocol,
  IoTEventSeverity,
  IoTEventProcessedStatus,
} from '../../modules/iot/entities/iot-device-event.entity.js';
export {
  CaptureSessionEntity,
  CaptureSessionStatus,
} from '../../modules/iot/entities/capture-session.entity.js';
export {
  CaptureSessionChannelEntity,
  AudioSourceType,
  CaptureChannelStatus,
} from '../../modules/iot/entities/capture-session-channel.entity.js';

// Group 05: Attendance & Presence
export {
  AttendanceRecordEntity,
  CheckInMethod,
  AttendanceSource,
  AttendanceRecordStatus,
} from '../../modules/attendance/entities/attendance-record.entity.js';
export { AttendanceEventEntity } from '../../modules/attendance/entities/attendance-event.entity.js';
export {
  PresenceSnapshotEntity,
  PresenceStatus,
  PresenceSourceType,
} from '../../modules/presence/entities/presence-snapshot.entity.js';

// Group 06: Recording, Media & Transcription
export {
  MediaFileEntity,
  MediaFileType,
  StorageProvider,
  MediaVisibilityLevel,
} from '../../modules/recording/entities/media-file.entity.js';
export {
  RecordingConfigEntity,
  RecordingConfigStatus,
  AudioSourceMode,
} from '../../modules/recording/entities/recording-config.entity.js';
export {
  RecordingSessionEntity,
  RecordingSessionType,
  RecordingSourceType,
  RecordingSessionStatus,
} from '../../modules/recording/entities/recording-session.entity.js';
export {
  RecordingSegmentEntity,
  RecordingSegmentStatus,
} from '../../modules/recording/entities/recording-segment.entity.js';
export {
  TranscriptEntity,
  TranscriptSecurityStatus,
  TranscriptStatus,
} from '../../modules/transcription/entities/transcript.entity.js';

// Group 07: Minutes
export {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
} from '../../modules/minutes/entities/meeting-minutes.entity.js';

// Group 08: Notification & Administration
export {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
  NotificationPriority,
  NotificationDeliveryStatus,
} from '../../modules/notifications/entities/notification.entity.js';
export {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../modules/administration/entities/audit-log.entity.js';
export {
  SystemConfigEntity,
  SystemConfigValueType,
} from '../../modules/administration/entities/system-config.entity.js';
export {
  BackgroundJobEntity,
  BackgroundJobType,
  BackgroundJobStatus,
} from '../../modules/administration/entities/background-job.entity.js';

// Group: Academic (Học vụ — ACD-001)
export {
  SemesterEntity,
  SemesterStatus,
} from '../../modules/academic/entities/semester.entity.js';
export { SubjectEntity } from '../../modules/academic/entities/subject.entity.js';
export { StudyShiftEntity } from '../../modules/academic/entities/study-shift.entity.js';
export {
  StudentEntity,
  StudentStudyStatus,
} from '../../modules/academic/entities/student.entity.js';
export {
  ClassSectionEntity,
  ClassSectionStatus,
} from '../../modules/academic/entities/class-section.entity.js';
export {
  ClassEnrollmentEntity,
  ClassEnrollmentStatus,
} from '../../modules/academic/entities/class-enrollment.entity.js';
export {
  ClassSessionEntity,
  ClassSessionStatus,
} from '../../modules/academic/entities/class-session.entity.js';

// Group: KPI rollup (KPI-001)
export { KpiZoneHourlyEntity } from '../../modules/kpi-rollup/entities/kpi-zone-hourly.entity.js';
export { KpiVehicleHourlyEntity } from '../../modules/kpi-rollup/entities/kpi-vehicle-hourly.entity.js';
export { KpiVehiclePlateHourlyEntity } from '../../modules/kpi-rollup/entities/kpi-vehicle-plate-hourly.entity.js';
export { KpiRollupWatermarkEntity } from '../../modules/kpi-rollup/entities/kpi-rollup-watermark.entity.js';
