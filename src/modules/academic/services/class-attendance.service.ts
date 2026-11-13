import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HgVisionRecognizedFace, HgVisionService } from './hgvision.service.js';

type RoleCode =
  | 'SYSTEM_ADMIN'
  | 'ADMIN'
  | 'BUSINESS_ADMIN'
  | 'TEACHER'
  | 'STUDENT'
  | string;

interface ClassRow {
  id: string;
  code: string;
  subject_code: string;
  subject: string;
  semester: string;
  semester_code: string | null;
  academic_year: string | null;
  semester_start: string | null;
  semester_end: string | null;
  semester_status: string | null;
  teacher: string | null;
  room: string | null;
  schedule: string | null;
  schedule_weekday: number | null;
  student_count: string;
  administrative_classes: string[] | null;
  administrative_class_stats: { name: string; count: number }[] | null;
}

interface StudentRow {
  id: string;
  user_id: string;
  code: string;
  name: string;
  email: string | null;
  administrative_class: string | null;
}

interface AttendanceRow {
  id: string | null;
  student_id: string;
  check_in_at: Date | string | null;
  check_out_at: Date | string | null;
  status: string | null;
  confidence: number | null;
  evidence_image: string | null;
  source: string | null;
  manual_reason: string | null;
  actor_user_id: string | null;
  zone_id: string | null;
  camera_group_id: string | null;
  camera_id: string | null;
}

interface SessionRow {
  id: string;
  session_date: string;
  start_clock: string;
  end_clock: string;
  start_time: Date | string;
  end_time: Date | string;
  status: string;
  source: string;
  period_start: number | null;
  period_count: number | null;
  class_id: string;
  class_code: string;
  subject_code: string;
  subject_name: string;
  semester_name: string;
  teacher: string | null;
  room: string | null;
  room_id: string | null;
  student_count: number | string | null;
}

/** Lịch GV/SV xem theo tuần/tháng ⇒ giới hạn khoảng ngày để query nhẹ. */
const MAX_SESSION_RANGE_DAYS = 62;

const DEFAULT_CLASS_START_TIME = '08:00';
const DEFAULT_LATE_THRESHOLD_MINUTES = 10;
const DEFAULT_AUTO_SCAN_INTERVAL_SECONDS = 4;
const CLASS_ATTENDANCE_START_TIME_KEY = 'class_attendance.default_start_time';
const CLASS_ATTENDANCE_LATE_THRESHOLD_KEY =
  'class_attendance.late_threshold_minutes';
const CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY =
  'class_attendance.auto_scan_interval_seconds';
/**
 * Ngưỡng cảnh báo vắng (% số buổi theo TKB cả học kỳ). 20% là mức TẠM — chưa chốt theo quy chế UEL,
 * admin chỉnh qua PATCH /class-attendance/settings { absenceWarningPercent }.
 */
const CLASS_ATTENDANCE_ABSENCE_WARNING_KEY =
  'class_attendance.absence_warning_percent';
const DEFAULT_ABSENCE_WARNING_PERCENT = 20;
const REPORT_ROLES: RoleCode[] = [
  'TEACHER',
  'SYSTEM_ADMIN',
  'ADMIN',
  'BUSINESS_ADMIN',
];

type AbsenceLevel = 'ok' | 'near' | 'exceeded';
type DayStatus = 'on_time' | 'late' | 'absent' | 'unmarked' | 'none';
interface MatrixStudent {
  code: string;
  name: string;
  administrativeClass: string | null;
  totalSessions: number;
  attended: number;
  onTime: number;
  late: number;
  absent: number;
  rate: number;
  days: {
    date: string;
    status: DayStatus;
    checkInAt: string | null;
    checkOutAt: string | null;
  }[];
}
export interface SemesterPlan {
  start: string;
  end: string;
  plannedSessions: number;
  heldSessions: number;
  unmarkedSessions: number;
  plannedPeriods: number;
  expectedPeriods: number | null;
  scheduleIncomplete: boolean;
}
export interface AbsenceWarning {
  plannedSessions: number;
  heldSessions: number;
  attended: number;
  late: number;
  absent: number;
  absentPercent: number;
  allowedAbsences: number;
  remaining: number;
  level: AbsenceLevel;
}

