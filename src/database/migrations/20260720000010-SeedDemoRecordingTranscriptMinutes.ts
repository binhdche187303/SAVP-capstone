import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier 2 demo data: recording_configs/sessions/segments, capture_sessions/channels,
 * media_files, transcripts, meeting_minutes (+1 co ai_summary_json demo), meeting_minutes_shares.
 * Metadata-only — KHONG upload file that, storage_key tro toi path gia dinh dang
 * "demo-seed/...". Phu thuoc: 20260720000007 (meetings), 20260720000006 (iot_devices).
 */
export class SeedDemoRecordingTranscriptMinutes20260720000010 implements MigrationInterface {
  name = 'SeedDemoRecordingTranscriptMinutes20260720000010';

  private readonly recordedMeetings = [
    'MTG-2026-001',
    'MTG-2026-002',
    'MTG-2026-007',
  ];
  private readonly captureMeetings = ['MTG-2026-001', 'MTG-2026-007']; // co iot_devices capture agent trong phong

  public async up(queryRunner: QueryRunner): Promise<void> {
    // capture_sessions cho 2 meeting co capture agent (RM-A201 co IOT-CAPAGENT-A201;
    // RM-A101 khong co capture_agent device rieng nen dung IOT-ROOMCAM-A101 lam nguon).
    const captureDeviceByMeeting: Record<string, string> = {
      'MTG-2026-001': 'IOT-ROOMCAM-A101',
      'MTG-2026-007': 'IOT-CAPAGENT-A201',
    };
    for (const meetingCode of this.captureMeetings) {
      const deviceCode = captureDeviceByMeeting[meetingCode];
      await queryRunner.query(
        `INSERT INTO capture_sessions (meeting_id, room_id, capture_agent_device_id, session_status, started_at, stopped_at, started_by, stopped_by)
         SELECT mt.id, mt.room_id, (SELECT id FROM iot_devices WHERE device_code = $2), 'stopped',
                mt.actual_start_time, mt.actual_end_time,
                mt.organizer_id, mt.organizer_id
         FROM meetings mt
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (SELECT 1 FROM capture_sessions cs WHERE cs.meeting_id = mt.id);`,
        [meetingCode, deviceCode],
      );

      const csRow = (await queryRunner.query(
        `SELECT cs.id FROM capture_sessions cs JOIN meetings mt ON mt.id = cs.meeting_id WHERE mt.meeting_code = $1 LIMIT 1;`,
        [meetingCode],
      )) as Array<{ id: string }>;
      const captureSessionId = csRow[0]?.id;
      if (!captureSessionId) continue;

      const channels = [
        { channelId: 'ch-1', label: 'Kenh chinh phong', zone: 'main' },
        { channelId: 'ch-2', label: 'Kenh mic ban chu toa', zone: 'host-seat' },
      ];
      for (const ch of channels) {
        await queryRunner.query(
          `INSERT INTO capture_session_channels (capture_session_id, channel_id, channel_label, audio_source_type, room_zone_label, status)
           SELECT $1::uuid, $2::varchar, $3::varchar, 'mixed', $4::varchar, 'active'
           WHERE NOT EXISTS (
             SELECT 1 FROM capture_session_channels WHERE capture_session_id = $1 AND channel_id = $2
           );`,
          [captureSessionId, ch.channelId, ch.label, ch.zone],
        );
      }
    }

    // recording_configs + recording_sessions cho 3 meeting o phong allow_recording=true.
    for (const meetingCode of this.recordedMeetings) {
      await queryRunner.query(
        `INSERT INTO recording_configs (meeting_id, enable_audio, enable_video, enable_transcription, auto_start, consent_required, configured_by, status)
         SELECT mt.id, true, true, true, false, true, mt.organizer_id, 'active'
         FROM meetings mt
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (SELECT 1 FROM recording_configs rc WHERE rc.meeting_id = mt.id);`,
        [meetingCode],
      );

      const isCapture = this.captureMeetings.includes(meetingCode);
      await queryRunner.query(
        `INSERT INTO recording_sessions (
           meeting_id, room_id, recording_config_id, session_type, source_type, capture_session_id,
           started_at, stopped_at, status, started_by, stopped_by,
           storage_provider, storage_path, duration_seconds
         )
         SELECT mt.id, mt.room_id, (SELECT id FROM recording_configs WHERE meeting_id = mt.id),
                'mixed', $2::varchar, (SELECT id FROM capture_sessions WHERE meeting_id = mt.id),
                mt.actual_start_time, mt.actual_end_time, 'stopped', mt.organizer_id, mt.organizer_id,
                'local', 'demo-seed/recordings/' || $1::varchar || '.mp4',
                EXTRACT(EPOCH FROM (mt.actual_end_time - mt.actual_start_time))::int
         FROM meetings mt
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (SELECT 1 FROM recording_sessions rs WHERE rs.meeting_id = mt.id);`,
        [meetingCode, isCapture ? 'capture_agent' : 'ip_camera'],
      );

      // media_files: 1 video file cho moi recording_session.
      await queryRunner.query(
        `INSERT INTO media_files (
           meeting_id, recording_session_id, uploaded_by, file_name, file_type, mime_type,
           storage_provider, storage_key, duration_seconds, uploaded_at
         )
         SELECT mt.id, rs.id, mt.organizer_id, $1::varchar || '.mp4', 'video', 'video/mp4',
                'local', 'demo-seed/recordings/' || $1::varchar || '.mp4', rs.duration_seconds, mt.actual_end_time
         FROM meetings mt
         JOIN recording_sessions rs ON rs.meeting_id = mt.id
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (SELECT 1 FROM media_files mf WHERE mf.recording_session_id = rs.id);`,
        [meetingCode],
      );
    }

    // recording_segments: 2 doan/meeting cho 2 meeting co capture_session_channels
    // (moi doan gan voi 1 channel, offset lech nhau 0-5 phut dau cuoc hop).
    for (const meetingCode of this.captureMeetings) {
      await queryRunner.query(
        `INSERT INTO recording_segments (
           recording_session_id, capture_session_channel_id, room_zone_label, user_id,
           segment_start_time, segment_end_time, start_offset_ms, end_offset_ms, media_file_id, status
         )
         SELECT rs.id, csc.id, csc.room_zone_label, mt.organizer_id,
                mt.actual_start_time, mt.actual_start_time + interval '5 minutes',
                0, 300000, mf.id, 'processed'
         FROM meetings mt
         JOIN recording_sessions rs ON rs.meeting_id = mt.id
         JOIN capture_sessions cs ON cs.meeting_id = mt.id
         JOIN capture_session_channels csc ON csc.capture_session_id = cs.id
         LEFT JOIN media_files mf ON mf.recording_session_id = rs.id
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (
             SELECT 1 FROM recording_segments rseg WHERE rseg.recording_session_id = rs.id AND rseg.capture_session_channel_id = csc.id
           );`,
        [meetingCode],
      );
    }

    // transcripts: cho 2 meeting co capture_session (nguon audio ro rang).
    const transcriptStatus: Record<string, string> = {
      'MTG-2026-001': 'approved',
      'MTG-2026-007': 'draft',
    };
    for (const meetingCode of this.captureMeetings) {
      await queryRunner.query(
        `INSERT INTO transcripts (
           meeting_id, source_media_file_id, recording_session_id, language_code,
           raw_text, cleaned_text, security_status, confidence_score, status, approved_by, approved_at
         )
         SELECT mt.id, mf.id, rs.id, 'vi',
                'Day la noi dung transcript demo cho cuoc hop ' || mt.title || '.',
                'Day la noi dung transcript demo (da lam sach) cho cuoc hop ' || mt.title || '.',
                'safe', 88.50, $2::varchar,
                (CASE WHEN $2 = 'approved' THEN mt.organizer_id ELSE NULL END),
                (CASE WHEN $2 = 'approved' THEN mt.actual_end_time ELSE NULL END)
         FROM meetings mt
         JOIN recording_sessions rs ON rs.meeting_id = mt.id
         JOIN media_files mf ON mf.recording_session_id = rs.id
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (SELECT 1 FROM transcripts t WHERE t.meeting_id = mt.id);`,
        [meetingCode, transcriptStatus[meetingCode]],
      );
    }

    // meeting_minutes: MTG-001 (published + link transcript), MTG-002 (published),
    // MTG-007 (draft + ai_summary_json demo).
    await queryRunner.query(
      `INSERT INTO meeting_minutes (meeting_id, title, status, source, minutes_content, linked_transcript_id, issued_by, issued_at, prepared_by, approved_by, approved_at)
       SELECT mt.id, 'Bien ban: ' || mt.title, 'published', 'manual',
              'Noi dung bien ban demo cho cuoc hop ' || mt.title || '. Cac quyet dinh va action item duoc ghi nhan day du.',
              t.id, mt.organizer_id, mt.actual_end_time, mt.organizer_id, mt.organizer_id, mt.actual_end_time
       FROM meetings mt
       LEFT JOIN transcripts t ON t.meeting_id = mt.id
       WHERE mt.meeting_code = 'MTG-2026-001'
         AND NOT EXISTS (SELECT 1 FROM meeting_minutes mm WHERE mm.meeting_id = mt.id);`,
    );
    await queryRunner.query(
      `INSERT INTO meeting_minutes (meeting_id, title, status, source, minutes_content, issued_by, issued_at, prepared_by, approved_by, approved_at)
       SELECT mt.id, 'Bien ban: ' || mt.title, 'published', 'manual',
              'Noi dung bien ban demo cho cuoc hop ' || mt.title || '.',
              mt.organizer_id, mt.actual_end_time, mt.organizer_id, mt.organizer_id, mt.actual_end_time
       FROM meetings mt
       WHERE mt.meeting_code = 'MTG-2026-002'
         AND NOT EXISTS (SELECT 1 FROM meeting_minutes mm WHERE mm.meeting_id = mt.id);`,
    );
    await queryRunner.query(
      `INSERT INTO meeting_minutes (meeting_id, title, status, source, minutes_content, linked_transcript_id, prepared_by, ai_summary_json)
       SELECT mt.id, 'Bien ban (nhap AI): ' || mt.title, 'draft', 'ai',
              'Ban nhap bien ban duoc AI tao tu transcript, can Host review truoc khi publish.',
              t.id, mt.organizer_id,
              '{"keyPoints": ["Tong quan kien truc he thong hien tai", "De xuat cai tien tu team"], "risks": [], "openQuestions": ["Can chot timeline PoC"], "uncertainParts": [], "meta": {"provider": "mock", "model": "demo-seed", "promptVersion": "v1", "note": "Du lieu demo, khong phai ket qua AI that"}}'::jsonb
       FROM meetings mt
       LEFT JOIN transcripts t ON t.meeting_id = mt.id
       WHERE mt.meeting_code = 'MTG-2026-007'
         AND NOT EXISTS (SELECT 1 FROM meeting_minutes mm WHERE mm.meeting_id = mt.id);`,
    );

    // media_files: file dinh kem cho 2 bien ban da published.
    await queryRunner.query(
      `INSERT INTO media_files (meeting_id, related_entity_type, related_entity_id, uploaded_by, file_name, file_type, mime_type, storage_provider, storage_key, uploaded_at)
       SELECT mt.id, 'meeting_minutes', mm.id, mt.organizer_id, 'bien-ban-' || mt.meeting_code || '.pdf', 'minutes_attachment', 'application/pdf',
              'local', 'demo-seed/minutes/' || mt.meeting_code || '.pdf', mm.issued_at
       FROM meetings mt
       JOIN meeting_minutes mm ON mm.meeting_id = mt.id
       WHERE mt.meeting_code IN ('MTG-2026-001', 'MTG-2026-002')
         AND NOT EXISTS (SELECT 1 FROM media_files mf WHERE mf.related_entity_id = mm.id AND mf.related_entity_type = 'meeting_minutes');`,
    );

    // meeting_minutes_shares: chia se bien ban MTG-002 (published) cho 2 nguoi KHONG phai
    // participant cua meeting do (manager.hr, emp.hr1).
    for (const username of ['manager.hr', 'emp.hr1']) {
      await queryRunner.query(
        `INSERT INTO meeting_minutes_shares (minutes_id, user_id, granted_by)
         SELECT mm.id, u.id, mt.organizer_id
         FROM meetings mt
         JOIN meeting_minutes mm ON mm.meeting_id = mt.id
         JOIN users u ON lower(u.username) = lower($2)
         WHERE mt.meeting_code = $1
           AND NOT EXISTS (
             SELECT 1 FROM meeting_minutes_shares mms WHERE mms.minutes_id = mm.id AND mms.user_id = u.id
           );`,
        ['MTG-2026-002', username],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const meetingFilter = `SELECT id FROM meetings WHERE meeting_code LIKE 'MTG-2026-%'`;
    await queryRunner.query(
      `DELETE FROM meeting_minutes_shares WHERE minutes_id IN (SELECT id FROM meeting_minutes WHERE meeting_id IN (${meetingFilter}));`,
    );
    await queryRunner.query(
      `DELETE FROM media_files WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM meeting_minutes WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM transcripts WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM recording_segments WHERE recording_session_id IN (SELECT id FROM recording_sessions WHERE meeting_id IN (${meetingFilter}));`,
    );
    await queryRunner.query(
      `DELETE FROM recording_sessions WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM recording_configs WHERE meeting_id IN (${meetingFilter});`,
    );
    await queryRunner.query(
      `DELETE FROM capture_session_channels WHERE capture_session_id IN (SELECT id FROM capture_sessions WHERE meeting_id IN (${meetingFilter}));`,
    );
    await queryRunner.query(
      `DELETE FROM capture_sessions WHERE meeting_id IN (${meetingFilter});`,
    );
  }
}
