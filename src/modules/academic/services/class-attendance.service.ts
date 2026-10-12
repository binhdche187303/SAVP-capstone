import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

type RoleCode = 'SYSTEM_ADMIN' | 'ADMIN' | 'BUSINESS_ADMIN' | 'TEACHER' | 'STUDENT' | string;

interface ClassRow {
  id: string;
  code: string;
  subject: string;
  semester: string;
  teacher: string | null;
  room: string | null;
  schedule: string | null;
  schedule_weekday: number | null;
  student_count: string;
}

interface StudentRow {
  id: string;
  user_id: string;
  code: string;
  name: string;
  email: string | null;
}

interface AttendanceRow {
  id: string | null;
  student_id: string;
  check_in_at: Date | string | null;
  check_out_at: Date | string | null;
  status: string | null;
  confidence: number | null;
  evidence_image: string | null;
}

const DEFAULT_CLASS_START_TIME = '08:00';
const DEFAULT_LATE_THRESHOLD_MINUTES = 10;
const DEFAULT_AUTO_SCAN_INTERVAL_SECONDS = 4;
const CLASS_ATTENDANCE_START_TIME_KEY = 'class_attendance.default_start_time';
const CLASS_ATTENDANCE_LATE_THRESHOLD_KEY =
  'class_attendance.late_threshold_minutes';
const CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY =
  'class_attendance.auto_scan_interval_seconds';

@Injectable()
export class ClassAttendanceService {
  constructor(private readonly dataSource: DataSource) {}

  async getSettings() {
    const values = await this.getClassAttendanceConfigValues();
    return {
      classStartTime: values.classStartTime,
      lateThresholdMinutes: values.lateThresholdMinutes,
      autoScanIntervalSeconds: values.autoScanIntervalSeconds,
      semester: 'HK1 2026-2027',
    };
  }

  async updateSettings(
    currentUserId: string,
    body: {
      classStartTime?: string;
      lateThresholdMinutes?: number;
      autoScanIntervalSeconds?: number;
    },
  ) {
    const roles = await this.getRoleCodes(currentUserId);
    if (!roles.includes('SYSTEM_ADMIN') && !roles.includes('ADMIN')) {
      throw new ForbiddenException('Bạn không có quyền cập nhật cấu hình điểm danh lớp học.');
    }

    const current = await this.getSettings();
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
      throw new BadRequestException('lateThresholdMinutes must be between 0 and 240');
    }
    if (next.autoScanIntervalSeconds < 2 || next.autoScanIntervalSeconds > 300) {
      throw new BadRequestException('autoScanIntervalSeconds must be between 2 and 300');
    }

    await this.upsertConfig(
      CLASS_ATTENDANCE_START_TIME_KEY,
      next.classStartTime,
      'string',
      currentUserId,
    );
    await this.upsertConfig(
      CLASS_ATTENDANCE_LATE_THRESHOLD_KEY,
      String(next.lateThresholdMinutes),
      'number',
      currentUserId,
    );
    await this.upsertConfig(
      CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY,
      String(next.autoScanIntervalSeconds),
      'number',
      currentUserId,
    );

