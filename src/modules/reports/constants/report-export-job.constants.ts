/**
 * report-export-job.constants.ts
 * Hằng số cho queue 'report-export' (đã đăng ký sẵn trong QueueModule)
 * và job name 'export:meeting-activity'.
 *
 * ARCH: Dùng đúng tên queue đã đăng ký - KHÔNG tạo queue mới.
 */

/** Khớp đúng tên queue đã đăng ký trong QueueModule (env QUEUE_REPORT_EXPORT) */
export const REPORT_EXPORT_QUEUE_NAME = 'report-export';

/** Job name cho meeting activity export */
export const MEETING_ACTIVITY_EXPORT_JOB_NAME = 'export:meeting-activity';

/** Job name cho room utilization export (UC-RUM-16) */
export const ROOM_UTILIZATION_EXPORT_JOB_NAME = 'export:room-utilization';

/** Job name cho gate access export (UC-127, Bước 5 SAVP) */
export const GATE_ACCESS_EXPORT_JOB_NAME = 'export:gate-access';

/** Job name cho vehicle export (UC-128, Bước 5 SAVP) */
export const VEHICLE_EXPORT_JOB_NAME = 'export:vehicle';

/** Job name cho security alert export (UC-129, Bước 5 SAVP) */
export const SECURITY_ALERT_EXPORT_JOB_NAME = 'export:security-alert';

/** Job name cho Trung tâm báo cáo (RPT-CENTER-BE-001, Task 11) */
export const REPORT_CENTER_EXPORT_JOB_NAME = 'export:report-center';

/** Job name cho lần chạy lịch gửi báo cáo (RPT-CENTER-BE-001, Task 15) */
export const REPORT_SCHEDULE_RUN_JOB_NAME = 'report-schedule:run';