@Injectable()
export class ClassAttendanceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly hgVisionService: HgVisionService,
  ) {}

  async getSettings(classId?: string, administrativeClass?: string) {
    const values = await this.getClassAttendanceConfigValues(
      classId,
      administrativeClass,
    );
    return {
      classStartTime: values.classStartTime,
      lateThresholdMinutes: values.lateThresholdMinutes,
      autoScanIntervalSeconds: values.autoScanIntervalSeconds,
      absenceWarningPercent: await this.getAbsenceWarningPercent(),
      absenceWarningProvisional: true,
      semester: 'HK1 2026-2027',
    };
  }

  async updateSettings(
    currentUserId: string,
    body: {
      classStartTime?: string;
      lateThresholdMinutes?: number;
      autoScanIntervalSeconds?: number;
      absenceWarningPercent?: number;
      classId?: string;
      administrativeClass?: string;
    },
  ) {
    const roles = await this.getRoleCodes(currentUserId);
    if (!roles.includes('SYSTEM_ADMIN') && !roles.includes('ADMIN')) {
      throw new ForbiddenException(
        'Bạn không có quyền cập nhật cấu hình điểm danh lớp học.',
      );
    }

    const current = await this.getSettings(
      body.classId,
      body.administrativeClass,
    );
    const next = {
      classStartTime: body.classStartTime ?? current.classStartTime,
      lateThresholdMinutes:
        body.lateThresholdMinutes ?? current.lateThresholdMinutes,
      autoScanIntervalSeconds:
        body.autoScanIntervalSeconds ?? current.autoScanIntervalSeconds,
    };

    if (!/^\d{2}:\d{2}$/.test(next.classStartTime)) {
      throw new BadRequestException('classStartTime must be HH:mm');
    }
    if (next.lateThresholdMinutes < 0 || next.lateThresholdMinutes > 240) {
      throw new BadRequestException(
        'lateThresholdMinutes must be between 0 and 240',
      );
    }
    if (
      next.autoScanIntervalSeconds < 2 ||
      next.autoScanIntervalSeconds > 300
    ) {
      throw new BadRequestException(
        'autoScanIntervalSeconds must be between 2 and 300',
      );
    }

    if (body.absenceWarningPercent !== undefined) {
      const percent = Number(body.absenceWarningPercent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        throw new BadRequestException(
          'absenceWarningPercent must be between 1 and 100',
        );
      }
      // Ngưỡng áp dụng toàn trường (không theo lớp).
      await this.upsertConfig(
        CLASS_ATTENDANCE_ABSENCE_WARNING_KEY,
        String(percent),
        'number',
        currentUserId,
      );
    }

    await this.upsertConfig(
      this.getScopedConfigKey(
        CLASS_ATTENDANCE_START_TIME_KEY,
        body.classId,
        body.administrativeClass,
      ),
      next.classStartTime,
      'string',
      currentUserId,
    );
    await this.upsertConfig(
      this.getScopedConfigKey(
        CLASS_ATTENDANCE_LATE_THRESHOLD_KEY,
        body.classId,
        body.administrativeClass,
      ),
      String(next.lateThresholdMinutes),
      'number',
      currentUserId,
    );
    await this.upsertConfig(
      this.getScopedConfigKey(
        CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY,
        body.classId,
        body.administrativeClass,
      ),
      String(next.autoScanIntervalSeconds),
      'number',
      currentUserId,
    );

    return this.getSettings(body.classId, body.administrativeClass);
  }

  async listClasses(currentUserId: string) {
    const roles = await this.getRoleCodes(currentUserId);
    const where = this.classScopeWhere(roles);
    const params = where.params(currentUserId);
    const rows = (await this.dataSource.manager.query(
      `
      SELECT cs.id,
             cs.class_code AS code,
             subj.subject_code,
             subj.subject_name AS subject,
             sem.semester_name AS semester,
             sem.semester_code,
             sem.academic_year,
             sem.start_date::text AS semester_start,
             sem.end_date::text AS semester_end,
             sem.status AS semester_status,
             teacher.full_name AS teacher,
             COALESCE(room.room_name, split_part(cs.note, ' | ', 2)) AS room,
             split_part(cs.note, ' | ', 1) AS schedule,
             CASE
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 2%' OR split_part(cs.note, ' | ', 1) ILIKE 'Thứ 2%' THEN 1
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 3%' OR split_part(cs.note, ' | ', 1) ILIKE 'Thứ 3%' THEN 2
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 4%' OR split_part(cs.note, ' | ', 1) ILIKE 'Thứ 4%' THEN 3
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 5%' OR split_part(cs.note, ' | ', 1) ILIKE 'Thứ 5%' THEN 4
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 6%' OR split_part(cs.note, ' | ', 1) ILIKE 'Thứ 6%' THEN 5
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 7%' OR split_part(cs.note, ' | ', 1) ILIKE 'Thứ 7%' THEN 6
               ELSE NULL
             END AS schedule_weekday,
             COUNT(ce.id)::text AS student_count
             , ARRAY_REMOVE(ARRAY_AGG(DISTINCT st.administrative_class), NULL) AS administrative_classes
             , (SELECT json_agg(json_build_object('name', x.name, 'count', x.total) ORDER BY x.total DESC, x.name)
                  FROM (SELECT st2.administrative_class AS name, COUNT(*)::int AS total
                          FROM class_enrollments ce2
                          JOIN students st2 ON st2.id = ce2.student_id AND st2.deleted_at IS NULL
                         WHERE ce2.class_section_id = cs.id AND ce2.status = 'active'
                           AND st2.administrative_class IS NOT NULL
                         GROUP BY 1) x) AS administrative_class_stats
        FROM class_sections cs
        JOIN subjects subj ON subj.id = cs.subject_id
        JOIN semesters sem ON sem.id = cs.semester_id
        LEFT JOIN users teacher ON teacher.id = cs.lecturer_user_id
        LEFT JOIN rooms room ON room.id = cs.default_room_id
        LEFT JOIN class_enrollments ce ON ce.class_section_id = cs.id AND ce.status = 'active'
        LEFT JOIN students st ON st.id = ce.student_id AND st.deleted_at IS NULL
        ${where.sql}
       GROUP BY cs.id, subj.subject_code, subj.subject_name, sem.id, teacher.full_name, room.room_name
       ORDER BY cs.class_code ASC
      `,
      params,
    )) as ClassRow[];

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      subjectCode: row.subject_code,
      subject: row.subject,
      semester: row.semester,
      // Mã kỳ theo API UEL: `${nam_hoc}_${hoc_ky}` (vd 2026-2027_HK01) — FE lọc/nhóm theo mã này.
      semesterCode: row.semester_code ?? null,
      academicYear: row.academic_year ?? null,
      semesterStart: row.semester_start?.slice(0, 10) ?? null,
      semesterEnd: row.semester_end?.slice(0, 10) ?? null,
      semesterStatus: row.semester_status ?? null,
      teacher: row.teacher ?? '',
      room: row.room ?? '',
      schedule: row.schedule ?? '',
      scheduleWeekday: row.schedule_weekday,
      studentCount: Number(row.student_count ?? 0),
      administrativeClasses: row.administrative_classes ?? [],
      // Số SV theo từng lớp hành chính, đông nhất trước — để FE hiện gọn lớp HP gồm nhiều lớp HC.
      administrativeClassStats: row.administrative_class_stats ?? [],
    }));
  }

  /**
   * Buổi học thật (class_sessions, vd đồng bộ từ TKB UEL) trong [from, to] — dùng cho lịch tuần GV/SV.
   * Phạm vi như listClasses: GV thấy lớp mình phụ trách, SV thấy lớp đã đăng ký, admin thấy tất cả.
   */
  async listSessions(currentUserId: string, from?: string, to?: string) {
    const isDate = (v?: string) =>
      !!v &&
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    if (!isDate(from) || !isDate(to)) {
      throw new BadRequestException('from/to phải có dạng yyyy-MM-dd');
    }
    const days =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000;
    if (days < 0 || days > MAX_SESSION_RANGE_DAYS) {
      throw new BadRequestException(
        `Khoảng ngày phải từ 0 đến ${MAX_SESSION_RANGE_DAYS} ngày`,
      );
    }

    const roles = await this.getRoleCodes(currentUserId);
    const where = this.classScopeWhere(roles);
    const params: unknown[] = [...where.params(currentUserId), from, to];
    const fromIdx = params.length - 1;
    const rows = (await this.dataSource.manager.query(
      `
      SELECT se.id,
             to_char(se.session_date, 'YYYY-MM-DD') AS session_date,
             to_char(se.start_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI') AS start_clock,
             to_char(se.end_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI') AS end_clock,
             se.start_time, se.end_time, se.status, se.source,
             se.period_start, se.period_count,
             cs.id AS class_id, cs.class_code,
             subj.subject_code, subj.subject_name,
             sem.semester_name,
             teacher.full_name AS teacher,
             COALESCE(room.room_name, def_room.room_name) AS room,
             COALESCE(room.id, def_room.id) AS room_id,
             (SELECT COUNT(*) FROM class_enrollments ce
               WHERE ce.class_section_id = cs.id AND ce.status = 'active')::int AS student_count
        FROM class_sessions se
        JOIN class_sections cs ON cs.id = se.class_section_id
        JOIN subjects subj ON subj.id = cs.subject_id
        JOIN semesters sem ON sem.id = cs.semester_id
        LEFT JOIN users teacher ON teacher.id = cs.lecturer_user_id
        LEFT JOIN rooms room ON room.id = se.room_id
        LEFT JOIN rooms def_room ON def_room.id = cs.default_room_id
        ${where.sql}
         AND se.session_date BETWEEN $${fromIdx}::date AND $${fromIdx + 1}::date
       ORDER BY se.start_time ASC, cs.class_code ASC
      `,
      params,
    )) as SessionRow[];

    return rows.map((row) => ({
      id: row.id,
      date: row.session_date,
      startTime: row.start_clock,
      endTime: row.end_clock,
      startAt: row.start_time,
      endAt: row.end_time,
      status: row.status,
      source: row.source,
      periodStart: row.period_start,
      periodCount: row.period_count,
      classId: row.class_id,
      classCode: row.class_code,
      subjectCode: row.subject_code,
      subject: row.subject_name,
      semester: row.semester_name,
      teacher: row.teacher ?? '',
      room: row.room ?? '',
      roomId: row.room_id ?? null,
      studentCount: Number(row.student_count ?? 0),
    }));
  }

  async getRows(
    currentUserId: string,
    classId: string,
    date = this.todayKey(),
  ) {
    const resolvedClassId = await this.assertClassAccess(
      currentUserId,
      classId,
    );
    const students = await this.getClassStudents(resolvedClassId);
    const records = (await this.dataSource.manager.query(
      `
      SELECT car.id,
             car.student_id,
             car.check_in_at,
             car.check_out_at,
             car.status,
             car.confidence,
             car.evidence_image,
             car.source,
             car.manual_reason,
             car.actor_user_id,
             car.zone_id,
             car.camera_group_id,
             car.camera_id
        FROM class_attendance_records car
       WHERE car.class_section_id = $1
         AND car.attendance_date = $2::date
      `,
      [resolvedClassId, date],
    )) as AttendanceRow[];
    const byStudent = new Map(
      records.map((record) => [record.student_id, record]),
    );

    return students.map((student) => {
      const record = byStudent.get(student.id);
      const status = record?.status ?? 'not_checked';
      return {
        id: student.id,
        code: student.code,
        name: student.name,
        email: student.email,
        administrativeClass: student.administrative_class,
        studentId: student.id,
        classId: resolvedClassId,
        checkInAt: record?.check_in_at ?? null,
        checkOutAt: record?.check_out_at ?? null,
        evidenceImage: record?.evidence_image ?? null,
        confidence: record?.confidence ?? null,
        status,
        statusLabel: this.statusLabel(status),
        checkInText: this.formatTime(record?.check_in_at),
        checkOutText: this.formatTime(record?.check_out_at),
        source: record?.source ?? null,
        manualReason: record?.manual_reason ?? null,
        actorUserId: record?.actor_user_id ?? null,
        zoneId: record?.zone_id ?? null,
        cameraGroupId: record?.camera_group_id ?? null,
        cameraId: record?.camera_id ?? null,
      };
    });
  }

  async getSummary(
    currentUserId: string,
    classId: string,
    date = this.todayKey(),
  ) {
    const rows = await this.getRows(currentUserId, classId, date);
    return this.summarizeRows(rows);
  }

  async getEvents(
    currentUserId: string,
    classId: string,
    date = this.todayKey(),
  ) {
    const resolvedClassId = await this.assertClassAccess(
      currentUserId,
      classId,
    );
    const rows = await this.dataSource.manager.query(
      `SELECT e.id, e.student_id, st.student_code, u.full_name AS student_name,
              e.direction, e.status, e.source, e.actor_user_id, actor.full_name AS actor_name,
              e.reason, e.zone_id, e.camera_group_id, e.camera_id, e.evidence_image, e.occurred_at
         FROM class_attendance_events e
         JOIN students st ON st.id = e.student_id
         JOIN users u ON u.id = st.user_id
         LEFT JOIN users actor ON actor.id = e.actor_user_id
        WHERE e.class_section_id = $1 AND e.attendance_date = $2::date
        ORDER BY e.occurred_at DESC`,
      [resolvedClassId, date],
    );
    return rows.map((row: any) => ({
      id: row.id,
      studentId: row.student_id,
      studentCode: row.student_code,
      studentName: row.student_name,
      direction: row.direction,
      status: row.status,
      source: row.source,
      sourceLabel: row.source === 'manual' ? 'Thủ công' : 'Tự động',
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      reason: row.reason,
      zoneId: row.zone_id,
      cameraGroupId: row.camera_group_id,
      cameraId: row.camera_id,
      evidenceImage: row.evidence_image,
      occurredAt: row.occurred_at,
    }));
  }

  async scan(
    currentUserId: string,
    body: {
      classId?: string;
      administrativeClass?: string;
      direction?: 'in' | 'out' | 'enter' | 'leave';
      snapshotImageBase64?: string;
      zoneId?: string;
      cameraGroupId?: string;
      cameraId?: string;
    },
  ) {
    if (!body.classId) {
      throw new BadRequestException('classId is required');
    }
    const classId = await this.assertClassAccess(currentUserId, body.classId, [
      'TEACHER',
      'SYSTEM_ADMIN',
      'ADMIN',
    ]);

    const direction =
      body.direction === 'out' || body.direction === 'leave' ? 'out' : 'in';
    const date = this.todayKey();
    const students = await this.getClassStudents(classId);
    const rows = await this.getRows(currentUserId, classId, date);
    const recognition = await this.resolveClassFaceRecognition(
      students,
      body.snapshotImageBase64,
    );
    const target = recognition?.student
      ? rows.find((row) => row.studentId === recognition.student.id)
      : direction === 'out'
        ? rows.find((row) => row.checkInAt && !row.checkOutAt)
        : rows.find((row) => !row.checkInAt);

    if (!target) {
      return {
        success: true,
        data: {
          operationSuccess: false,
          warning: true,
          message:
            direction === 'out'
              ? 'Tất cả sinh viên đã ghi nhận giờ rời lớp.'
              : 'Lớp này đã điểm danh đủ, không điểm danh lặp lại.',
        },
      };
    }

    if (recognition?.student) {
      if (direction === 'in' && target.checkInAt) {
        return {
          success: true,
          data: {
            operationSuccess: false,
            warning: true,
            recognition: recognition.face,
            message: `${recognition.student.name} đã được điểm danh vào lớp trước đó.`,
          },
        };
      }
      if (direction === 'out' && (!target.checkInAt || target.checkOutAt)) {
        return {
          success: true,
          data: {
            operationSuccess: false,
            warning: true,
            recognition: recognition.face,
            message: `${recognition.student.name} chưa có lượt vào đang mở để ghi nhận rời lớp.`,
          },
        };
      }
    }

    const student = students.find((item) => item.id === target.studentId);
    if (!student) {
      throw new BadRequestException('Student not found in class');
    }

    const now = new Date();
    let status = target.status;
    if (direction === 'in') {
      const settings = await this.getClassAttendanceConfigValues(
        classId,
        body.administrativeClass,
      );
      status = this.isLate(now, settings) ? 'late' : 'on_time';
    } else {
      status = 'left';
    }
    const confidence = recognition?.face
      ? this.normalizeConfidence(recognition.face.score)
      : 94;

    const inserted = (await this.dataSource.manager.query(
      `
      INSERT INTO class_attendance_records (
        class_section_id, student_id, attendance_date, check_in_at, check_out_at,
        status, confidence, evidence_image, source, zone_id, camera_group_id, camera_id, updated_at
      )
      VALUES (
        $1, $2, $3::date,
        CASE WHEN $4 = 'in' THEN $5::timestamptz ELSE NULL END,
        CASE WHEN $4 = 'out' THEN $5::timestamptz ELSE NULL END,
        $6, $9, $7, $8, now()
      )
      ON CONFLICT (class_section_id, student_id, attendance_date)
      DO UPDATE SET
        check_in_at = COALESCE(class_attendance_records.check_in_at, EXCLUDED.check_in_at),
        check_out_at = CASE
          WHEN $4 = 'out' THEN COALESCE(EXCLUDED.check_out_at, class_attendance_records.check_out_at)
          ELSE class_attendance_records.check_out_at
        END,
        status = $6,
        confidence = $9,
        evidence_image = COALESCE($7, class_attendance_records.evidence_image),
        source = $8,
        zone_id = COALESCE($10, class_attendance_records.zone_id),
        camera_group_id = COALESCE($11, class_attendance_records.camera_group_id),
        camera_id = COALESCE($12, class_attendance_records.camera_id),
        updated_at = now()
      RETURNING id, student_id, check_in_at, check_out_at, status, confidence, evidence_image, source
      `,
      [
        classId,
        student.id,
        date,
        direction,
        now.toISOString(),
        status,
        body.snapshotImageBase64 ?? null,
        recognition?.face
          ? 'hgvision-face'
          : body.snapshotImageBase64
            ? 'webcam'
            : 'camera',
        confidence,
        body.zoneId ?? null,
        body.cameraGroupId ?? null,
        body.cameraId ?? null,
      ],
    )) as AttendanceRow[];

    await this.recordAttendanceEvent({
      classId,
      studentId: student.id,
      date,
      direction,
      status,
      source: recognition?.face ? 'automatic_face' : 'automatic_camera',
      actorUserId: null,
      reason: null,
      zoneId: body.zoneId,
      cameraGroupId: body.cameraGroupId,
      cameraId: body.cameraId,
      evidenceImage: body.snapshotImageBase64,
    });

    return {
      success: true,
      data: {
        operationSuccess: true,
        student: {
          id: student.id,
          code: student.code,
          name: student.name,
          email: student.email,
        },
        record: inserted[0],
        recognition: recognition?.face ?? null,
        message:
          direction === 'out'
            ? `${student.name} đã rời lớp.`
            : `${student.name} đã điểm danh ${status === 'late' ? 'đi muộn' : 'đúng giờ'}${
                recognition?.face ? ' bằng HGVision FaceID' : ''
              }.`,
      },
    };
  }

  async updateManual(
    currentUserId: string,
    body: {
      classId?: string;
      studentId?: string;
      date?: string;
      status?: 'on_time' | 'late' | 'absent' | 'left';
      checkInAt?: string | null;
      checkOutAt?: string | null;
      reason?: string;
      zoneId?: string;
      cameraGroupId?: string;
      cameraId?: string;
      evidenceImage?: string;
    },
  ) {
    if (
      !body.classId ||
      !body.studentId ||
      !body.status ||
      !body.reason?.trim()
    ) {
      throw new BadRequestException(
        'classId, studentId, status và reason là bắt buộc',
      );
    }
    const classId = await this.assertClassAccess(currentUserId, body.classId, [
      'TEACHER',
      'SYSTEM_ADMIN',
      'ADMIN',
      'BUSINESS_ADMIN',
    ]);
    const students = await this.getClassStudents(classId);
    const student = students.find((item) => item.id === body.studentId);
    if (!student)
      throw new BadRequestException('Sinh viên không thuộc lớp này');
    const date = body.date ?? this.todayKey();
    const checkIn =
      body.status === 'absent'
        ? null
        : (body.checkInAt ?? new Date().toISOString());
    const checkOut =
      body.status === 'left'
        ? (body.checkOutAt ?? new Date().toISOString())
        : (body.checkOutAt ?? null);
    const rows = await this.dataSource.manager.query(
      `INSERT INTO class_attendance_records (class_section_id, student_id, attendance_date, check_in_at, check_out_at, status, confidence, evidence_image, source, manual_reason, actor_user_id, zone_id, camera_group_id, camera_id, updated_at)
       VALUES ($1,$2,$3::date,$4::timestamptz,$5::timestamptz,$6,NULL,$7,'manual',$8,$9,$10,$11,$12,now())
       ON CONFLICT (class_section_id, student_id, attendance_date) DO UPDATE SET check_in_at=$4::timestamptz, check_out_at=$5::timestamptz, status=$6, evidence_image=COALESCE($7,class_attendance_records.evidence_image), source='manual', manual_reason=$8, actor_user_id=$9, zone_id=$10, camera_group_id=$11, camera_id=$12, updated_at=now()
       RETURNING id, student_id, check_in_at, check_out_at, status, source, manual_reason`,
      [
        classId,
        student.id,
        date,
        checkIn,
        checkOut,
        body.status,
        body.evidenceImage ?? null,
        body.reason.trim(),
        currentUserId,
        body.zoneId ?? null,
        body.cameraGroupId ?? null,
        body.cameraId ?? null,
      ],
    );
    await this.recordAttendanceEvent({
      classId,
      studentId: student.id,
      date,
      direction: checkOut ? 'out' : 'in',
      status: body.status,
      source: 'manual',
      actorUserId: currentUserId,
      reason: body.reason.trim(),
      zoneId: body.zoneId,
      cameraGroupId: body.cameraGroupId,
      cameraId: body.cameraId,
      evidenceImage: body.evidenceImage,
    });
    return {
      student,
      record: rows[0],
      message: `Đã cập nhật thủ công trạng thái của ${student.name}.`,
    };
  }

  private async recordAttendanceEvent(input: {
    classId: string;
    studentId: string;
    date: string;
    direction: string;
    status: string;
    source: string;
    actorUserId: string | null;
    reason?: string | null;
    zoneId?: string | null;
    cameraGroupId?: string | null;
    cameraId?: string | null;
    evidenceImage?: string | null;
  }) {
    await this.dataSource.manager.query(
      `INSERT INTO class_attendance_events (class_section_id, student_id, attendance_date, direction, status, source, actor_user_id, reason, zone_id, camera_group_id, camera_id, evidence_image) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        input.classId,
        input.studentId,
        input.date,
        input.direction,
        input.status,
        input.source,
        input.actorUserId,
        input.reason ?? null,
        input.zoneId ?? null,
        input.cameraGroupId ?? null,
        input.cameraId ?? null,
        input.evidenceImage ?? null,
      ],
    );
  }

  async getStudentReport(
    currentUserId: string,
    query: {
      studentId?: string;
      mode?: string;
      anchorDate?: string;
      subjectCode?: string;
    },
  ) {
    const roles = await this.getRoleCodes(currentUserId);
    const student = await this.resolveStudent(
      currentUserId,
      query.studentId,
      roles,
    );
    // GV (không kiêm admin) chỉ xem được SV học lớp mình dạy, và chỉ thấy các lớp đó.
    const lecturerScope =
      query.studentId &&
      roles.includes('TEACHER') &&
      !roles.some((role) =>
        ['SYSTEM_ADMIN', 'ADMIN', 'BUSINESS_ADMIN'].includes(role),
      )
        ? currentUserId
        : null;
    if (lecturerScope) {
      const owned = (await this.dataSource.manager.query(
        `SELECT 1
           FROM class_enrollments ce
           JOIN class_sections cs ON cs.id = ce.class_section_id AND cs.deleted_at IS NULL
          WHERE ce.student_id = $1 AND cs.lecturer_user_id = $2
          LIMIT 1`,
        [student.id, lecturerScope],
      )) as unknown[];
      if (owned.length === 0) {
        throw new ForbiddenException(
          'Sinh viên này không học lớp nào bạn phụ trách.',
        );
      }
    }
    const { start, end } = this.getRangeBounds(query.mode, query.anchorDate);
    const subjectCode =
      query.subjectCode && query.subjectCode !== 'all'
        ? query.subjectCode
        : null;
    const rows = (await this.dataSource.manager.query(
      `
      SELECT cs.id AS class_id,
             cs.class_code,
             subj.subject_code,
             subj.subject_name,
             COALESCE(room.room_name, split_part(cs.note, ' | ', 2)) AS room,
             split_part(cs.note, ' | ', 1) AS schedule,
             car.attendance_date,
             car.check_in_at,
             car.check_out_at,
             COALESCE(car.status, 'absent') AS status,
             car.confidence,
             car.evidence_image
        FROM class_enrollments ce
        JOIN class_sections cs ON cs.id = ce.class_section_id AND cs.deleted_at IS NULL
        JOIN subjects subj ON subj.id = cs.subject_id
        LEFT JOIN rooms room ON room.id = cs.default_room_id
        LEFT JOIN class_attendance_records car
          ON car.class_section_id = cs.id
         AND car.student_id = ce.student_id
         AND car.attendance_date BETWEEN $2::date AND $3::date
       WHERE ce.student_id = $1
         AND ce.status = 'active'
         AND ($4::text IS NULL OR subj.subject_code = $4)
         AND ($5::uuid IS NULL OR cs.lecturer_user_id = $5::uuid)
       ORDER BY car.attendance_date DESC NULLS LAST, cs.class_code ASC
      `,
      [student.id, start, end, subjectCode, lecturerScope],
    )) as any[];

    const entries = rows
      .filter((row) => row.attendance_date)
      .map((row) => ({
        id: `${row.class_id}-${student.id}-${this.toDateKey(row.attendance_date)}`,
        date: this.toDateKey(row.attendance_date),
        dateText: this.formatDateText(row.attendance_date),
        classId: row.class_id,
        classCode: row.class_code,
        subjectCode: row.subject_code,
        className: row.subject_name,
        room: row.room ?? '',
        schedule: row.schedule ?? '',
        studentId: student.id,
        studentCode: student.code,
        studentName: student.name,
        checkInAt: row.check_in_at,
        checkOutAt: row.check_out_at,
        checkInText: this.formatTime(row.check_in_at),
        checkOutText: this.formatTime(row.check_out_at),
        status: row.status,
        statusLabel: this.statusLabel(row.status),
        confidence: row.confidence,
        evidenceImage: row.evidence_image,
      }));

    return {
      period: { start, end },
      entries,
      summary: this.summarizeEntries(entries),
    };
  }

  async getStats(currentUserId: string) {
    const classes = await this.listClasses(currentUserId);
    const today = this.todayKey();
    const rows = await Promise.all(
      classes.map(async (klass) => {
        const summary = await this.getSummary(currentUserId, klass.id, today);
        return {
          ...klass,
          ...summary,
          rate: summary.total
            ? Math.round((summary.checkedIn / summary.total) * 100)
            : 0,
        };
      }),
    );
    return rows;
  }

  async getTeacherReport(
    currentUserId: string,
    query: {
      classId?: string;
      semester?: string;
      mode?: string;
      anchorDate?: string;
      subjectCode?: string;
      administrativeClass?: string;
      include?: string;
    },
  ) {
    const classes = await this.getReportClasses(
      currentUserId,
      query.classId,
      query.semester,
      query.subjectCode,
    );
    const { start, end } = await this.resolveReportRange(
      query.mode,
      query.anchorDate,
      query.semester,
      classes,
    );
    const includes = new Set(
      (query.include ?? '').split(',').map((item) => item.trim()),
    );
    const adminClass = this.normalizeAdminClass(query.administrativeClass);
    const threshold = includes.has('warnings')
      ? await this.getAbsenceWarningPercent()
      : null;
    const [baseRows, schedules, warnings, trend] = await Promise.all([
      this.buildClassReportRows(classes, start, end, query.administrativeClass),
      this.getClassScheduleInfo(classes.map((klass) => klass.id)),
      threshold === null
        ? Promise.resolve(null)
        : this.getSemesterWarnings(classes, adminClass, threshold),
      includes.has('trend')
        ? this.buildWeeklyTrend(classes, query.semester, adminClass)
        : Promise.resolve(null),
    ]);
    const rows = baseRows.map((row) => {
      const plan = warnings?.plans.get(row.id);
      const classEntries =
        warnings?.entries.filter((entry) => entry.classId === row.id) ?? [];
      return {
        ...row,
        ...(schedules.get(row.id) ?? {
          slots: [],
          nextSession: null,
          hasSessionToday: false,
        }),
        warning: warnings
          ? {
              exceeded: classEntries.filter(
                (entry) => entry.warning.level === 'exceeded',
              ).length,
              near: classEntries.filter(
                (entry) => entry.warning.level === 'near',
              ).length,
              plannedSessions: plan?.plannedSessions ?? 0,
              heldSessions: plan?.heldSessions ?? 0,
              scheduleIncomplete: plan?.scheduleIncomplete ?? false,
            }
          : null,
      };
    });
    const totals = this.summarizeReportRows(rows);
    return {
      period: { start, end },
      rows,
      totals,
      ...(threshold === null
        ? {}
        : { warningThreshold: threshold, warningProvisional: true }),
      ...(trend ? { trend } : {}),
    };
  }

  /**
   * Xu hướng chuyên cần theo tuần (thứ Hai → Chủ nhật) trên cả học kỳ, tới hôm nay — cùng cách tính
   * với bảng báo cáo: lượt cần ĐD = sĩ số × buổi đã diễn ra (bỏ buổi cả lớp chưa có bản ghi) + bản ghi
   * ngoài TKB. Chỉ trả các tuần có ít nhất 1 lượt.
   */
  private async buildWeeklyTrend(
    classes: any[],
    semester: string | undefined,
    administrativeClass: string | undefined,
  ) {
    const range = await this.resolveReportRange(
      'semester',
      undefined,
      semester,
      classes,
    );
    const today = this.todayKey();
    const start = range.start;
    const end = range.end < today ? range.end : today;
    if (start > end || classes.length === 0) return [];
    const classIds = classes.map((klass) => klass.id);
    const [records, heldByClass, enrolledByClass, markedByClass] =
      await Promise.all([
        this.getAttendanceRecords(classIds, start, end, administrativeClass),
        this.getHeldSessionDates(classIds, start, end),
        this.getEnrollmentCounts(classIds, administrativeClass),
        this.getMarkedDates(classIds, start, end),
      ]);
    const weekOf = (dateKey: string) => {
      const date = new Date(`${dateKey}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
      return date.toISOString().slice(0, 10);
    };
    const buckets = new Map<
      string,
      { expected: number; attended: number; late: number }
    >();
    const bucket = (dateKey: string) => {
      const key = weekOf(dateKey);
      const entry = buckets.get(key) ?? { expected: 0, attended: 0, late: 0 };
      buckets.set(key, entry);
      return entry;
    };
    const heldSets = new Map<string, Set<string>>();
    for (const klass of classes) {
      const { held } = this.splitHeldDates(
        heldByClass.get(klass.id),
        markedByClass.get(klass.id),
      );
      heldSets.set(klass.id, held);
      const enrolled = enrolledByClass.get(klass.id) ?? 0;
      for (const date of held) bucket(date).expected += enrolled;
    }
    for (const record of records) {
      const dateKey = this.toDateKey(record.attendance_date);
      const entry = bucket(dateKey);
      if (!heldSets.get(record.class_id)?.has(dateKey)) entry.expected += 1;
      if (record.check_in_at && record.status !== 'absent') {
        entry.attended += 1;
        if (record.status === 'late') entry.late += 1;
      }
    }
    return [...buckets.entries()]
      .filter(([, entry]) => entry.expected > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, entry]) => {
        const weekEnd = new Date(`${weekStart}T00:00:00Z`);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        const expected = Math.max(entry.expected, entry.attended);
        return {
          weekStart,
          weekEnd: weekEnd.toISOString().slice(0, 10),
          totalSessions: expected,
          attended: entry.attended,
          onTime: entry.attended - entry.late,
          late: entry.late,
          absent: expected - entry.attended,
          rate: Math.round((entry.attended / expected) * 100),
        };
      });
  }

  /**
   * Xuất CSV theo đúng bộ lọc đang xem (mặc định cả học kỳ): mỗi lớp học phần một khối gồm
   * ma trận SV × ngày học (x / M / V), tổng hợp trong khoảng và cảnh báo vắng theo cả học kỳ.
   */
  async exportSemesterCsv(
    currentUserId: string,
    query: {
      classId?: string;
      semester?: string;
      subjectCode?: string;
      administrativeClass?: string;
      mode?: string;
      anchorDate?: string;
    },
  ) {
    const classes = await this.getReportClasses(
      currentUserId,
      query.classId,
      query.semester,
      query.subjectCode,
    );
    const mode = query.mode || 'semester';
    const { start, end } = await this.resolveReportRange(
      mode,
      query.anchorDate,
      query.semester,
      classes,
    );
    const adminClass = this.normalizeAdminClass(query.administrativeClass);
    const threshold = await this.getAbsenceWarningPercent();
    const [matrix, warnings] = await Promise.all([
      this.buildStudentMatrix(
        classes.map((klass) => klass.id),
        start,
        end,
        adminClass,
      ),
      this.getSemesterWarnings(classes, adminClass, threshold),
    ]);
    const symbol: Record<DayStatus, string> = {
      on_time: 'x',
      late: 'M',
      absent: 'V',
      unmarked: '-',
      none: '',
    };
    const levelLabel: Record<AbsenceLevel, string> = {
      ok: '',
      near: 'Gần ngưỡng',
      exceeded: 'Vượt ngưỡng',
    };
    const lines: unknown[][] = [
      ['BẢNG CHUYÊN CẦN LỚP HỌC PHẦN'],
      [
        'Khoảng thống kê',
        `${this.formatDateText(start)} - ${this.formatDateText(end)}`,
      ],
      [
        'Ký hiệu',
        'x = có mặt đúng giờ; M = đi muộn; V = vắng (buổi đã diễn ra nhưng SV không có lượt quét/điểm danh); - = buổi chưa điểm danh (cả lớp không có bản ghi, không tính vắng); trống = lớp không học ngày đó',
      ],
      [
        'Ngưỡng cảnh báo',
        `Vắng > ${threshold}% số buổi theo TKB cả học kỳ (mức tạm, chưa chốt theo quy chế UEL). Gần ngưỡng = vắng từ ${threshold / 2}%`,
      ],
    ];
    for (const klass of classes) {
      const data = matrix.get(klass.id) ?? {
        dates: [] as string[],
        unmarkedDates: [] as string[],
        students: [] as MatrixStudent[],
      };
      const plan = warnings.plans.get(klass.id);
      lines.push([]);
      lines.push(['Lớp học phần', `${klass.code} - ${klass.subject}`]);
      lines.push([
        'Giảng viên',
        klass.teacher ?? '',
        'Học kỳ',
        klass.semester ?? '',
        'Phòng',
        klass.room ?? '',
      ]);
      if (plan) {
        lines.push([
          'Số buổi theo TKB cả kỳ',
          plan.plannedSessions,
          'Đã diễn ra',
          plan.heldSessions,
          'Chưa điểm danh',
          plan.unmarkedSessions,
          plan.scheduleIncomplete
            ? 'TKB đồng bộ chưa đủ cả kỳ - % vắng cả kỳ có thể chưa chính xác'
            : '',
        ]);
      }
      lines.push([
        'STT',
        'Mã SV',
        'Họ tên',
        'Lớp HC',
        ...data.dates.map((date) => this.formatDateText(date)),
        'Có mặt',
        'Đi muộn',
        'Vắng',
        'Số buổi',
        'Tỷ lệ có mặt (%)',
        'Vắng cả kỳ',
        '% vắng cả kỳ',
        'Cảnh báo',
      ]);
      data.students.forEach((st, index) => {
        const warning = warnings.byStudent.get(`${klass.id}|${st.code}`);
        lines.push([
          index + 1,
          st.code,
          st.name,
          st.administrativeClass ?? '',
          ...st.days.map((day) => symbol[day.status]),
          st.attended,
          st.late,
          st.absent,
          st.totalSessions,
          st.totalSessions ? st.rate : '',
          warning ? `${warning.absent}/${warning.plannedSessions}` : '',
          warning ? warning.absentPercent : '',
          warning ? levelLabel[warning.level] : '',
        ]);
      });
      if (data.students.length === 0) lines.push(['', 'Không có sinh viên']);
    }

    const classPart =
      query.classId && query.classId !== 'all'
        ? this.safeFilename(classes[0]?.code ?? query.classId)
        : 'tat-ca-lop';
    const periodPart =
      mode === 'semester'
        ? this.safeFilename(query.semester || 'ca-hoc-ky')
        : `${start}_${end}`;
    return {
      filename: `bang-chuyen-can-${classPart}-${periodPart}.csv`,
      csv: lines
        .map((row) => row.map((cell) => this.csvEscape(cell)).join(','))
        .join('\n'),
    };
  }

  private async getRoleCodes(userId: string): Promise<RoleCode[]> {
    const rows = (await this.dataSource.manager.query(
      `SELECT r.role_code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND ur.is_active = true
          AND r.is_active = true`,
      [userId],
    )) as Array<{ role_code: string }>;
    return rows.map((row) => row.role_code);
  }

  private classScopeWhere(roles: RoleCode[]) {
    if (
      roles.includes('SYSTEM_ADMIN') ||
      roles.includes('ADMIN') ||
      roles.includes('BUSINESS_ADMIN')
    ) {
      return {
        sql: `WHERE cs.deleted_at IS NULL`,
        params: (_userId: string) => [],
      };
    }
    if (roles.includes('TEACHER')) {
      return {
        sql: `WHERE cs.deleted_at IS NULL AND cs.lecturer_user_id = $1`,
        params: (userId: string) => [userId],
      };
    }
    if (roles.includes('STUDENT')) {
      return {
        sql: `WHERE cs.deleted_at IS NULL AND EXISTS (
          SELECT 1 FROM class_enrollments ce2
          JOIN students st2 ON st2.id = ce2.student_id
          WHERE ce2.class_section_id = cs.id
            AND ce2.status = 'active'
            AND st2.user_id = $1
            AND st2.deleted_at IS NULL
        )`,
        params: (userId: string) => [userId],
      };
    }
    return { sql: `WHERE 1 = 0`, params: (_userId: string) => [] };
  }

  private async assertClassAccess(
    userId: string,
    classIdentifier: string,
    allowedRoleCodes?: RoleCode[],
  ): Promise<string> {
    const classId = await this.resolveClassSectionId(classIdentifier);
    const roles = await this.getRoleCodes(userId);
    if (
      allowedRoleCodes &&
      !allowedRoleCodes.some((role) => roles.includes(role))
    ) {
      throw new ForbiddenException('Bạn không có quyền thao tác lớp học này.');
    }
    if (
      roles.includes('SYSTEM_ADMIN') ||
      roles.includes('ADMIN') ||
      roles.includes('BUSINESS_ADMIN')
    ) {
      return classId;
    }

    const rows = (await this.dataSource.manager.query(
      `
      SELECT cs.id
        FROM class_sections cs
       WHERE cs.id = $1
         AND cs.deleted_at IS NULL
         AND (
           cs.lecturer_user_id = $2
           OR EXISTS (
             SELECT 1 FROM class_enrollments ce
             JOIN students st ON st.id = ce.student_id
             WHERE ce.class_section_id = cs.id
               AND ce.status = 'active'
               AND st.user_id = $2
               AND st.deleted_at IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = $2
               AND ur.is_active = true
               AND r.role_code IN ('SYSTEM_ADMIN', 'ADMIN', 'BUSINESS_ADMIN')
           )
         )
      `,
      [classId, userId],
    )) as Array<{ id: string }>;
    if (!rows[0]) {
      throw new ForbiddenException('Bạn không có quyền xem lớp học này.');
    }
    return rows[0].id;
  }

  private async resolveClassSectionId(classIdentifier: string) {
    const normalizedCode = classIdentifier
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    const rows = (await this.dataSource.manager.query(
      `
      SELECT cs.id
        FROM class_sections cs
       WHERE cs.deleted_at IS NULL
         AND (
           cs.id::text = $1
           OR lower(cs.class_code) = lower($1)
           OR regexp_replace(lower(cs.class_code), '[^a-z0-9]', '', 'g') = $2
         )
       LIMIT 1
      `,
      [classIdentifier, normalizedCode],
    )) as Array<{ id: string }>;
    if (!rows[0]) {
      throw new BadRequestException('Không tìm thấy lớp học.');
    }
    return rows[0].id;
  }

  private async getClassStudents(classId: string): Promise<StudentRow[]> {
    return (await this.dataSource.manager.query(
      `
      SELECT st.id,
             st.user_id,
             st.student_code AS code,
             st.administrative_class,
             u.full_name AS name,
             u.email
        FROM class_enrollments ce
        JOIN students st ON st.id = ce.student_id AND st.deleted_at IS NULL
        JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL
       WHERE ce.class_section_id = $1
         AND ce.status = 'active'
       ORDER BY st.student_code ASC
      `,
      [classId],
    )) as StudentRow[];
  }

  private async resolveClassFaceRecognition(
    students: StudentRow[],
    snapshotImageBase64?: string,
  ): Promise<{ student: StudentRow; face: HgVisionRecognizedFace } | null> {
    try {
      const face = await this.hgVisionService.searchFaceFromDataUrl(
        snapshotImageBase64,
        5,
      );
      if (!face) return null;
      const student = this.matchStudentByFaceIdent(students, face.faceIdent);
      return student ? { student, face } : null;
    } catch {
      return null;
    }
  }

  private matchStudentByFaceIdent(students: StudentRow[], faceIdent: string) {
    const normalizedFace = this.normalizeIdentity(faceIdent);
    return students.find((student) => {
      const candidates = [
        student.code,
        student.name,
        student.email ?? '',
        `${student.code} ${student.name}`,
        `${student.name} ${student.code}`,
      ].map((value) => this.normalizeIdentity(value));
      return candidates.some(
        (candidate) =>
          candidate === normalizedFace ||
          normalizedFace.includes(candidate) ||
          candidate.includes(normalizedFace),
      );
    });
  }

  private normalizeIdentity(value: string) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9@._-]+/g, '')
      .toLowerCase();
  }

  private normalizeConfidence(score: number | null | undefined) {
    const value = Number(score ?? 0);
    if (!Number.isFinite(value)) return 0;
    return Math.max(
      0,
      Math.min(100, Math.round(value <= 1 ? value * 100 : value)),
    );
  }

  private async getReportClasses(
    currentUserId: string,
    classId?: string,
    semester?: string,
    subjectCode?: string,
  ) {
    let classes = await this.listClasses(currentUserId);
    if (semester && semester !== 'all') {
      classes = classes.filter(
        (klass) =>
          klass.semester === semester || klass.semesterCode === semester,
      );
    }
    if (subjectCode && subjectCode !== 'all') {
      classes = classes.filter((klass) => klass.subjectCode === subjectCode);
    }
    if (classId && classId !== 'all') {
      const resolvedId = await this.assertClassAccess(currentUserId, classId, [
        'TEACHER',
        'SYSTEM_ADMIN',
        'ADMIN',
        'BUSINESS_ADMIN',
      ]);
      classes = classes.filter((klass) => klass.id === resolvedId);
    }
    return classes;
  }

  /**
   * Chuyên cần theo lớp học phần. Bản ghi chỉ được tạo khi camera quét được SV hoặc GV điểm danh tay,
   * nên SV không đến sẽ không có bản ghi → phải tính vắng từ lịch: lượt cần điểm danh = sĩ số × số buổi
   * đã diễn ra (class_sessions không bị hủy, đã bắt đầu). Bản ghi rơi vào ngày không có trong TKB
   * (điểm danh tay/dữ liệu cũ) vẫn được cộng thêm để không mất số liệu.
   */
  private async buildClassReportRows(
    classes: any[],
    start: string,
    end: string,
    administrativeClass?: string,
  ) {
    const classIds = classes.map((klass) => klass.id);
    const [
      records,
      heldByClass,
      enrolledByClass,
      markedByClass,
      enrolledByAdminClass,
    ] = await Promise.all([
      this.getAttendanceRecords(classIds, start, end, administrativeClass),
      this.getHeldSessionDates(classIds, start, end),
      this.getEnrollmentCounts(classIds, administrativeClass),
      this.getMarkedDates(classIds, start, end),
      this.getEnrollmentCountsByAdminClass(classIds, administrativeClass),
    ]);
    const recordsByClass = new Map<string, any[]>();
    for (const record of records) {
      const list = recordsByClass.get(record.class_id) ?? [];
      list.push(record);
      recordsByClass.set(record.class_id, list);
    }

    return classes.map((klass) => {
      const classRecords = recordsByClass.get(klass.id) ?? [];
      const { held, unmarked } = this.splitHeldDates(
        heldByClass.get(klass.id),
        markedByClass.get(klass.id),
      );
      const enrolled = enrolledByClass.get(klass.id) ?? 0;
      const tally = (subset: any[], headcount: number) => {
        const offSchedule = subset.filter(
          (record) => !held.has(this.toDateKey(record.attendance_date)),
        );
        const expected = Math.max(
          headcount * held.size + offSchedule.length,
          subset.length,
        );
        const attended = subset.filter(
          (record) => record.check_in_at && record.status !== 'absent',
        ).length;
        const late = subset.filter(
          (record) => record.check_in_at && record.status === 'late',
        ).length;
        return { offSchedule, expected, attended, late };
      };
      const { offSchedule, expected, attended, late } = tally(
        classRecords,
        enrolled,
      );
      const sessionDates = new Set([
        ...held,
        ...offSchedule.map((record) => this.toDateKey(record.attendance_date)),
      ]);
      // Tách số liệu theo từng lớp hành chính trong lớp HP — FE hiện mỗi lớp HC một dòng riêng.
      const administrativeClassBreakdown = [
        ...(enrolledByAdminClass.get(klass.id) ?? new Map<string, number>()),
      ]
        .map(([name, count]) => {
          const key = name.toLowerCase();
          const part = tally(
            classRecords.filter(
              (record) =>
                String(record.administrative_class ?? '').toLowerCase() === key,
            ),
            count,
          );
          return {
            name,
            enrolled: count,
            totalSessions: part.expected,
            attended: part.attended,
            onTime: part.attended - part.late,
            late: part.late,
            absent: part.expected - part.attended,
            rate: part.expected
              ? Math.round((part.attended / part.expected) * 100)
              : 0,
          };
        })
        .sort(
          (a, b) => b.enrolled - a.enrolled || a.name.localeCompare(b.name),
        );
      return {
        ...klass,
        administrativeClass:
          administrativeClass && administrativeClass !== 'all'
            ? administrativeClass
            : null,
        enrolled,
        sessionsHeld: sessionDates.size,
        unmarkedSessions: unmarked.size,
        totalSessions: expected,
        attended,
        onTime: attended - late,
        late,
        absent: expected - attended,
        rate: expected ? Math.round((attended / expected) * 100) : 0,
        administrativeClassBreakdown,
      };
    });
  }

  /** Bảng chuyên cần từng SV của 1 lớp học phần trong khoảng (ma trận SV × buổi) + cảnh báo vắng cả kỳ. */
  async getClassStudentReport(
    currentUserId: string,
    classId: string,
    query: {
      mode?: string;
      anchorDate?: string;
      semester?: string;
      administrativeClass?: string;
    },
  ) {
    const resolvedId = await this.assertClassAccess(
      currentUserId,
      classId,
      REPORT_ROLES,
    );
    const klass =
      (await this.listClasses(currentUserId)).find(
        (item) => item.id === resolvedId,
      ) ?? null;
    const { start, end } = await this.resolveReportRange(
      query.mode,
      query.anchorDate,
      klass?.semester ?? query.semester,
      klass ? [klass] : [],
    );
    const adminClass = this.normalizeAdminClass(query.administrativeClass);
    const threshold = await this.getAbsenceWarningPercent();
    const [matrix, warnings] = await Promise.all([
      this.buildStudentMatrix([resolvedId], start, end, adminClass),
      this.getSemesterWarnings(
        [klass ?? { id: resolvedId }],
        adminClass,
        threshold,
      ),
    ]);
    const { dates, unmarkedDates, students } = matrix.get(resolvedId) ?? {
      dates: [],
      unmarkedDates: [],
      students: [],
    };
    const rows = students.map((st) => ({
      ...st,
      warning: warnings.byStudent.get(`${resolvedId}|${st.code}`) ?? null,
    }));

    const totals = rows.reduce(
      (acc, row) => ({
        totalSessions: acc.totalSessions + row.totalSessions,
        attended: acc.attended + row.attended,
        onTime: acc.onTime + row.onTime,
        late: acc.late + row.late,
        absent: acc.absent + row.absent,
      }),
      { totalSessions: 0, attended: 0, onTime: 0, late: 0, absent: 0 },
    );
    return {
      class: klass,
      period: { start, end },
      dates,
      unmarkedDates,
      students: rows,
      totals: {
        ...totals,
        sessionsHeld: dates.length - unmarkedDates.length,
        unmarkedSessions: unmarkedDates.length,
        rate: totals.totalSessions
          ? Math.round((totals.attended / totals.totalSessions) * 100)
          : 0,
      },
      warning: {
        threshold,
        provisional: true,
        plan: warnings.plans.get(resolvedId) ?? null,
        exceeded: rows.filter((row) => row.warning?.level === 'exceeded')
          .length,
        near: rows.filter((row) => row.warning?.level === 'near').length,
      },
    };
  }

  /** SV vắng vượt/gần ngưỡng theo cả học kỳ, trong phạm vi lớp người dùng được xem (GV: lớp mình dạy). */
  async getAbsenceWarnings(
    currentUserId: string,
    query: {
      classId?: string;
      semester?: string;
      subjectCode?: string;
      administrativeClass?: string;
    },
  ) {
    const classes = await this.getReportClasses(
      currentUserId,
      query.classId,
      query.semester,
      query.subjectCode,
    );
    const adminClass = this.normalizeAdminClass(query.administrativeClass);
    const threshold = await this.getAbsenceWarningPercent();
    const { plans, entries } = await this.getSemesterWarnings(
      classes,
      adminClass,
      threshold,
    );
    const byId = new Map(classes.map((klass) => [klass.id, klass]));
    const rank: Record<AbsenceLevel, number> = { exceeded: 0, near: 1, ok: 2 };
    const rows = entries
      .filter((entry) => entry.warning.level !== 'ok')
      .map((entry) => {
        const klass = byId.get(entry.classId);
        const plan = plans.get(entry.classId);
        return {
          classId: entry.classId,
          classCode: klass?.code ?? '',
          subjectCode: klass?.subjectCode ?? '',
          subject: klass?.subject ?? '',
          semester: klass?.semester ?? '',
          scheduleIncomplete: plan?.scheduleIncomplete ?? false,
          code: entry.code,
          name: entry.name,
          administrativeClass: entry.administrativeClass,
          ...entry.warning,
        };
      })
      .sort(
        (a, b) =>
          rank[a.level] - rank[b.level] ||
          b.absentPercent - a.absentPercent ||
          a.classCode.localeCompare(b.classCode) ||
          a.code.localeCompare(b.code),
      );
    return {
      threshold,
      provisional: true,
      rows,
      summary: {
        classes: classes.length,
        studentsChecked: entries.length,
        exceeded: rows.filter((row) => row.level === 'exceeded').length,
        near: rows.filter((row) => row.level === 'near').length,
        incompleteClasses: [...plans.values()].filter(
          (plan) => plan.scheduleIncomplete,
        ).length,
      },
    };
  }

  /**
   * Ma trận SV × ngày học của các lớp trong [start, end]. Ngày học = buổi đã diễn ra theo TKB (không hủy)
   * + ngày có bản ghi ngoài TKB. Buổi đã diễn ra mà SV không có bản ghi ⇒ vắng.
   */
  private async buildStudentMatrix(
    classIds: string[],
    start: string,
    end: string,
    adminClass?: string,
  ) {
    const result = new Map<
      string,
      { dates: string[]; unmarkedDates: string[]; students: MatrixStudent[] }
    >();
    if (classIds.length === 0) return result;
    const [enrolled, records, heldByClass, markedByClass] = await Promise.all([
      this.getEnrolledStudentsByClass(classIds),
      this.getAttendanceRecords(classIds, start, end, adminClass),
      this.getHeldSessionDates(classIds, start, end),
      this.getMarkedDates(classIds, start, end),
    ]);
    const group = <T extends { class_id: string }>(items: T[]) => {
      const map = new Map<string, T[]>();
      for (const item of items) {
        const list = map.get(item.class_id) ?? [];
        list.push(item);
        map.set(item.class_id, list);
      }
      return map;
    };
    const enrolledByClass = group(enrolled);
    const recordsByClass = group(records as { class_id: string }[]) as Map<
      string,
      any[]
    >;
    const sameAdmin = (value: string | null) =>
      !adminClass || (value ?? '').toLowerCase() === adminClass.toLowerCase();

    for (const classId of classIds) {
      const { held, unmarked } = this.splitHeldDates(
        heldByClass.get(classId),
        markedByClass.get(classId),
      );
      const classRecords = recordsByClass.get(classId) ?? [];
      const dates = [
        ...new Set([
          ...held,
          ...unmarked,
          ...classRecords.map((record) =>
            this.toDateKey(record.attendance_date),
          ),
        ]),
      ].sort();

      // SV đang học lớp + SV có bản ghi nhưng đã rút khỏi lớp
      const students = new Map<
        string,
        { code: string; name: string; administrativeClass: string | null }
      >();
      for (const st of enrolledByClass.get(classId) ?? []) {
        if (!sameAdmin(st.administrative_class)) continue;
        students.set(st.code, {
          code: st.code,
          name: st.name,
          administrativeClass: st.administrative_class,
        });
      }
      const recordByKey = new Map<string, any>();
      for (const record of classRecords) {
        recordByKey.set(
          `${record.student_code}|${this.toDateKey(record.attendance_date)}`,
          record,
        );
        if (!students.has(record.student_code)) {
          students.set(record.student_code, {
            code: record.student_code,
            name: record.student_name,
            administrativeClass: record.administrative_class,
          });
        }
      }

      const rows: MatrixStudent[] = [...students.values()].map((st) => {
        const days = dates.map((date) => {
          const record = recordByKey.get(`${st.code}|${date}`);
          if (!record) {
            return {
              date,
              status: (unmarked.has(date)
                ? 'unmarked'
                : held.has(date)
                  ? 'absent'
                  : 'none') as DayStatus,
              checkInAt: null,
              checkOutAt: null,
            };
          }
          const present = record.check_in_at && record.status !== 'absent';
          const status: DayStatus = present
            ? record.status === 'late'
              ? 'late'
              : 'on_time'
            : 'absent';
          return {
            date,
            status,
            checkInAt: record.check_in_at ?? null,
            checkOutAt: record.check_out_at ?? null,
          };
        });
        const counted = days.filter(
          (day) => day.status !== 'none' && day.status !== 'unmarked',
        );
        const late = counted.filter((day) => day.status === 'late').length;
        const onTime = counted.filter((day) => day.status === 'on_time').length;
        const attended = late + onTime;
        return {
          ...st,
          totalSessions: counted.length,
          attended,
          onTime,
          late,
          absent: counted.length - attended,
          rate: counted.length
            ? Math.round((attended / counted.length) * 100)
            : 0,
          days,
        };
      });
      result.set(classId, {
        dates,
        unmarkedDates: [...unmarked].sort(),
        students: rows,
      });
    }
    return result;
  }

  /**
   * Cảnh báo vắng theo cả học kỳ của từng SV: số buổi vắng (trong các buổi đã diễn ra) so với tổng số
   * buổi theo TKB cả kỳ. Vượt ngưỡng: vắng > threshold%; gần ngưỡng: vắng từ threshold/2 %.
   */
  private async getSemesterWarnings(
    classes: { id: string; semester?: string | null }[],
    adminClass: string | undefined,
    threshold: number,
  ) {
    const plans = await this.getSemesterPlans(classes);
    const byRange = new Map<string, string[]>();
    for (const [classId, plan] of plans) {
      const key = `${plan.start}|${plan.end}`;
      byRange.set(key, [...(byRange.get(key) ?? []), classId]);
    }
    const byStudent = new Map<string, AbsenceWarning>();
    const entries: {
      classId: string;
      code: string;
      name: string;
      administrativeClass: string | null;
      warning: AbsenceWarning;
    }[] = [];
    for (const [key, classIds] of byRange) {
      const [start, end] = key.split('|');
      const matrix = await this.buildStudentMatrix(
        classIds,
        start,
        end,
        adminClass,
      );
      for (const classId of classIds) {
        const plan = plans.get(classId)!;
        for (const st of matrix.get(classId)?.students ?? []) {
          const planned = Math.max(plan.plannedSessions, st.totalSessions);
          const allowed = Math.floor((planned * threshold) / 100);
          const absentPercent = planned
            ? Math.round((st.absent * 100) / planned)
            : 0;
          const level: AbsenceLevel =
            planned === 0 || st.absent === 0
              ? 'ok'
              : st.absent > allowed
                ? 'exceeded'
                : absentPercent >= threshold / 2
                  ? 'near'
                  : 'ok';
          const warning: AbsenceWarning = {
            plannedSessions: planned,
            heldSessions: st.totalSessions,
            attended: st.attended,
            late: st.late,
            absent: st.absent,
            absentPercent,
            allowedAbsences: allowed,
            remaining: Math.max(allowed - st.absent, 0),
            level,
          };
          byStudent.set(`${classId}|${st.code}`, warning);
          entries.push({
            classId,
            code: st.code,
            name: st.name,
            administrativeClass: st.administrativeClass,
            warning,
          });
        }
      }
    }
    return { plans, byStudent, entries };
  }

  /**
   * Kế hoạch cả học kỳ theo TKB đã đồng bộ: số buổi (ngày học), số buổi đã diễn ra, tổng tiết.
   * TKB bị coi là chưa đủ khi tổng tiết < tín chỉ × 15 (quy ước suy từ dữ liệu, chưa chốt với UEL).
   */
  private async getSemesterPlans(
    classes: { id: string; semester?: string | null }[],
  ) {
    const result = new Map<string, SemesterPlan>();
    const bySemester = new Map<string, string[]>();
    for (const klass of classes) {
      const name = klass.semester || 'all';
      bySemester.set(name, [...(bySemester.get(name) ?? []), klass.id]);
    }
    for (const [semester, classIds] of bySemester) {
      const { start, end } = await this.resolveReportRange(
        'semester',
        undefined,
        semester,
        [],
      );
      const rows = (await this.dataSource.manager.query(
        `
        SELECT cs.id AS class_id,
               COUNT(DISTINCT se.session_date)::int AS planned,
               COUNT(DISTINCT se.session_date) FILTER (WHERE se.start_time <= now())::int AS held,
               COUNT(DISTINCT se.session_date) FILTER (
                 WHERE se.start_time <= now()
                   AND NOT EXISTS (SELECT 1 FROM class_attendance_records car
                                    WHERE car.class_section_id = cs.id
                                      AND car.attendance_date = se.session_date)
               )::int AS unmarked,
               COALESCE(SUM(se.period_count), 0)::int AS periods,
               MAX(subj.credits) AS credits
          FROM class_sections cs
          LEFT JOIN subjects subj ON subj.id = cs.subject_id
          LEFT JOIN class_sessions se
            ON se.class_section_id = cs.id
           AND se.status <> 'cancelled'
           AND se.session_date BETWEEN $2::date AND $3::date
         WHERE cs.id = ANY($1::uuid[])
         GROUP BY cs.id
        `,
        [classIds, start, end],
      )) as {
        class_id: string;
        planned: number;
        held: number;
        unmarked: number;
        periods: number;
        credits: number | string | null;
      }[];
      for (const row of rows) {
        const credits = Number(row.credits);
        const expectedPeriods =
          Number.isFinite(credits) && credits > 0 ? credits * 15 : null;
        result.set(row.class_id, {
          start,
          end,
          plannedSessions: Number(row.planned),
          heldSessions: Number(row.held),
          unmarkedSessions: Number(row.unmarked),
          plannedPeriods: Number(row.periods),
          expectedPeriods,
          scheduleIncomplete:
            expectedPeriods !== null && Number(row.periods) < expectedPeriods,
        });
      }
    }
    return result;
  }

  /** SV đang học (status active) của nhiều lớp học phần. */
  private async getEnrolledStudentsByClass(classIds: string[]) {
    if (classIds.length === 0) return [];
    return (await this.dataSource.manager.query(
      `
      SELECT ce.class_section_id AS class_id,
             st.student_code AS code,
             st.administrative_class,
             u.full_name AS name
        FROM class_enrollments ce
        JOIN students st ON st.id = ce.student_id AND st.deleted_at IS NULL
        JOIN users u ON u.id = st.user_id AND u.deleted_at IS NULL
       WHERE ce.class_section_id = ANY($1::uuid[])
         AND ce.status = 'active'
       ORDER BY st.student_code ASC
      `,
      [classIds],
    )) as {
      class_id: string;
      code: string;
      administrative_class: string | null;
      name: string;
    }[];
  }

  /**
   * Lịch học từng lớp lấy từ class_sessions (TKB UEL): các khung thứ/tiết lặp lại, buổi kế tiếp
   * (chưa kết thúc, không bị hủy) và lớp có học hôm nay không — để GV nhiều lớp biết lớp nào sắp học.
   */
  private async getClassScheduleInfo(classIds: string[]) {
    const result = new Map<
      string,
      {
        slots: {
          weekday: number;
          periodStart: number | null;
          periodCount: number | null;
          sessions: number;
        }[];
        nextSession: {
          date: string;
          startTime: string;
          endTime: string;
          periodStart: number | null;
          periodCount: number | null;
          room: string | null;
        } | null;
        hasSessionToday: boolean;
      }
    >();
    if (classIds.length === 0) return result;
    const today = this.todayKey();
    const [slotRows, nextRows, todayRows] = await Promise.all([
      this.dataSource.manager.query(
        `SELECT se.class_section_id AS class_id,
                EXTRACT(ISODOW FROM se.session_date)::int AS weekday,
                se.period_start, se.period_count, COUNT(*)::int AS sessions
           FROM class_sessions se
          WHERE se.class_section_id = ANY($1::uuid[]) AND se.status <> 'cancelled'
          GROUP BY 1, 2, 3, 4
          ORDER BY 1, 2, 3`,
        [classIds],
      ) as Promise<
        {
          class_id: string;
          weekday: number;
          period_start: number | null;
          period_count: number | null;
          sessions: number;
        }[]
      >,
      this.dataSource.manager.query(
        `SELECT DISTINCT ON (se.class_section_id)
                se.class_section_id AS class_id, se.session_date::text AS date,
                se.start_time, se.end_time, se.period_start, se.period_count,
                r.room_name AS room
           FROM class_sessions se
           LEFT JOIN rooms r ON r.id = se.room_id
          WHERE se.class_section_id = ANY($1::uuid[])
            AND se.status <> 'cancelled'
            AND se.end_time > now()
          ORDER BY se.class_section_id, se.start_time`,
        [classIds],
      ) as Promise<
        {
          class_id: string;
          date: string;
          start_time: Date;
          end_time: Date;
          period_start: number | null;
          period_count: number | null;
          room: string | null;
        }[]
      >,
      this.dataSource.manager.query(
        `SELECT DISTINCT se.class_section_id AS class_id
           FROM class_sessions se
          WHERE se.class_section_id = ANY($1::uuid[])
            AND se.status <> 'cancelled'
            AND se.session_date = $2::date`,
        [classIds, today],
      ) as Promise<{ class_id: string }[]>,
    ]);
    const todaySet = new Set(todayRows.map((row) => row.class_id));
    for (const row of slotRows) {
      const item = result.get(row.class_id) ?? {
        slots: [],
        nextSession: null,
        hasSessionToday: false,
      };
      item.slots.push({
        weekday: Number(row.weekday),
        periodStart: row.period_start,
        periodCount: row.period_count,
        sessions: Number(row.sessions),
      });
      result.set(row.class_id, item);
    }
    for (const row of nextRows) {
      const item = result.get(row.class_id) ?? {
        slots: [],
        nextSession: null,
        hasSessionToday: false,
      };
      const date = row.date.slice(0, 10);
      item.nextSession = {
        date,
        startTime: this.formatTime(row.start_time),
        endTime: this.formatTime(row.end_time),
        periodStart: row.period_start,
        periodCount: row.period_count,
        room: row.room,
      };
      result.set(row.class_id, item);
    }
    for (const [classId, item] of result) {
      item.hasSessionToday = todaySet.has(classId);
    }
    return result;
  }

  /**
   * Buổi đã diễn ra nhưng CẢ LỚP không có bản ghi nào (camera chưa quét/GV chưa điểm danh) ⇒ "chưa điểm danh":
   * không tính vắng cho SV để tránh cảnh báo sai khi thiết bị không chạy.
   */
  private splitHeldDates(heldAll?: Set<string>, marked?: Set<string>) {
    const held = new Set<string>();
    const unmarked = new Set<string>();
    for (const date of heldAll ?? []) {
      (marked?.has(date) ? held : unmarked).add(date);
    }
    return { held, unmarked };
  }

  /** Ngày có ít nhất 1 bản ghi điểm danh (của bất kỳ SV nào) theo lớp — không lọc lớp hành chính. */
  private async getMarkedDates(classIds: string[], start: string, end: string) {
    const result = new Map<string, Set<string>>();
    if (classIds.length === 0) return result;
    const rows = (await this.dataSource.manager.query(
      `SELECT DISTINCT class_section_id AS class_id, attendance_date::text AS date
         FROM class_attendance_records
        WHERE class_section_id = ANY($1::uuid[])
          AND attendance_date BETWEEN $2::date AND $3::date`,
      [classIds, start, end],
    )) as { class_id: string; date: string }[];
    for (const row of rows) {
      const set = result.get(row.class_id) ?? new Set<string>();
      set.add(row.date.slice(0, 10));
      result.set(row.class_id, set);
    }
    return result;
  }

  private normalizeAdminClass(value?: string) {
    return value && value !== 'all' ? value : undefined;
  }

  private async getAbsenceWarningPercent() {
    const rows = (await this.dataSource.manager.query(
      `SELECT config_value FROM system_configs
        WHERE config_key = $1 AND is_active = true
        LIMIT 1`,
      [CLASS_ATTENDANCE_ABSENCE_WARNING_KEY],
    )) as { config_value: string | null }[];
    const value = Number(rows[0]?.config_value);
    return Number.isFinite(value) && value > 0 && value <= 100
      ? value
      : DEFAULT_ABSENCE_WARNING_PERCENT;
  }

  /** Ngày (yyyy-MM-dd) có buổi học đã bắt đầu, không bị hủy — theo từng lớp học phần. */
  private async getHeldSessionDates(
    classIds: string[],
    start: string,
    end: string,
  ) {
    const result = new Map<string, Set<string>>();
    if (classIds.length === 0) return result;
    const rows = (await this.dataSource.manager.query(
      `
      SELECT se.class_section_id AS class_id, se.session_date::text AS date
        FROM class_sessions se
       WHERE se.class_section_id = ANY($1::uuid[])
         AND se.session_date BETWEEN $2::date AND $3::date
         AND se.status <> 'cancelled'
         AND se.start_time <= now()
       GROUP BY 1, 2
      `,
      [classIds, start, end],
    )) as { class_id: string; date: string }[];
    for (const row of rows) {
      const set = result.get(row.class_id) ?? new Set<string>();
      set.add(row.date.slice(0, 10));
      result.set(row.class_id, set);
    }
    return result;
  }

  /** Sĩ số đang học theo lớp học phần (lọc theo lớp hành chính nếu có). */
  private async getEnrollmentCounts(
    classIds: string[],
    administrativeClass?: string,
  ) {
    const result = new Map<string, number>();
    if (classIds.length === 0) return result;
    const rows = (await this.dataSource.manager.query(
      `
      SELECT ce.class_section_id AS class_id, COUNT(*)::int AS total
        FROM class_enrollments ce
        JOIN students st ON st.id = ce.student_id AND st.deleted_at IS NULL
       WHERE ce.class_section_id = ANY($1::uuid[])
         AND ce.status = 'active'
         AND ($2::varchar IS NULL OR lower(st.administrative_class) = lower($2::varchar))
       GROUP BY 1
      `,
      [
        classIds,
        administrativeClass && administrativeClass !== 'all'
          ? administrativeClass
          : null,
      ],
    )) as { class_id: string; total: number }[];
    for (const row of rows) result.set(row.class_id, Number(row.total));
    return result;
  }

  /** Sĩ số đang học theo (lớp học phần, lớp hành chính) — bỏ qua SV chưa có lớp hành chính. */
  private async getEnrollmentCountsByAdminClass(
    classIds: string[],
    administrativeClass?: string,
  ) {
    const result = new Map<string, Map<string, number>>();
    if (classIds.length === 0) return result;
    const rows = (await this.dataSource.manager.query(
      `
      SELECT ce.class_section_id AS class_id,
             st.administrative_class AS name,
             COUNT(*)::int AS total
        FROM class_enrollments ce
        JOIN students st ON st.id = ce.student_id AND st.deleted_at IS NULL
       WHERE ce.class_section_id = ANY($1::uuid[])
         AND ce.status = 'active'
         AND st.administrative_class IS NOT NULL
         AND ($2::varchar IS NULL OR lower(st.administrative_class) = lower($2::varchar))
       GROUP BY 1, 2
      `,
      [
        classIds,
        administrativeClass && administrativeClass !== 'all'
          ? administrativeClass
          : null,
      ],
    )) as { class_id: string; name: string; total: number }[];
    for (const row of rows) {
      const map = result.get(row.class_id) ?? new Map<string, number>();
      map.set(row.name, Number(row.total));
      result.set(row.class_id, map);
    }
    return result;
  }

  /** mode=semester → theo ngày bắt đầu/kết thúc học kỳ (bảng semesters); còn lại ngày/tuần/tháng/năm. */
  private async resolveReportRange(
    mode: string | undefined,
    anchorDate: string | undefined,
    semester: string | undefined,
    classes: any[],
  ) {
    if (mode !== 'semester') return this.getRangeBounds(mode, anchorDate);
    const names =
      semester && semester !== 'all'
        ? [semester]
        : [...new Set(classes.map((klass) => klass.semester).filter(Boolean))];
    if (names.length > 0) {
      const rows = (await this.dataSource.manager.query(
        `SELECT MIN(start_date)::text AS start, MAX(end_date)::text AS end
           FROM semesters
          WHERE deleted_at IS NULL
            AND (semester_name = ANY($1::varchar[]) OR semester_code = ANY($1::varchar[]))`,
        [names],
      )) as { start: string | null; end: string | null }[];
      if (rows[0]?.start && rows[0]?.end) {
        return {
          start: rows[0].start.slice(0, 10),
          end: rows[0].end.slice(0, 10),
        };
      }
    }
    return this.getSemesterBounds(semester);
  }

  private async getAttendanceRecords(
    classIds: string[],
    start: string,
    end: string,
    administrativeClass?: string,
  ) {
    if (classIds.length === 0) return [];
    return (await this.dataSource.manager.query(
      `
      SELECT car.class_section_id AS class_id,
             cs.class_code,
             subj.subject_code,
             subj.subject_name,
             COALESCE(room.room_name, split_part(cs.note, ' | ', 2)) AS room,
             car.attendance_date,
             car.check_in_at,
             car.check_out_at,
             COALESCE(car.status, 'absent') AS status,
             car.confidence,
             car.evidence_image,
             st.student_code,
             st.administrative_class,
             u.full_name AS student_name
        FROM class_attendance_records car
        JOIN class_sections cs ON cs.id = car.class_section_id
        JOIN subjects subj ON subj.id = cs.subject_id
        JOIN students st ON st.id = car.student_id
        JOIN users u ON u.id = st.user_id
        LEFT JOIN rooms room ON room.id = cs.default_room_id
       WHERE car.class_section_id = ANY($1::uuid[])
         AND car.attendance_date BETWEEN $2::date AND $3::date
         AND ($4::varchar IS NULL OR lower(st.administrative_class) = lower($4::varchar))
       ORDER BY car.attendance_date ASC, cs.class_code ASC, st.student_code ASC
      `,
      [
        classIds,
        start,
        end,
        administrativeClass && administrativeClass !== 'all'
          ? administrativeClass
          : null,
      ],
    )) as any[];
  }

  private summarizeReportRows(rows: any[]) {
    const totals = rows.reduce(
      (acc, item) => ({
        totalSessions: acc.totalSessions + item.totalSessions,
        attended: acc.attended + item.attended,
        onTime: acc.onTime + item.onTime,
        late: acc.late + item.late,
        absent: acc.absent + item.absent,
        sessionsHeld: acc.sessionsHeld + (item.sessionsHeld ?? 0),
        unmarkedSessions: acc.unmarkedSessions + (item.unmarkedSessions ?? 0),
      }),
      {
        totalSessions: 0,
        attended: 0,
        onTime: 0,
        late: 0,
        absent: 0,
        sessionsHeld: 0,
        unmarkedSessions: 0,
      },
    );
    return {
      ...totals,
      rate: totals.totalSessions
        ? Math.round((totals.attended / totals.totalSessions) * 100)
        : 0,
    };
  }

  private getSemesterBounds(semester?: string) {
    if (!semester || semester === 'all') {
      return { start: '1900-01-01', end: '2999-12-31' };
    }
    const match = semester.match(/(\d{4})-(\d{4})/);
    const startYear = match ? Number(match[1]) : new Date().getFullYear();
    const endYear = match ? Number(match[2]) : startYear + 1;
    if (semester.toUpperCase().startsWith('HK2')) {
      return {
        start: `${endYear}-01-01`,
        end: `${endYear}-05-31`,
      };
    }
    return {
      start: `${startYear}-09-01`,
      end: `${endYear}-01-15`,
    };
  }

  private csvEscape(value: unknown) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private safeFilename(value: string) {
    return String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  private async resolveStudent(
    userId: string,
    requestedStudentId: string | undefined,
    roles: RoleCode[],
  ) {
    const params: unknown[] = [];
    let where = `st.user_id = $1`;
    params.push(userId);
    if (
      requestedStudentId &&
      (roles.includes('SYSTEM_ADMIN') ||
        roles.includes('ADMIN') ||
        roles.includes('BUSINESS_ADMIN') ||
        roles.includes('TEACHER'))
    ) {
      where = `(st.id::text = $1::text OR st.student_code = $1::varchar)`;
      params[0] = requestedStudentId;
    }
    const rows = (await this.dataSource.manager.query(
      `
      SELECT st.id, st.user_id, st.student_code AS code, u.full_name AS name, u.email
        FROM students st
        JOIN users u ON u.id = st.user_id
       WHERE ${where}
         AND st.deleted_at IS NULL
       LIMIT 1
      `,
      params,
    )) as StudentRow[];
    if (!rows[0]) throw new BadRequestException('Không tìm thấy sinh viên.');
    return rows[0];
  }

  private summarizeRows(rows: any[]) {
    return {
      total: rows.length,
      checkedIn: rows.filter((row) => row.checkInAt).length,
      late: rows.filter((row) => row.status === 'late').length,
      left: rows.filter((row) => row.checkOutAt).length,
      missing: rows.filter((row) => !row.checkInAt).length,
    };
  }

  private summarizeEntries(entries: any[]) {
    const attended = entries.filter((item) => item.checkInAt).length;
    const late = entries.filter((item) => item.status === 'late').length;
    const onTime = entries.filter(
      (item) => item.status === 'on_time' || item.status === 'left',
    ).length;
    const absent = entries.filter(
      (item) => !item.checkInAt || item.status === 'absent',
    ).length;
    return {
      totalSessions: entries.length,
      attended,
      onTime,
      late,
      absent,
      attendanceRate: entries.length
        ? Math.round((attended / entries.length) * 100)
        : 0,
    };
  }

  private getScopedConfigKey(
    key: string,
    classId?: string,
    administrativeClass?: string,
  ) {
    if (!classId) return key;
    const scope = `${classId}.${administrativeClass || 'all'}`.replace(
      /[^a-zA-Z0-9_.-]/g,
      '_',
    );
    return `${key}.${scope}`;
  }

  private async getClassAttendanceConfigValues(
    classId?: string,
    administrativeClass?: string,
  ) {
    const scopedKeys = [
      this.getScopedConfigKey(
        CLASS_ATTENDANCE_START_TIME_KEY,
        classId,
        administrativeClass,
      ),
      this.getScopedConfigKey(
        CLASS_ATTENDANCE_LATE_THRESHOLD_KEY,
        classId,
        administrativeClass,
      ),
      this.getScopedConfigKey(
        CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY,
        classId,
        administrativeClass,
      ),
    ];
    const rows = (await this.dataSource.manager.query(
      `SELECT config_key, config_value
         FROM system_configs
        WHERE config_key = ANY($1::varchar[])
          AND is_active = true`,
      [
        classId
          ? [
              ...scopedKeys,
              CLASS_ATTENDANCE_START_TIME_KEY,
              CLASS_ATTENDANCE_LATE_THRESHOLD_KEY,
              CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY,
            ]
          : [
              CLASS_ATTENDANCE_START_TIME_KEY,
              CLASS_ATTENDANCE_LATE_THRESHOLD_KEY,
              CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY,
            ],
      ],
    )) as Array<{ config_key: string; config_value: string | null }>;
    const byKey = new Map(
      rows.map((row) => [row.config_key, row.config_value]),
    );
    const classStartTime =
      byKey.get(scopedKeys[0]) ??
      byKey.get(CLASS_ATTENDANCE_START_TIME_KEY) ??
      DEFAULT_CLASS_START_TIME;
    const lateThresholdValue =
      byKey.get(scopedKeys[1]) ??
      byKey.get(CLASS_ATTENDANCE_LATE_THRESHOLD_KEY);
    const autoScanIntervalValue =
      byKey.get(scopedKeys[2]) ??
      byKey.get(CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY);
    const lateThresholdMinutes = Number(
      lateThresholdValue ?? DEFAULT_LATE_THRESHOLD_MINUTES,
    );
    const autoScanIntervalSeconds = Number(
      autoScanIntervalValue ?? DEFAULT_AUTO_SCAN_INTERVAL_SECONDS,
    );
    return {
      classStartTime: /^\d{2}:\d{2}$/.test(classStartTime)
        ? classStartTime
        : DEFAULT_CLASS_START_TIME,
      lateThresholdMinutes: Number.isFinite(lateThresholdMinutes)
        ? lateThresholdMinutes
        : DEFAULT_LATE_THRESHOLD_MINUTES,
      autoScanIntervalSeconds: Number.isFinite(autoScanIntervalSeconds)
        ? autoScanIntervalSeconds
        : DEFAULT_AUTO_SCAN_INTERVAL_SECONDS,
    };
  }

  private async upsertConfig(
    key: string,
    value: string,
    valueType: 'string' | 'number',
    userId: string,
  ) {
    await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `SELECT id
           FROM system_configs
          WHERE config_key = $1::varchar
          ORDER BY updated_at DESC NULLS LAST
          FOR UPDATE`,
        [key],
      )) as Array<{ id: string }>;
      if (rows[0]) {
        await manager.query(
          `UPDATE system_configs
              SET config_value = $2::text,
                  value_type = $3::varchar,
                  config_group = 'class_attendance',
                  description = $4::text,
                  is_active = true,
                  updated_by = $5::uuid,
                  updated_at = now(),
                  version_no = COALESCE(version_no, 1) + 1
            WHERE id = $1::uuid`,
          [rows[0].id, value, valueType, this.configDescription(key), userId],
        );
        return;
      }

      await manager.query(
        `INSERT INTO system_configs (
           config_key, config_value, value_type, config_group, description,
           is_sensitive, is_active, version_no, updated_by
         )
         VALUES ($1::varchar, $2::text, $3::varchar, 'class_attendance',
                 $4::text, false, true, 1, $5::uuid)`,
        [key, value, valueType, this.configDescription(key), userId],
      );
    });
  }

  private configDescription(key: string) {
    if (key === CLASS_ATTENDANCE_START_TIME_KEY) {
      return 'Giờ bắt đầu vào học mặc định cho điểm danh lớp học';
    }
    if (key === CLASS_ATTENDANCE_LATE_THRESHOLD_KEY) {
      return 'Số phút cho phép sau giờ vào học trước khi đánh dấu đi muộn';
    }
    return 'Chu kỳ quét FaceID tự động cho điểm danh lớp học';
  }

  private isLate(
    date: Date,
    settings: { classStartTime: string; lateThresholdMinutes: number },
  ) {
    const limit = new Date(date);
    const [hour, minute] = settings.classStartTime.split(':').map(Number);
    limit.setHours(hour ?? 8, minute ?? 0, 0, 0);
    limit.setMinutes(limit.getMinutes() + settings.lateThresholdMinutes);
    return date.getTime() > limit.getTime();
  }

  private getRangeBounds(mode = 'day', anchorDate?: string) {
    const start = anchorDate ? new Date(`${anchorDate}T00:00:00`) : new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (mode === 'week') {
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - day + 1);
      end.setTime(start.getTime());
      end.setDate(start.getDate() + 6);
    } else if (mode === 'month') {
      start.setDate(1);
      end.setMonth(start.getMonth() + 1, 0);
    } else if (mode === 'year') {
      start.setMonth(0, 1);
      end.setMonth(11, 31);
    }
    return { start: this.dateKey(start), end: this.dateKey(end) };
  }

  private todayKey() {
    return this.dateKey(new Date());
  }

  private dateKey(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatTime(value: Date | string | null | undefined) {
    if (!value) return '--:--';
    return new Date(value).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private toDateKey(value: Date | string) {
    if (value instanceof Date) {
      return this.dateKey(value);
    }
    return value.slice(0, 10);
  }

  private formatDateText(value: Date | string) {
    return new Date(`${this.toDateKey(value)}T00:00:00`).toLocaleDateString(
      'vi-VN',
      {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      },
    );
  }

  private statusLabel(status: string | null | undefined) {
    if (status === 'late') return 'Đi muộn';
    if (status === 'on_time') return 'Đúng giờ';
    if (status === 'left') return 'Đã rời lớp';
    if (status === 'absent') return 'Vắng';
    return 'Chưa điểm danh';
  }
}