    return this.getSettings();
  }

  async listClasses(currentUserId: string) {
    const roles = await this.getRoleCodes(currentUserId);
    const where = this.classScopeWhere(roles);
    const params = where.params(currentUserId);
    const rows = (await this.dataSource.manager.query(
      `
      SELECT cs.id,
             cs.class_code AS code,
             subj.subject_name AS subject,
             sem.semester_name AS semester,
             teacher.full_name AS teacher,
             COALESCE(room.room_name, split_part(cs.note, ' | ', 2)) AS room,
             split_part(cs.note, ' | ', 1) AS schedule,
             CASE
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 2%' THEN 1
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 3%' THEN 2
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 4%' THEN 3
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 5%' THEN 4
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 6%' THEN 5
               WHEN split_part(cs.note, ' | ', 1) ILIKE 'Thu 7%' THEN 6
               ELSE NULL
             END AS schedule_weekday,
             COUNT(ce.id)::text AS student_count
        FROM class_sections cs
        JOIN subjects subj ON subj.id = cs.subject_id
        JOIN semesters sem ON sem.id = cs.semester_id
        LEFT JOIN users teacher ON teacher.id = cs.lecturer_user_id
        LEFT JOIN rooms room ON room.id = cs.default_room_id
        LEFT JOIN class_enrollments ce ON ce.class_section_id = cs.id AND ce.status = 'active'
        ${where.sql}
       GROUP BY cs.id, subj.subject_name, sem.semester_name, teacher.full_name, room.room_name
       ORDER BY cs.class_code ASC
      `,
      params,
    )) as ClassRow[];

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      subject: row.subject,
      semester: row.semester,
      teacher: row.teacher ?? '',
      room: row.room ?? '',
      schedule: row.schedule ?? '',
      scheduleWeekday: row.schedule_weekday,
      studentCount: Number(row.student_count ?? 0),
    }));
  }

  async getRows(currentUserId: string, classId: string, date = this.todayKey()) {
    const resolvedClassId = await this.assertClassAccess(currentUserId, classId);
    const students = await this.getClassStudents(resolvedClassId);
    const records = (await this.dataSource.manager.query(
      `
      SELECT car.id,
             car.student_id,
             car.check_in_at,
             car.check_out_at,
             car.status,
             car.confidence,
             car.evidence_image
        FROM class_attendance_records car
       WHERE car.class_section_id = $1
         AND car.attendance_date = $2::date
      `,
      [resolvedClassId, date],
    )) as AttendanceRow[];
    const byStudent = new Map(records.map((record) => [record.student_id, record]));

    return students.map((student) => {
      const record = byStudent.get(student.id);
      const status = record?.status ?? 'not_checked';
      return {
        id: student.id,
        code: student.code,
        name: student.name,
        email: student.email,
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
      };
    });
  }

  async getSummary(currentUserId: string, classId: string, date = this.todayKey()) {
    const rows = await this.getRows(currentUserId, classId, date);
    return this.summarizeRows(rows);
  }

  async scan(
    currentUserId: string,
    body: {
      classId?: string;
      direction?: 'in' | 'out' | 'enter' | 'leave';
      snapshotImageBase64?: string;
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

    const direction = body.direction === 'out' || body.direction === 'leave' ? 'out' : 'in';
    const date = this.todayKey();
    const students = await this.getClassStudents(classId);
    const rows = await this.getRows(currentUserId, classId, date);
    const target =
      direction === 'out'
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

    const student = students.find((item) => item.id === target.studentId);
    if (!student) {
      throw new BadRequestException('Student not found in class');
    }

    const now = new Date();
    let status = target.status;
    if (direction === 'in') {
      const settings = await this.getClassAttendanceConfigValues();
      status = this.isLate(now, settings) ? 'late' : 'on_time';
    } else {
      status = 'left';
    }

    const inserted = (await this.dataSource.manager.query(
      `
      INSERT INTO class_attendance_records (
        class_section_id, student_id, attendance_date, check_in_at, check_out_at,
        status, confidence, evidence_image, source, updated_at
      )
      VALUES (
        $1, $2, $3::date,
        CASE WHEN $4 = 'in' THEN $5::timestamptz ELSE NULL END,
        CASE WHEN $4 = 'out' THEN $5::timestamptz ELSE NULL END,
        $6, 94, $7, $8, now()
      )
      ON CONFLICT (class_section_id, student_id, attendance_date)
      DO UPDATE SET
        check_in_at = COALESCE(class_attendance_records.check_in_at, EXCLUDED.check_in_at),
        check_out_at = CASE
          WHEN $4 = 'out' THEN COALESCE(EXCLUDED.check_out_at, class_attendance_records.check_out_at)
          ELSE class_attendance_records.check_out_at
        END,
        status = $6,
        confidence = 94,
        evidence_image = COALESCE($7, class_attendance_records.evidence_image),
        source = $8,
        updated_at = now()
      RETURNING id, student_id, check_in_at, check_out_at, status, confidence, evidence_image
      `,
      [
        classId,
        student.id,
        date,
        direction,
        now.toISOString(),
        status,
        body.snapshotImageBase64 ?? null,
        body.snapshotImageBase64 ? 'webcam' : 'camera',
      ],
    )) as AttendanceRow[];

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
        message:
          direction === 'out'
            ? `${student.name} đã rời lớp.`
            : `${student.name} đã điểm danh ${status === 'late' ? 'đi muộn' : 'đúng giờ'}.`,
      },
    };
  }

  async getStudentReport(
    currentUserId: string,
    query: { studentId?: string; mode?: string; anchorDate?: string },
  ) {
    const roles = await this.getRoleCodes(currentUserId);
    const student = await this.resolveStudent(currentUserId, query.studentId, roles);
    const { start, end } = this.getRangeBounds(query.mode, query.anchorDate);
    const rows = (await this.dataSource.manager.query(
      `
      SELECT cs.id AS class_id,
             cs.class_code,
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
       ORDER BY car.attendance_date DESC NULLS LAST, cs.class_code ASC
      `,
      [student.id, start, end],
    )) as any[];

    const entries = rows
      .filter((row) => row.attendance_date)
      .map((row) => ({
        id: `${row.class_id}-${student.id}-${this.toDateKey(row.attendance_date)}`,
        date: this.toDateKey(row.attendance_date),
        dateText: this.formatDateText(row.attendance_date),
        classId: row.class_id,
        classCode: row.class_code,
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
          rate: summary.total ? Math.round((summary.checkedIn / summary.total) * 100) : 0,
        };
      }),
    );
    return rows;
  }

  async getTeacherReport(
    currentUserId: string,
    query: { classId?: string; semester?: string; mode?: string; anchorDate?: string },
  ) {
    const classes = await this.getReportClasses(currentUserId, query.classId, query.semester);
    const { start, end } = this.getRangeBounds(query.mode, query.anchorDate);
    const rows = await this.buildClassReportRows(classes, start, end);
    const totals = this.summarizeReportRows(rows);
    return {
      period: { start, end },
      rows,
      totals,
    };
  }

  async exportSemesterCsv(
    currentUserId: string,
    query: { classId?: string; semester?: string },
  ) {
    const classes = await this.getReportClasses(currentUserId, query.classId, query.semester);
    const { start, end } = this.getSemesterBounds(query.semester);
    const records = await this.getAttendanceRecords(classes.map((klass) => klass.id), start, end);
    const byClass = new Map(classes.map((klass) => [klass.id, klass]));
    const rows = [
      [
        'Học kỳ',
        'Mã lớp',
        'Môn học',
        'Phòng học',
        'Giảng viên',
        'Ngày học',
        'Mã SV',
        'Sinh viên',
        'Giờ vào',
        'Giờ ra',
        'Trạng thái',
        'Ảnh bằng chứng',
      ],
      ...records.map((record) => {
        const klass = byClass.get(record.class_id);
        return [
          klass?.semester ?? '',
          klass?.code ?? record.class_code ?? '',
          klass?.subject ?? record.subject_name ?? '',
          klass?.room ?? record.room ?? '',
          klass?.teacher ?? '',
          this.formatDateText(record.attendance_date),
          record.student_code ?? '',
          record.student_name ?? '',
          this.formatTime(record.check_in_at),
          this.formatTime(record.check_out_at),
          this.statusLabel(record.status),
          record.evidence_image ? 'Có' : 'Không',
        ];
      }),
    ];

    const classPart =
      query.classId && query.classId !== 'all'
        ? this.safeFilename(classes[0]?.code ?? query.classId)
        : 'tat-ca-mon';
    const semesterPart = this.safeFilename(query.semester || 'tat-ca-hoc-ky');
    return {
      filename: `bang-chuyen-can-${classPart}-${semesterPart}.csv`,
      csv: rows.map((row) => row.map((cell) => this.csvEscape(cell)).join(',')).join('\n'),
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
    if (roles.includes('SYSTEM_ADMIN') || roles.includes('ADMIN') || roles.includes('BUSINESS_ADMIN')) {
      return { sql: `WHERE cs.deleted_at IS NULL`, params: (_userId: string) => [] };
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
    if (allowedRoleCodes && !allowedRoleCodes.some((role) => roles.includes(role))) {
      throw new ForbiddenException('Bạn không có quyền thao tác lớp học này.');
    }
    if (roles.includes('SYSTEM_ADMIN') || roles.includes('ADMIN') || roles.includes('BUSINESS_ADMIN')) {
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
    const normalizedCode = classIdentifier.replace(/[^a-z0-9]/gi, '').toLowerCase();
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

  private async getReportClasses(
    currentUserId: string,
    classId?: string,
    semester?: string,
  ) {
    let classes = await this.listClasses(currentUserId);
    if (semester && semester !== 'all') {
      classes = classes.filter((klass) => klass.semester === semester);
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

  private async buildClassReportRows(classes: any[], start: string, end: string) {
    const records = await this.getAttendanceRecords(classes.map((klass) => klass.id), start, end);
    const recordsByClass = new Map<string, any[]>();
    for (const record of records) {
      const list = recordsByClass.get(record.class_id) ?? [];
      list.push(record);
      recordsByClass.set(record.class_id, list);
    }

    return classes.map((klass) => {
      const classRecords = recordsByClass.get(klass.id) ?? [];
      const totalSessions = classRecords.length;
      const attended = classRecords.filter((record) => record.check_in_at).length;
      const late = classRecords.filter((record) => record.status === 'late').length;
      const absent = classRecords.filter(
        (record) => !record.check_in_at || record.status === 'absent',
      ).length;
      const onTime = classRecords.filter(
        (record) => record.status === 'on_time' || record.status === 'left',
      ).length;
      return {
        ...klass,
        totalSessions,
        attended,
        onTime,
        late,
        absent,
        rate: totalSessions ? Math.round((attended / totalSessions) * 100) : 0,
      };
    });
  }

  private async getAttendanceRecords(classIds: string[], start: string, end: string) {
    if (classIds.length === 0) return [];
    return (await this.dataSource.manager.query(
      `
      SELECT car.class_section_id AS class_id,
             cs.class_code,
             subj.subject_name,
             COALESCE(room.room_name, split_part(cs.note, ' | ', 2)) AS room,
             car.attendance_date,
             car.check_in_at,
             car.check_out_at,
             COALESCE(car.status, 'absent') AS status,
             car.confidence,
             car.evidence_image,
             st.student_code,
             u.full_name AS student_name
        FROM class_attendance_records car
        JOIN class_sections cs ON cs.id = car.class_section_id
        JOIN subjects subj ON subj.id = cs.subject_id
        JOIN students st ON st.id = car.student_id
        JOIN users u ON u.id = st.user_id
        LEFT JOIN rooms room ON room.id = cs.default_room_id
       WHERE car.class_section_id = ANY($1::uuid[])
         AND car.attendance_date BETWEEN $2::date AND $3::date
       ORDER BY car.attendance_date ASC, cs.class_code ASC, st.student_code ASC
      `,
      [classIds, start, end],
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
      }),
      { totalSessions: 0, attended: 0, onTime: 0, late: 0, absent: 0 },
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

  private async resolveStudent(userId: string, requestedStudentId: string | undefined, roles: RoleCode[]) {
    const params: unknown[] = [];
    let where = `st.user_id = $1`;
    params.push(userId);
    if (
      requestedStudentId &&
      (roles.includes('SYSTEM_ADMIN') || roles.includes('ADMIN') || roles.includes('BUSINESS_ADMIN') || roles.includes('TEACHER'))
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
    const onTime = entries.filter((item) => item.status === 'on_time' || item.status === 'left').length;
    const absent = entries.filter((item) => !item.checkInAt || item.status === 'absent').length;
    return {
      totalSessions: entries.length,
      attended,
      onTime,
      late,
      absent,
      attendanceRate: entries.length ? Math.round((attended / entries.length) * 100) : 0,
    };
  }

  private async getClassAttendanceConfigValues() {
    const rows = (await this.dataSource.manager.query(
      `SELECT config_key, config_value
         FROM system_configs
        WHERE config_key = ANY($1::varchar[])
          AND is_active = true`,
      [
        [
          CLASS_ATTENDANCE_START_TIME_KEY,
          CLASS_ATTENDANCE_LATE_THRESHOLD_KEY,
          CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY,
        ],
      ],
    )) as Array<{ config_key: string; config_value: string | null }>;
    const byKey = new Map(rows.map((row) => [row.config_key, row.config_value]));
    const classStartTime =
      byKey.get(CLASS_ATTENDANCE_START_TIME_KEY) ?? DEFAULT_CLASS_START_TIME;
    const lateThresholdMinutes = Number(
      byKey.get(CLASS_ATTENDANCE_LATE_THRESHOLD_KEY) ??
        DEFAULT_LATE_THRESHOLD_MINUTES,
    );
    const autoScanIntervalSeconds = Number(
      byKey.get(CLASS_ATTENDANCE_AUTO_SCAN_INTERVAL_KEY) ??
        DEFAULT_AUTO_SCAN_INTERVAL_SECONDS,
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
    return new Date(`${this.toDateKey(value)}T00:00:00`).toLocaleDateString('vi-VN', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  private statusLabel(status: string | null | undefined) {
    if (status === 'late') return 'Đi muộn';
    if (status === 'on_time') return 'Đúng giờ';
    if (status === 'left') return 'Đã rời lớp';
    if (status === 'absent') return 'Vắng';
    return 'Chưa điểm danh';
  }
}
