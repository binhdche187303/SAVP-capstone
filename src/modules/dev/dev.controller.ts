import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { MailService } from '../mail/mail.service.js';
import { normalizePlate } from '../anpr/utils/normalize-plate.js';
import { StorageService } from '../storage/storage.service.js';
import { saveEventSnapshot } from '../../common/utils/save-event-snapshot.util.js';
import { VehicleControlAlertService } from '../anpr/services/vehicle-control-alert.service.js';
import { FaceAttendanceService } from '../face-access/services/face-attendance.service.js';

interface TestMailBody {
  to?: string;
  subject?: string;
}

interface MockAnprSetupBody {
  gateZoneId?: string;
  gateZoneCode?: string;
  gateZoneName?: string;
  enterChannelId?: number;
  leaveChannelId?: number;
}

interface MockAnprEventBody extends MockAnprSetupBody {
  plateNumber?: string;
  direction?: 'enter' | 'leave';
  vehicleType?: string;
  vehicleColor?: string;
  plateColor?: string;
}

interface MockFaceAttendanceBody {
  meetingId?: string;
  userId?: string;
  direction?: 'in' | 'out' | 'enter' | 'leave';
  verifyTime?: string;
  snapshotImageBase64?: string;
}

interface MockCameraFaceScanBody {
  meetingId?: string;
  direction?: 'in' | 'out' | 'enter' | 'leave';
  verifyTime?: string;
  snapshotImageBase64?: string;
}

const DEFAULT_MOCK_GATE_CODE = 'TEST-GATE-01';
const DEFAULT_MOCK_GATE_NAME = 'Cổng Test Seed Bước 2';
const DEFAULT_MOCK_ENTER_CHANNEL = 9101;
const DEFAULT_MOCK_LEAVE_CHANNEL = 9102;
const MOCK_ANPR_DEVICE_CODE = 'CAMAI-MOCK-ANPR';
const MOCK_ANPR_EVENT_TYPE = 'camera_vehicle_event';
const MOCK_FACE_DEVICE_CODE = 'CAMAI-MOCK-FACE-ATTENDANCE';
const MOCK_FACE_EVENT_TYPE = 'camera_face_event';

/**
 * DevController — Test utilities, chỉ expose khi NODE_ENV=development.
 *
 * Được load bởi DevModule, module này chỉ được import vào AppModule
 * khi NODE_ENV=development.
 *
 * TUYỆT ĐỐI không expose ở production.
 * KHÔNG log bất kỳ secret, credential, password nào.
 */
@ApiTags('Dev (chỉ NODE_ENV=development)')
@Controller('dev')
export class DevController {
  constructor(
    private readonly mailService: MailService,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly vehicleControlAlertService: VehicleControlAlertService,
    private readonly faceAttendanceService: FaceAttendanceService,
  ) {}

  /**
   * Test SMTP connection và gửi email thử.
   *
   * POST /api/v1/dev/test-mail
   * Body: { to?: string, subject?: string }
   *
   * Response: { success, messageId?, error? }
   */
  @Post('test-mail')
  @ApiOperation({
    summary: 'Gửi thử 1 email qua SMTP đang cấu hình (dev only)',
  })
  async testMail(@Body() body: TestMailBody): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    message: string;
  }> {
    const to = body.to ?? 'dev-test@capstone.local';
    const subject = body.subject ?? '[DEV] CAPSTONE Mail Test';

    const result = await this.mailService.sendMail({
      to,
      subject,
      text: 'This is a test email sent from CAPSTONE backend dev utilities.',
      html: '<p>This is a <strong>test email</strong> sent from CAPSTONE backend dev utilities.</p>',
    });

    return {
      ...result,
      message: result.success
        ? `Test email sent successfully to: ${to}`
        : `Test email failed: ${result.error}`,
    };
  }

  /**
   * Kiểm tra SMTP connection (không gửi email).
   *
   * POST /api/v1/dev/test-mail-verify
   */
  @Post('test-mail-verify')
  @ApiOperation({
    summary: 'Kiểm tra kết nối SMTP đang cấu hình, KHÔNG gửi email (dev only)',
  })
  async testMailVerify(): Promise<{ connected: boolean; message: string }> {
    const connected = await this.mailService.verifyConnection();
    return {
      connected,
      message: connected
        ? 'SMTP connection verified successfully.'
        : 'SMTP connection failed — check MAIL_* env variables.',
    };
  }

  /**
   * Tạo camera ảo để FE có thể chọn rồi gọi route ghi hình thật:
   * POST /api/v1/dev/mock-camera
   * Body: { roomId?: uuid, deviceName?: string }
   */
  @Post('mock-camera')
  @ApiOperation({
    summary: 'Tạo IP camera ảo dùng ffmpeg testsrc (dev only)',
  })
  async createMockCamera(
    @Body() body: { roomId?: string; deviceName?: string },
  ): Promise<{ success: boolean; data: any }> {
    const id = randomUUID();
    const code = `MOCK-CAM-${Date.now()}`;
    const rows = await this.dataSource.manager.query(
      `INSERT INTO iot_devices
        (id, device_code, device_name, device_type, room_id, status,
         health_status, metadata_json, created_at, updated_at)
       VALUES ($1,$2,$3,'ip_camera',$4,'online','healthy',$5,now(),now())
       RETURNING id, device_code, device_name, device_type, room_id, metadata_json`,
      [
        id,
        code,
        body.deviceName || 'Mock virtual camera',
        body.roomId || null,
        JSON.stringify({ mock_camera: true, source: 'ffmpeg-testsrc' }),
      ],
    );
    return { success: true, data: rows[0] };
  }

  /**
   * Tạo audio recording session + media_file giả để test luồng transcription mock:
   * POST /api/v1/dev/mock-audio-session
   * Body: { meetingId: uuid, userId?: uuid }
   */
  @Post('mock-audio-session')
  @ApiOperation({
    summary: 'Tạo audio session giả làm input cho transcription mock (dev only)',
  })
  async createMockAudioSession(
    @Body() body: { meetingId: string; userId?: string },
  ): Promise<{ success: boolean; data: any }> {
    const meeting = await this.dataSource.manager.query(
      'SELECT id FROM meetings WHERE id = $1',
      [body.meetingId],
    );
    if (!meeting?.length) {
      return {
        success: false,
        data: { code: 'MEETING_NOT_FOUND', meetingId: body.meetingId },
      };
    }

    const sessionId = randomUUID();
    const mediaFileId = randomUUID();
    await this.dataSource.manager.query(
      `INSERT INTO recording_sessions
        (id, meeting_id, session_type, source_type, started_at, stopped_at,
         status, started_by, stopped_by, storage_provider, storage_path,
         file_size_bytes, duration_seconds, metadata_json)
       VALUES ($1,$2,'audio','manual_upload',now(),now(),'stopped',$3,$3,
         'local',$4,'1',12,$5)`,
      [
        sessionId,
        body.meetingId,
        body.userId || null,
        `mock-audio-${sessionId}.wav`,
        JSON.stringify({ mock_audio: true }),
      ],
    );
    await this.dataSource.manager.query(
      `INSERT INTO media_files
        (id, file_name, file_type, mime_type, storage_provider, storage_key,
         recording_session_id, meeting_id, uploaded_by, file_size_bytes,
         duration_seconds, is_active, metadata_json)
       VALUES ($1,$2,'audio','audio/wav','local',$3,$4,$5,$6,'1',12,true,$7)`,
      [
        mediaFileId,
        `mock-audio-${sessionId}.wav`,
        `mock-audio-${sessionId}.wav`,
        sessionId,
        body.meetingId,
        body.userId || null,
        JSON.stringify({ mock_audio: true }),
      ],
    );

    return {
      success: true,
      data: {
        recordingSessionId: sessionId,
        mediaFileId,
        meetingId: body.meetingId,
      },
    };
  }

  /**
   * Tạo cấu hình ANPR ảo:
   * - zone cổng nếu chưa có
   * - camera ANPR ảo độc lập, không phụ thuộc IVSS bridge
   * - 2 channel nội bộ: vào / ra cùng một cổng
   */
  @Post('mock-anpr-setup')
  @ApiOperation({
    summary: 'Tạo camera ANPR ảo độc lập + channel vào/ra cổng (dev only)',
  })
  async setupMockAnpr(
    @Body() body: MockAnprSetupBody,
  ): Promise<{ success: boolean; data: any }> {
    const data = await this.ensureMockAnprSetup(body);
    return { success: true, data };
  }

  /**
   * Bắn một sự kiện biển số xe giả từ camera ANPR ảo.
   * Xử lý đồng bộ để màn hình dev refresh thấy ngay, không phải chờ queue/bridge.
   */
  @Post('mock-anpr-event')
  @ApiOperation({
    summary: 'Giả lập xe qua cổng bằng camera ANPR ảo đồng bộ (dev only)',
  })
  async mockAnprEvent(
    @Body() body: MockAnprEventBody,
  ): Promise<{ success: boolean; data: any }> {
    const setup = await this.ensureMockAnprSetup(body);
    const direction = body.direction === 'leave' ? 'leave' : 'enter';
    const channelId =
      direction === 'leave' ? setup.leaveChannelId : setup.enterChannelId;
    const plateRaw = body.plateNumber || '30A-123.45';
    const plateNumber = normalizePlate(plateRaw);
    const startedAt = Date.now();

    const result = await this.writeMockAnprEvent({
      gateZoneId: setup.gateZoneId,
      deviceId: setup.cameraDeviceId,
      plateRaw,
      plateNumber,
      channelId,
      direction,
      plateColor: body.plateColor || 'white',
      vehicleColor: body.vehicleColor || 'unknown',
      vehicleType: body.vehicleType || 'CAR',
    });

    return {
      success: true,
      data: {
        accepted: true,
        mode: 'sync-dev-mock',
        latencyMs: Date.now() - startedAt,
        direction,
        channelId,
        plateRaw,
        plateNumber,
        gateZoneId: setup.gateZoneId,
        eventId: result.eventId,
        gateLogId: result.gateLogId,
        matchState: result.matchState,
      },
    };
  }

  /**
   * Bắn một lượt quét FaceID từ camera ảo cho bảng điểm danh.
   * Contract mô phỏng đúng input mà adapter camera thật cần gọi sau này:
   * device + person + direction + verifyTime -> FaceAttendanceService.
   */
  @Post('mock-face-attendance')
  @ApiOperation({
    summary: 'Giả lập camera FaceID quét vào/ra để điểm danh tự động (dev only)',
  })
  async mockFaceAttendance(
    @Body() body: MockFaceAttendanceBody,
  ): Promise<{ success: boolean; data: any }> {
    if (!body.meetingId || !body.userId) {
      return {
        success: false,
        data: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'meetingId và userId là bắt buộc.',
        },
      };
    }

    const meetingRows: Array<{
      id: string;
      room_id: string | null;
      start_time: Date | string;
      end_time: Date | string;
      actual_end_time: Date | string | null;
      status: string;
    }> = await this.dataSource.manager.query(
      `SELECT id, room_id, start_time, end_time, actual_end_time, status
         FROM meetings
        WHERE id = $1
        LIMIT 1`,
      [body.meetingId],
    );
    const meeting = meetingRows[0];
    if (!meeting) {
      return {
        success: false,
        data: { code: 'MEETING_NOT_FOUND', meetingId: body.meetingId },
      };
    }

    const participantRows = await this.dataSource.manager.query(
      `SELECT 1
         FROM meeting_participants
        WHERE meeting_id = $1 AND user_id = $2
        LIMIT 1`,
      [body.meetingId, body.userId],
    );
    if (!participantRows[0]) {
      return {
        success: false,
        data: {
          code: 'USER_NOT_IN_MEETING',
          message: 'User này không nằm trong danh sách người tham dự cuộc họp.',
        },
      };
    }

    const deviceId = await this.ensureMockFaceAttendanceDevice(
      meeting.room_id,
    );
    const personCode = `${body.userId}:${body.meetingId}`;
    await this.ensureMockFaceAttendanceMapping({
      deviceId,
      userId: body.userId,
      meetingId: body.meetingId,
      personCode,
      validFrom: meeting.start_time,
      validTo: meeting.actual_end_time ?? meeting.end_time,
    });

    const direction =
      body.direction === 'out' || body.direction === 'leave' ? 'out' : 'in';
    const accessLogDirection = direction === 'out' ? 'leave' : 'enter';
    const verifyTime = this.resolveMockFaceVerifyTime(
      body.verifyTime,
      meeting.start_time,
      meeting.actual_end_time ?? meeting.end_time,
    );
    const snapshotFileId = await this.saveMockFaceSnapshot(
      body.snapshotImageBase64,
    );

    await this.faceAttendanceService.onVerify({
      deviceId,
      roomId: meeting.room_id,
      personId: body.userId,
      personName: personCode,
      verifyTime,
      direction,
      directionRaw: body.direction ?? direction,
      opendoorWay: 'virtual_face_camera',
    });

    const accessLogRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        `INSERT INTO iot_device_events
           (device_id, room_id, meeting_id, event_type, event_time, source_protocol,
            severity, payload_json, processed_status, snapshot_file_id)
         VALUES ($1, $2, $3, $4, $5, 'http',
                 'info', $6::jsonb, 'processed', $7)
         RETURNING id`,
        [
          deviceId,
          meeting.room_id,
          body.meetingId,
          MOCK_FACE_EVENT_TYPE,
          verifyTime,
          JSON.stringify({
            userId: body.userId,
            direction: accessLogDirection,
            matchState: 'matched',
            similarity: 0.98,
            source: 'camera_api',
            cameraDeviceCode: MOCK_FACE_DEVICE_CODE,
            hasSnapshot: snapshotFileId !== null,
          }),
          snapshotFileId,
        ],
      );

    const records = await this.dataSource.manager.query(
      `SELECT id, meeting_id, user_id, check_in_time, check_out_time,
              attendance_status, is_present, is_late, late_minutes,
              check_in_method, attendance_source, first_detected_at,
              last_detected_at, left_early
         FROM attendance_records
        WHERE meeting_id = $1 AND user_id = $2
        LIMIT 1`,
      [body.meetingId, body.userId],
    );
    const events = await this.dataSource.manager.query(
      `SELECT id, event_type, event_time, source_type
         FROM attendance_events
        WHERE meeting_id = $1 AND user_id = $2
        ORDER BY event_time DESC
        LIMIT 3`,
      [body.meetingId, body.userId],
    );

    return {
      success: true,
      data: {
        mode: 'virtual-face-camera',
        cameraDeviceCode: MOCK_FACE_DEVICE_CODE,
        cameraDeviceId: deviceId,
        meetingId: body.meetingId,
        userId: body.userId,
        direction,
        accessLogDirection,
        verifyTime: verifyTime.toISOString(),
        accessLogEventId: accessLogRows[0]?.id ?? null,
        attendanceRecord: records[0] ?? null,
        recentEvents: events,
        note:
          records[0] == null
            ? 'Camera đã gửi event nhưng service không ghi điểm danh, thường do cuộc họp đã đóng/quá giờ hoặc chưa đủ điều kiện.'
            : 'Đã xử lý qua FaceAttendanceService, cùng luồng với camera thật sau này.',
      },
    };
  }

  @Post('mock-camera-face-scan')
  @ApiOperation({
    summary:
      'Giả lập API camera tự nhận diện FaceID và điểm danh theo ca họp (dev only)',
  })
  async mockCameraFaceScan(
    @Body() body: MockCameraFaceScanBody,
  ): Promise<{ success: boolean; message?: string; data: any }> {
    if (!body.meetingId) {
      return {
        success: false,
        message: 'meetingId là bắt buộc.',
        data: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'meetingId là bắt buộc.',
        },
      };
    }

    const meetingRows: Array<{
      id: string;
      room_id: string | null;
      start_time: Date | string;
      end_time: Date | string;
      actual_end_time: Date | string | null;
      status: string;
    }> = await this.dataSource.manager.query(
      `SELECT id, room_id, start_time, end_time, actual_end_time, status
         FROM meetings
        WHERE id = $1
        LIMIT 1`,
      [body.meetingId],
    );
    const meeting = meetingRows[0];
    if (!meeting) {
      return {
        success: false,
        data: { code: 'MEETING_NOT_FOUND', meetingId: body.meetingId },
      };
    }

    const verifyTime = this.resolveMockFaceVerifyTime(
      body.verifyTime,
      meeting.start_time,
      meeting.actual_end_time ?? meeting.end_time,
    );
    const direction =
      body.direction === 'out' || body.direction === 'leave' ? 'out' : 'in';
    const accessLogDirection = direction === 'out' ? 'leave' : 'enter';
    const deviceId = await this.ensureMockFaceAttendanceDevice(
      meeting.room_id,
    );
    const snapshotFileId = await this.saveMockFaceSnapshot(
      body.snapshotImageBase64,
    );

    const candidates: Array<{
      user_id: string;
      full_name: string;
      check_in_time: Date | string | null;
      check_out_time: Date | string | null;
    }> = await this.dataSource.manager.query(
      `SELECT mp.user_id, u.full_name, ar.check_in_time, ar.check_out_time
         FROM meeting_participants mp
         JOIN users u ON u.id = mp.user_id
         JOIN face_profiles fp
           ON fp.user_id = mp.user_id
          AND fp.status = 'active'
          AND fp.deleted_at IS NULL
         LEFT JOIN attendance_records ar
           ON ar.meeting_id = mp.meeting_id
          AND ar.user_id = mp.user_id
        WHERE mp.meeting_id = $1
          AND COALESCE(mp.invitation_status, '') <> 'declined'
          AND u.deleted_at IS NULL
          AND (
            ($2::text = 'in' AND ar.check_in_time IS NULL)
            OR
            ($2::text = 'out' AND ar.check_in_time IS NOT NULL AND ar.check_out_time IS NULL)
          )
        ORDER BY u.full_name ASC
        LIMIT 1`,
      [body.meetingId, direction],
    );
    const candidate = candidates[0];

    if (!candidate) {
      const activeFaceRows: Array<{
        total: string;
        checked_in: string;
        checked_out: string;
      }> =
        await this.dataSource.manager.query(
          `SELECT COUNT(*)::text AS total,
                  COUNT(ar.check_in_time)::text AS checked_in,
                  COUNT(ar.check_out_time)::text AS checked_out
             FROM meeting_participants mp
             JOIN users u ON u.id = mp.user_id
             JOIN face_profiles fp
               ON fp.user_id = mp.user_id
              AND fp.status = 'active'
              AND fp.deleted_at IS NULL
             LEFT JOIN attendance_records ar
               ON ar.meeting_id = mp.meeting_id
              AND ar.user_id = mp.user_id
            WHERE mp.meeting_id = $1
              AND COALESCE(mp.invitation_status, '') <> 'declined'
              AND u.deleted_at IS NULL`,
          [body.meetingId],
        );
      const activeTotal = Number(activeFaceRows[0]?.total ?? 0);
      const checkedInTotal = Number(activeFaceRows[0]?.checked_in ?? 0);
      const checkedOutTotal = Number(activeFaceRows[0]?.checked_out ?? 0);
      if (
        activeTotal > 0 &&
        ((direction === 'in' && checkedInTotal >= activeTotal) ||
          (direction === 'out' &&
            checkedInTotal > 0 &&
            checkedOutTotal >= checkedInTotal))
      ) {
        return {
          success: true,
          data: {
            matched: true,
            skipped: true,
            code:
              direction === 'out'
                ? 'ALREADY_CHECKED_OUT'
                : 'ALREADY_CHECKED_IN',
            mode: 'camera-api-auto-scan',
            meetingId: body.meetingId,
            direction,
            verifyTime: verifyTime.toISOString(),
            note:
              direction === 'out'
                ? 'Tất cả người đã vào phòng đều đã có lượt ra; bỏ qua lượt quét lặp.'
                : 'Tất cả người có FaceID hợp lệ trong ca này đã được điểm danh; bỏ qua lượt quét lặp.',
          },
        };
      }

      const unmatchedRows: Array<{ id: string }> =
        await this.dataSource.manager.query(
          `INSERT INTO iot_device_events
             (device_id, room_id, meeting_id, event_type, event_time, source_protocol,
              severity, payload_json, processed_status, snapshot_file_id)
           VALUES ($1, $2, $3, $4, $5, 'http',
                   'warning', $6::jsonb, 'processed', $7)
           RETURNING id`,
          [
            deviceId,
            meeting.room_id,
            body.meetingId,
            MOCK_FACE_EVENT_TYPE,
            verifyTime,
            JSON.stringify({
              userId: null,
              direction: 'seen',
              matchState: 'unmatched_faceid',
              similarity: 0.31,
              source: 'camera_api',
              reason: 'NO_ACTIVE_FACE_PROFILE_MATCH',
              cameraDeviceCode: MOCK_FACE_DEVICE_CODE,
              hasSnapshot: snapshotFileId !== null,
            }),
            snapshotFileId,
          ],
        );

      return {
        success: true,
        data: {
          matched: false,
          mode: 'camera-api-auto-scan',
          meetingId: body.meetingId,
          direction,
          verifyTime: verifyTime.toISOString(),
          accessLogEventId: unmatchedRows[0]?.id ?? null,
          note:
            'Camera phát hiện khuôn mặt nhưng không khớp FaceID đã đăng ký/đã duyệt; hệ thống chỉ ghi log cảnh báo, không điểm danh.',
        },
      };
    }

    const personCode = `${candidate.user_id}:${body.meetingId}`;
    await this.ensureMockFaceAttendanceMapping({
      deviceId,
      userId: candidate.user_id,
      meetingId: body.meetingId,
      personCode,
      validFrom: meeting.start_time,
      validTo: meeting.actual_end_time ?? meeting.end_time,
    });

    await this.faceAttendanceService.onVerify({
      deviceId,
      roomId: meeting.room_id,
      personId: candidate.user_id,
      personName: personCode,
      verifyTime,
      direction,
      directionRaw: body.direction ?? direction,
      opendoorWay: 'camera_api_auto_scan',
    });

    const accessLogRows: Array<{ id: string }> =
      await this.dataSource.manager.query(
        `INSERT INTO iot_device_events
           (device_id, room_id, meeting_id, event_type, event_time, source_protocol,
            severity, payload_json, processed_status, snapshot_file_id)
         VALUES ($1, $2, $3, $4, $5, 'http',
                 'info', $6::jsonb, 'processed', $7)
         RETURNING id`,
        [
          deviceId,
          meeting.room_id,
          body.meetingId,
          MOCK_FACE_EVENT_TYPE,
          verifyTime,
          JSON.stringify({
            userId: candidate.user_id,
            direction: accessLogDirection,
            matchState: 'matched',
            similarity: 0.98,
            source: 'camera_api',
            cameraDeviceCode: MOCK_FACE_DEVICE_CODE,
            hasSnapshot: snapshotFileId !== null,
          }),
          snapshotFileId,
        ],
      );

    const records = await this.dataSource.manager.query(
      `SELECT id, meeting_id, user_id, check_in_time, check_out_time,
              attendance_status, is_present, is_late, late_minutes,
              check_in_method, attendance_source, first_detected_at,
              last_detected_at, left_early
         FROM attendance_records
        WHERE meeting_id = $1 AND user_id = $2
        LIMIT 1`,
      [body.meetingId, candidate.user_id],
    );

    return {
      success: true,
      data: {
        matched: true,
        mode: 'camera-api-auto-scan',
        meetingId: body.meetingId,
        userId: candidate.user_id,
        fullName: candidate.full_name,
        direction,
        accessLogDirection,
        verifyTime: verifyTime.toISOString(),
        accessLogEventId: accessLogRows[0]?.id ?? null,
        attendanceRecord: records[0] ?? null,
        note:
          'Camera API đã tự khớp FaceID active và gọi FaceAttendanceService để điểm danh.',
      },
    };
  }

  private async ensureMockAnprSetup(body: MockAnprSetupBody): Promise<{
    gateZoneId: string;
    enterChannelId: number;
    leaveChannelId: number;
    cameraDeviceId: string;
  }> {
    const gateZoneId = await this.ensureGateZone(
      body.gateZoneId,
      body.gateZoneCode || DEFAULT_MOCK_GATE_CODE,
      body.gateZoneName || DEFAULT_MOCK_GATE_NAME,
    );
    const cameraDeviceId = await this.ensureMockAnprDevice();
    const enterChannelId = Number(body.enterChannelId || DEFAULT_MOCK_ENTER_CHANNEL);
    const leaveChannelId = Number(body.leaveChannelId || DEFAULT_MOCK_LEAVE_CHANNEL);

    return { gateZoneId, enterChannelId, leaveChannelId, cameraDeviceId };
  }

  private async ensureMockFaceAttendanceDevice(
    roomId: string | null,
  ): Promise<string> {
    const existing = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 LIMIT 1`,
      [MOCK_FACE_DEVICE_CODE],
    );
    if (existing[0]?.id) {
      await this.dataSource.manager.query(
        `UPDATE iot_devices
            SET room_id = $2,
                status = 'online',
                health_status = 'healthy',
                last_seen_at = now(),
                metadata_json = $3::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [
          existing[0].id,
          roomId,
          JSON.stringify({
            mock_face_camera: true,
            future_real_camera_contract:
              'Call FaceAttendanceService.onVerify with deviceId/personId/direction/verifyTime.',
            source: 'dev.mock-face-attendance',
          }),
        ],
      );
      return existing[0].id;
    }

    const inserted = await this.dataSource.manager.query(
      `INSERT INTO iot_devices
       (device_code, device_name, device_type, room_id, status, health_status,
        last_seen_at, metadata_json, created_at, updated_at)
       VALUES ($1,'Mock FaceID Attendance Camera','face_server',$2,'online','healthy',
         now(),$3::jsonb,now(),now())
       RETURNING id`,
      [
        MOCK_FACE_DEVICE_CODE,
        roomId,
        JSON.stringify({
          mock_face_camera: true,
          future_real_camera_contract:
            'Call FaceAttendanceService.onVerify with deviceId/personId/direction/verifyTime.',
          source: 'dev.mock-face-attendance',
        }),
      ],
    );
    return inserted[0].id;
  }

  private resolveMockFaceVerifyTime(
    requested: string | undefined,
    startTime: Date | string,
    endTime: Date | string,
  ): Date {
    if (requested) {
      const parsed = new Date(requested);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const now = new Date();
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (now.getTime() < start.getTime()) {
      return new Date(start.getTime() + 1000);
    }
    if (now.getTime() > end.getTime()) {
      return new Date(Math.max(start.getTime(), end.getTime() - 1000));
    }
    return now;
  }

  private async ensureMockFaceAttendanceMapping(input: {
    deviceId: string;
    userId: string;
    meetingId: string;
    personCode: string;
    validFrom: Date | string;
    validTo: Date | string;
  }): Promise<void> {
    const metadata = {
      bookingId: input.meetingId,
      validFrom: input.validFrom,
      validTo: input.validTo,
      userMeeting: `${input.userId}:${input.meetingId}`,
      mock_face_attendance: true,
      source: 'dev.mock-face-attendance',
    };

    const existing = await this.dataSource.manager.query(
      `SELECT id FROM device_user_mappings
        WHERE device_id = $1 AND user_id = $2
          AND deleted_at IS NULL
        LIMIT 1`,
      [input.deviceId, input.userId],
    );
    if (existing[0]?.id) {
      await this.dataSource.manager.query(
        `UPDATE device_user_mappings SET
           device_person_id = $2,
           device_person_code = $3,
           device_person_name = $3,
           face_registered = true,
           sync_status = 'synced',
           last_synced_at = now(),
           last_sync_error = NULL,
           registered_at = COALESCE(registered_at, now()),
           metadata_json = $4::jsonb,
           deleted_at = NULL,
           updated_at = now()
         WHERE id = $1`,
        [
          existing[0].id,
          input.userId,
          input.personCode,
          JSON.stringify(metadata),
        ],
      );
      return;
    }

    await this.dataSource.manager.query(
      `INSERT INTO device_user_mappings
         (device_id, user_id, device_person_id, device_person_code, device_person_name,
          face_registered, sync_status, last_synced_at, last_sync_error,
          registered_at, metadata_json)
       VALUES ($1,$2,$2,$3,$3,true,'synced',now(),NULL,now(),$4::jsonb)`,
      [
        input.deviceId,
        input.userId,
        input.personCode,
        JSON.stringify(metadata),
      ],
    );
  }

  private async ensureGateZone(
    requestedId: string | undefined,
    zoneCode: string,
    zoneName: string,
  ): Promise<string> {
    if (requestedId) {
      const rows = await this.dataSource.manager.query(
        `SELECT id FROM zones WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [requestedId],
      );
      if (rows[0]?.id) return rows[0].id;
    }

    const existing = await this.dataSource.manager.query(
      `SELECT id FROM zones WHERE zone_code = $1 AND deleted_at IS NULL LIMIT 1`,
      [zoneCode],
    );
    if (existing[0]?.id) {
      await this.dataSource.manager.query(
        `UPDATE zones
            SET zone_type = 'gate', zone_name = COALESCE(zone_name, $2), updated_at = now()
          WHERE id = $1`,
        [existing[0].id, zoneName],
      );
      return existing[0].id;
    }

    const inserted = await this.dataSource.manager.query(
      `INSERT INTO zones
        (zone_code, zone_name, zone_type, building, floor, description, status, metadata_json)
       VALUES ($1,$2,'gate','Demo','G','Cổng ảo dùng cho mock ANPR realtime','active',$3::jsonb)
       RETURNING id`,
      [
        zoneCode,
        zoneName,
        JSON.stringify({ mock_anpr_gate: true, source: 'dev.mock-anpr' }),
      ],
    );
    return inserted[0].id;
  }

  private async ensureMockAnprDevice(): Promise<string> {
    const existing = await this.dataSource.manager.query(
      `SELECT id FROM iot_devices WHERE device_code = $1 LIMIT 1`,
      [MOCK_ANPR_DEVICE_CODE],
    );
    if (existing[0]?.id) {
      await this.dataSource.manager.query(
        `UPDATE iot_devices
            SET status = 'online',
                health_status = 'healthy',
                last_seen_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [existing[0].id],
      );
      return existing[0].id;
    }

    const inserted = await this.dataSource.manager.query(
      `INSERT INTO iot_devices
       (device_code, device_name, device_type, status, health_status,
         last_seen_at, metadata_json, created_at, updated_at)
       VALUES ($1,'Mock ANPR Camera','anpr_camera','online','healthy',
         now(),$2::jsonb,now(),now())
       RETURNING id`,
      [
        MOCK_ANPR_DEVICE_CODE,
        JSON.stringify({ mock_anpr_camera: true, source: 'dev.mock-anpr' }),
      ],
    );
    return inserted[0].id;
  }

  private async writeMockAnprEvent(input: {
    gateZoneId: string;
    deviceId: string;
    plateRaw: string;
    plateNumber: string;
    channelId: number;
    direction: 'enter' | 'leave';
    plateColor: string;
    vehicleColor: string;
    vehicleType: string;
  }): Promise<{
    eventId: string;
    gateLogId: string | null;
    matchState: 'matched' | 'unmatched';
  }> {
    const eventTime = new Date();
    const resolved = await this.resolveVehicleRegistration(input.plateNumber);
    const matchState = resolved ? 'matched' : 'unmatched';
    const snapshotFileId = await this.saveMockAnprSnapshot(input.plateRaw);
    const payload = {
      plateRaw: input.plateRaw,
      plateNumber: input.plateNumber,
      userId: resolved?.userId ?? null,
      channelId: input.channelId,
      direction: input.direction,
      gateDirection: input.direction,
      matchState,
      source: 'virtual_anpr_camera',
      eventActionRaw: input.direction,
      plateColor: input.plateColor,
      vehicleColor: input.vehicleColor,
      vehicleType: input.vehicleType,
      utc: eventTime.toISOString(),
      receivedAt: eventTime.toISOString(),
      gateLogSkipped: null,
      rawReads: [input.plateNumber],
    };

    const eventRows = await this.dataSource.manager.query(
      `INSERT INTO iot_device_events
         (device_id, room_id, meeting_id, zone_id, event_type, event_time,
          source_protocol, severity, payload_json, processed_status, snapshot_file_id)
       VALUES ($1, NULL, NULL, $2, $3, $4, 'virtual_camera', 'info', $5::jsonb, $6, $7)
       RETURNING id`,
      [
        input.deviceId,
        input.gateZoneId,
        MOCK_ANPR_EVENT_TYPE,
        eventTime,
        JSON.stringify(payload),
        matchState === 'matched' ? 'processed' : 'unmatched',
        snapshotFileId,
      ],
    );
    const eventId = eventRows[0].id;

    await this.vehicleControlAlertService.evaluate(
      input.plateNumber,
      { channelId: input.channelId, direction: input.direction },
      eventId,
    );

    let gateLogId: string | null = null;
    try {
      const gateRows = await this.dataSource.manager.query(
        `INSERT INTO gate_access_logs
           (zone_id, device_id, event_id, user_id, vehicle_registration_id,
            plate_number, direction, access_time, metadata_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         RETURNING id`,
        [
          input.gateZoneId,
          input.deviceId,
          eventId,
          resolved?.userId ?? null,
          resolved?.vehicleRegistrationId ?? null,
          input.plateNumber || null,
          input.direction,
          eventTime,
          JSON.stringify({
            channelId: input.channelId,
            plateRaw: input.plateRaw,
            source: 'virtual_anpr_camera',
          }),
        ],
      );
      gateLogId = gateRows[0]?.id ?? null;
      if (gateLogId && input.direction === 'leave') {
        await this.pairMockGateLogs({
          leaveLogId: gateLogId,
          gateZoneId: input.gateZoneId,
          plateNumber: input.plateNumber,
          userId: resolved?.userId ?? null,
          leaveTime: eventTime,
        });
      }
    } catch (e) {
      await this.dataSource.manager.query(
        `UPDATE iot_device_events
            SET payload_json = jsonb_set(payload_json, '{gateLogSkipped}', to_jsonb('duplicate'::text))
          WHERE id = $1`,
        [eventId],
      );
    }

    return { eventId, gateLogId, matchState };
  }

  private async pairMockGateLogs(input: {
    leaveLogId: string;
    gateZoneId: string;
    plateNumber: string;
    userId: string | null;
    leaveTime: Date;
  }): Promise<void> {
    const rows: Array<{ id: string; access_time: Date }> =
      await this.dataSource.manager.query(
        `SELECT id, access_time
           FROM gate_access_logs
          WHERE zone_id = $1
            AND direction = 'enter'
            AND paired_log_id IS NULL
            AND plate_number = $2
            AND ($3::uuid IS NULL OR user_id = $3::uuid)
            AND access_time <= $4
          ORDER BY access_time DESC
          LIMIT 1`,
        [
          input.gateZoneId,
          input.plateNumber || null,
          input.userId,
          input.leaveTime,
        ],
      );
    const enter = rows[0];
    if (!enter) return;

    const durationSeconds = Math.max(
      0,
      Math.round(
        (input.leaveTime.getTime() - new Date(enter.access_time).getTime()) /
          1000,
      ),
    );
    await this.dataSource.manager.query(
      `UPDATE gate_access_logs
          SET paired_log_id = $2, duration_seconds = $3
        WHERE id = $1`,
      [enter.id, input.leaveLogId, durationSeconds],
    );
    await this.dataSource.manager.query(
      `UPDATE gate_access_logs
          SET paired_log_id = $2, duration_seconds = $3
        WHERE id = $1`,
      [input.leaveLogId, enter.id, durationSeconds],
    );
  }

  private async saveMockAnprSnapshot(plateRaw: string): Promise<string | null> {
    const escapedPlate = plateRaw.replace(/[<>&"']/g, (ch) => {
      const map: Record<string, string> = {
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[ch] || ch;
    });
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="480" height="180" viewBox="0 0 480 180">
        <rect width="480" height="180" fill="#f8fafc"/>
        <rect x="42" y="38" width="396" height="104" rx="12" fill="#ffffff" stroke="#1d4ed8" stroke-width="8"/>
        <rect x="58" y="54" width="364" height="72" rx="6" fill="#ffffff" stroke="#bfdbfe" stroke-width="2"/>
        <text x="240" y="107" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="800" fill="#0f172a">${escapedPlate}</text>
      </svg>`;
    return saveEventSnapshot(this.dataSource, this.storageService, {
      imageBase64: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      folder: 'anpr-snapshots',
      relatedEntityType: 'anpr_device_event',
    });
  }

  private async saveMockFaceSnapshot(
    imageBase64: string | null | undefined,
  ): Promise<string | null> {
    if (!imageBase64) return null;
    try {
      return await saveEventSnapshot(this.dataSource, this.storageService, {
        imageBase64,
        folder: 'face-attendance-snapshots',
        relatedEntityType: 'camera_face_event',
      });
    } catch {
      return null;
    }
  }

  private async resolveVehicleRegistration(
    plateNumber: string,
  ): Promise<{ userId: string; vehicleRegistrationId: string } | null> {
    const rows = await this.dataSource.manager.query(
      `SELECT vr.id, vr.user_id
         FROM vehicle_registrations vr
         JOIN users u ON u.id = vr.user_id
        WHERE vr.plate_number = $1
          AND vr.status = 'active'
          AND vr.deleted_at IS NULL
          AND u.deleted_at IS NULL
          AND (u.account_expires_at IS NULL OR u.account_expires_at >= NOW())
        LIMIT 1`,
      [plateNumber],
    );
    if (!rows[0]) return null;
    return { userId: rows[0].user_id, vehicleRegistrationId: rows[0].id };
  }
}
