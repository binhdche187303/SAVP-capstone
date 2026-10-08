// Giai đoạn C2 — ghi hình, capture, transcript, biên bản, tệp đính kèm, thông báo, job nền, audit.
import { did, insert, rng, vnTime, addMin } from './lib.mjs';

const SPEAKER_LINES = [
  'Chào mọi người, chúng ta bắt đầu cuộc họp. Trước tiên mình rà soát lại các đầu việc của tuần trước.',
  'Phần việc của bên mình đã hoàn thành khoảng chín mươi phần trăm, còn lại đang chờ phản hồi từ khách hàng.',
  'Mình đề xuất chốt phương án B vì chi phí thấp hơn và thời gian triển khai ngắn hơn.',
  'Về rủi ro, thiết bị chưa về đủ nên cần có phương án dự phòng trong tuần này.',
  'Đồng ý, mình sẽ gửi lại kế hoạch chi tiết và lịch triển khai ngay sau cuộc họp.',
  'Có ai còn ý kiến nào khác không? Nếu không thì chúng ta chuyển sang nội dung tiếp theo.',
  'Mình ghi nhận các quyết định và phân công như đã thống nhất, biên bản sẽ được gửi trong hôm nay.',
];

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
];

export async function seedContent(ctx) {
  const { c, ref, out, now } = ctx;
  const R = rng(9090);
  const cutoff = out.cutoff;
  const n = {};
  const cnt = {};
  const id = (t) => did(t, (cnt[t] = (cnt[t] ?? 0) + 1));
  let nM = out.mediaCounter ?? 0;
  const adminId = ref.user['sysadmin'];
  const D = out.device;
  const roomDevice = {
    'RM-B303': D['DEMO-CAM-RM-B303'], 'RM-H01': D['DEMO-CAM-RM-H01'], 'RM-A201': D['DEMO-CAM-ROOM-A201'],
    'ACD-R101': D['DEMO-CAM-ACD-R101'], 'ACD-R102': D['DEMO-CAM-ACD-R102'],
  };
  const agentOf = { 'RM-B303': D['DEMO-AGENT-B303'], 'RM-H01': D['DEMO-AGENT-H01'] };

  const media = [], configs = [], sessions = [], captures = [], channels = [], segments = [], transcripts = [],
    minutes = [], shares = [], jobs = [], notifs = [];
  const finished = out.meetings.filter((m) => (m.status === 'completed' || m.status === 'in_progress') && m.rec);

  finished.forEach((m, idx) => {
    const live = m.status === 'in_progress';
    const roomId = out.room[m.room];
    const cfgId = id('recording_configs');
    configs.push({
      id: cfgId, meeting_id: m.id, policy_key: 'default', policy_snapshot_json: { retentionDays: 90, consentRequired: true },
      enable_audio: true, enable_video: true, enable_transcription: true, video_source_device_id: roomDevice[m.room] ?? null,
      audio_source_mode: agentOf[m.room] ? 'channel_by_zone' : 'room_mix', auto_start: idx % 3 === 0, consent_required: true,
      retention_days: 90, configured_by: m.host, configured_at: addMin(m.start, -60 * 24), status: 'active',
    });
    const failed = !live && idx % 9 === 4;
    const processing = !live && idx % 9 === 6;
    const start = m.startedActual ?? m.start;
    const stop = live ? null : m.endedActual ?? m.end;
    const dur = stop ? Math.max(60, Math.round((stop - start) / 1000)) : null;
    const sessionId = id('recording_sessions');
    const sType = agentOf[m.room] ? 'mixed' : 'video';
    sessions.push({
      id: sessionId, meeting_id: m.id, room_id: roomId, recording_config_id: cfgId, session_type: sType,
      source_type: agentOf[m.room] ? 'capture_agent' : 'ip_camera', device_id: agentOf[m.room] ?? roomDevice[m.room] ?? null,
      started_at: start, stopped_at: stop, paused_duration_seconds: R.chance(0.2) ? R.int(60, 420) : 0,
      status: live ? 'recording' : failed ? 'failed' : processing ? 'processing' : 'stopped', started_by: m.host, stopped_by: stop ? m.host : null,
      error_message: failed ? 'Mất kết nối tới camera trong lúc ghi hình' : null, storage_provider: 'local',
      storage_path: `demo-seed/recordings/${m.seq}.mp4`, file_size_bytes: dur ? dur * 480000 : null, duration_seconds: dur,
      metadata_json: { seed: 'DEMO-2026-10' },
    });
    // tệp video/audio
    let videoId = null;
    if (!live && !failed) {
      nM++; videoId = did('media_files', nM);
      media.push({
        id: videoId, file_code: `REC-${m.seq}`, meeting_id: m.id, related_entity_type: 'recording_session', related_entity_id: sessionId,
        recording_session_id: sessionId, uploaded_by: m.host, file_name: `MTG-2026-${m.seq}.mp4`, file_type: 'video', mime_type: 'video/mp4',
        storage_provider: 'local', storage_key: `demo-seed/recordings/MTG-2026-${m.seq}.mp4`, file_size_bytes: dur * 480000, duration_seconds: dur,
        version_no: 1, visibility_level: 'internal', is_active: true, uploaded_at: addMin(stop, 5), metadata_json: { seed: 'DEMO-2026-10' },
      });
    }
    // capture session (phòng có capture agent)
    let captureId = null;
    if (agentOf[m.room]) {
      captureId = id('capture_sessions');
      captures.push({
        id: captureId, meeting_id: m.id, room_id: roomId, capture_agent_device_id: agentOf[m.room], recording_session_id: sessionId,
        session_status: live ? 'active' : failed ? 'failed' : 'stopped', started_at: start, stopped_at: stop, started_by: m.host, stopped_by: stop ? m.host : null,
        clock_sync_offset_ms: R.int(-40, 40), metadata_json: { seed: 'DEMO-2026-10' },
      });
      m.parts.slice(0, 4).forEach((uid, i) => channels.push({
        id: id('capture_session_channels'), capture_session_id: captureId, channel_id: `CH${i + 1}`, iot_device_id: agentOf[m.room],
        channel_label: `Micro ghế ${i + 1}`, audio_source_type: 'mixed', room_zone_label: `Khu ${String.fromCharCode(65 + i)}`,
        seat_code_snapshot: `S${i + 1}`, participant_user_id: uid, confidence_score: +(0.85 + R.next() * 0.12).toFixed(2),
        sample_rate: 16000, bit_depth: 16, status: live ? 'active' : 'stopped', calibration_json: { gainDb: R.int(-3, 6) }, metadata_json: { seed: 'DEMO-2026-10' },
      }));
    }
    // transcript + segments
    if (!live && !failed) {
      const tStatus = processing ? 'processing' : ['approved', 'approved', 'reviewed', 'draft', 'approved'][idx % 5];
      const segs = [];
      let off = 0;
      for (let i = 0; i < 7; i++) {
        const len = R.int(20, 55);
        segs.push({ speaker: `Người nói ${(i % Math.min(3, m.parts.length)) + 1}`, userId: m.parts[i % Math.min(3, m.parts.length)], start: off, end: off + len, text: SPEAKER_LINES[i] });
        off += len + R.int(2, 8);
      }
      const raw = segs.map((s) => s.text).join(' ');
      const trId = id('transcripts');
      transcripts.push({
        id: trId, meeting_id: m.id, source_media_file_id: videoId, recording_session_id: sessionId, version_no: 1, language_code: 'vi',
        raw_text: processing ? null : raw, cleaned_text: processing ? null : raw, speaker_segments_json: processing ? null : segs,
        detected_speakers_json: processing ? null : [...new Set(segs.map((s) => s.speaker))], security_status: 'safe',
        confidence_score: processing ? null : +(0.86 + R.next() * 0.1).toFixed(2), status: tStatus,
        edited_by: tStatus === 'reviewed' || tStatus === 'approved' ? m.host : null, edited_at: tStatus === 'reviewed' || tStatus === 'approved' ? addMin(stop, 90) : null,
        approved_by: tStatus === 'approved' ? m.host : null, approved_at: tStatus === 'approved' ? addMin(stop, 120) : null,
        search_keywords: m.title.toLowerCase(), created_at: addMin(stop, 30),
      });
      m.transcriptId = trId;
      const nSeg = R.int(2, 4);
      for (let i = 0; i < nSeg; i++) {
        const segLen = Math.round(dur / nSeg);
        segments.push({
          id: id('recording_segments'), recording_session_id: sessionId, user_id: m.parts[i % m.parts.length], seat_code_snapshot: `S${i + 1}`,
          room_zone_label: `Khu ${String.fromCharCode(65 + i)}`, segment_start_time: addMin(start, (i * segLen) / 60), segment_end_time: addMin(start, ((i + 1) * segLen) / 60),
          start_offset_ms: i * segLen * 1000, end_offset_ms: (i + 1) * segLen * 1000, media_file_id: videoId, transcript_id: trId,
          status: 'processed', confidence_score: +(0.85 + R.next() * 0.12).toFixed(2), metadata_json: { seed: 'DEMO-2026-10' },
        });
      }
      jobs.push({
        id: id('background_jobs'), job_type: 'transcription', related_entity_type: 'meeting', related_entity_id: m.id, requested_by: m.host, queue_name: 'transcription',
        status: processing ? 'running' : 'completed', priority: 5, scheduled_at: stop, started_at: addMin(stop, 1), completed_at: processing ? null : addMin(stop, 12),
        retry_count: 0, input_json: { meetingId: m.id }, output_json: processing ? null : { transcriptId: trId }, metadata_json: { seed: 'DEMO-2026-10' },
      });
    } else if (failed) {
      jobs.push({
        id: id('background_jobs'), job_type: 'transcription', related_entity_type: 'meeting', related_entity_id: m.id, requested_by: m.host, queue_name: 'transcription',
        status: 'failed', priority: 5, scheduled_at: stop, started_at: addMin(stop, 1), completed_at: addMin(stop, 3), retry_count: 3,
        input_json: { meetingId: m.id }, error_message: 'Không có tệp ghi hình hợp lệ để xử lý', metadata_json: { seed: 'DEMO-2026-10' },
      });
    }
    m.sessionId = sessionId; m.videoId = videoId; m.recFailed = failed;
  });

  // ----- Biên bản (cho meeting đã hoàn thành) -----
  const done = out.meetings.filter((m) => m.status === 'completed');
  done.forEach((m, idx) => {
    if (idx % 8 === 7) return; // một số meeting chưa có biên bản
    const ai = idx % 3 === 1;
    const st = idx % 6 === 5 ? 'draft' : idx % 17 === 0 ? 'archived' : 'published';
    const minId = id('meeting_minutes');
    const attendees = m.parts.map((u) => ({ userId: u }));
    const actions = m.actions.map(([title, days], i) => ({
      id: `${m.seq}-${i + 1}`, title, assigneeId: m.parts[Math.min(i + 1, m.parts.length - 1)], dueDate: addMin(m.end, days * 1440).toISOString().slice(0, 10),
      status: +addMin(m.end, days * 1440) < +cutoff ? R.pick(['done', 'done', 'in_progress']) : 'todo',
    }));
    const decisions = m.decisions.map((d, i) => ({ id: `${m.seq}-d${i + 1}`, content: d }));
    const content = [
      `# Biên bản: ${m.title}`, '', `**Thời gian:** ${m.start.toISOString().slice(0, 10)}  **Địa điểm:** ${m.room}`, '',
      '## Nội dung thảo luận', ...m.agenda.map((a, i) => `${i + 1}. ${a}`), '',
      '## Quyết định', ...m.decisions.map((d) => `- ${d}`), '',
      '## Công việc được giao', ...m.actions.map(([t, d]) => `- ${t} (hạn: ${d} ngày)`),
    ].join('\n');
    const attId = (() => { nM++; const mid = did('media_files', nM); media.push({
      id: mid, file_code: `MIN-${m.seq}`, meeting_id: m.id, related_entity_type: 'meeting_minutes', related_entity_id: minId, uploaded_by: m.host,
      file_name: `Bien-ban-${m.seq}.pdf`, file_type: 'minutes_attachment', mime_type: 'application/pdf', storage_provider: 'local',
      storage_key: `demo-seed/minutes/Bien-ban-${m.seq}.pdf`, file_size_bytes: 180000 + idx * 1200, version_no: 1, visibility_level: 'internal',
      is_active: true, uploaded_at: addMin(m.end, 180), metadata_json: { seed: 'DEMO-2026-10' } }); return mid; })();
    minutes.push({
      id: minId, meeting_id: m.id, title: `Biên bản - ${m.title}`, version_no: 1, status: st,
      visibility_level: m.dept === 'BOD' ? 'private' : 'participants', is_live_shared: false, source: ai ? 'ai' : 'manual', content_format: 'markdown',
      minutes_content: content, attendees_snapshot_json: attendees, decisions_json: decisions, action_items_json: actions,
      ai_summary_json: ai ? { summary: `Cuộc họp "${m.title}" đã thống nhất ${decisions.length} quyết định và giao ${actions.length} công việc.`, model: 'claude-sonnet', generatedAt: addMin(m.end, 60).toISOString() } : null,
      linked_transcript_id: m.transcriptId ?? null, linked_recording_file_id: m.videoId ?? null, issued_by: st === 'draft' ? null : m.host,
      issued_at: st === 'draft' ? null : addMin(m.end, 150), prepared_by: m.parts[Math.min(2, m.parts.length - 1)],
      approved_by: st === 'draft' ? null : m.host, approved_at: st === 'draft' ? null : addMin(m.end, 170), file_id: attId,
      created_at: addMin(m.end, 60), updated_at: addMin(m.end, 170),
    });
    if (st === 'published' && idx % 2 === 0) {
      const shareTo = (out.staff.find((s) => !m.parts.includes(s.id)) ?? out.staff[0]).id;
      shares.push({ id: id('meeting_minutes_shares'), minutes_id: minId, user_id: shareTo, granted_by: m.host, granted_at: addMin(m.end, 200) });
    }
    jobs.push({
      id: id('background_jobs'), job_type: 'export_minutes', related_entity_type: 'meeting', related_entity_id: m.id, requested_by: m.host, queue_name: 'export',
      status: idx % 11 === 3 ? 'failed' : 'completed', priority: 3, scheduled_at: addMin(m.end, 175), started_at: addMin(m.end, 175), completed_at: addMin(m.end, 177),
      retry_count: idx % 11 === 3 ? 2 : 0, input_json: { minutesId: minId }, error_message: idx % 11 === 3 ? 'Lỗi tạo PDF: thiếu phông chữ' : null, metadata_json: { seed: 'DEMO-2026-10' },
    });
    m.minutesId = minId;
    // thông báo gửi biên bản
    if (st === 'published') notifs.push({
      notification_type: 'minutes_distribution', channel: 'email', subject: `Biên bản họp: ${m.title}`, content: `Biên bản cuộc họp "${m.title}" đã được phát hành.`,
      related_entity_type: 'meeting', related_entity_id: m.id, recipients: m.parts, priority: 'normal', time: addMin(m.end, 190), status: 'sent', by: m.host,
    });
  });
  // job email còn chờ / lên lịch
  out.meetings.filter((m) => m.status === 'scheduled' && +m.start > +cutoff).slice(0, 6).forEach((m) => jobs.push({
    id: id('background_jobs'), job_type: 'meeting_time_warning', related_entity_type: 'meeting', related_entity_id: m.id, requested_by: m.host, queue_name: 'scheduler',
    status: 'scheduled', priority: 4, scheduled_at: addMin(m.end, -10), retry_count: 0, input_json: { meetingId: m.id }, metadata_json: { seed: 'DEMO-2026-10' },
  }));

  // ----- Thông báo -----
  for (const m of out.meetings) {
    const when = addMin(m.start, -60 * 36);
    if (m.status === 'draft') continue;
    notifs.push({
      notification_type: m.status === 'cancelled' ? 'cancellation' : 'meeting_invite', channel: R.pick(['in_app', 'email']),
      subject: m.status === 'cancelled' ? `Hủy cuộc họp: ${m.title}` : `Lời mời họp: ${m.title}`,
      content: m.status === 'cancelled' ? `Cuộc họp "${m.title}" đã bị hủy.` : `Bạn được mời tham gia "${m.title}" lúc ${m.start.toISOString().slice(11, 16)} (UTC).`,
      related_entity_type: 'meeting', related_entity_id: m.id, recipients: m.parts, priority: m.type === 'emergency' ? 'high' : 'normal', time: when, status: 'sent', by: m.organizer,
    });
    if (m.status !== 'cancelled' && m.status !== 'pending_approval') notifs.push({
      notification_type: 'reminder', channel: 'in_app', subject: `Nhắc họp: ${m.title}`, content: `Cuộc họp "${m.title}" sẽ bắt đầu sau 30 phút.`,
      related_entity_type: 'meeting', related_entity_id: m.id, recipients: m.parts, priority: 'normal', time: addMin(m.start, -30), status: +addMin(m.start, -30) > +cutoff ? 'draft' : 'sent', by: null,
    });
  }
  const lateMeetings = out.meetings.filter((m) => m.status === 'completed').slice(0, 8);
  lateMeetings.forEach((m, i) => {
    notifs.push({ notification_type: 'late_checkin_alert', channel: 'in_app', subject: 'Có người tham dự đến muộn', content: `Một số thành viên chưa điểm danh cho "${m.title}".`,
      related_entity_type: 'meeting', related_entity_id: m.id, recipients: [m.host], priority: 'normal', time: addMin(m.start, 6), status: 'sent', by: null });
    notifs.push({ notification_type: 'late_checkin_host_summary', channel: 'email', subject: 'Tổng hợp đi muộn', content: `Tổng hợp điểm danh của "${m.title}".`,
      related_entity_type: 'meeting', related_entity_id: m.id, recipients: [m.host], priority: 'low', time: addMin(m.end, 10), status: i === 5 ? 'failed' : 'sent', by: null, failure: i === 5 ? 'SMTP timeout' : null });
  });
  out.staff.forEach((s, i) => notifs.push({
    notification_type: 'account_welcome', channel: 'email', subject: 'Chào mừng bạn đến với SAVP', content: `Tài khoản ${s.username} đã được tạo. Mật khẩu tạm thời đã được gửi riêng.`,
    related_entity_type: 'user', related_entity_id: s.id, recipients: [s.id], priority: 'normal', time: vnTime(-45, 9, i, now), status: i % 13 === 5 ? 'failed' : 'sent', by: adminId,
    failure: i % 13 === 5 ? 'Địa chỉ email không nhận' : null,
  }));
  out.strangers.slice(0, 5).forEach((st, i) => notifs.push({
    notification_type: 'unknown_face_alert', channel: 'in_app', subject: 'Phát hiện người lạ', content: 'Camera ghi nhận khuôn mặt không có trong hệ thống.',
    related_entity_type: 'security_alert', related_entity_id: null, recipients: out.staff.filter((s) => s.role === 'GUARD').map((s) => s.id),
    priority: 'high', time: vnTime(-i - 1, 10 + i, 5, now), status: 'sent', by: null,
  }));
  const noShowMeet = out.meetings.filter((m) => m.status === 'cancelled').slice(0, 4);
  noShowMeet.forEach((m) => notifs.push({
    notification_type: 'no_show_alert', channel: 'in_app', subject: 'Phòng họp có nguy cơ không sử dụng', content: `Chưa có ai trong phòng ${m.room} cho "${m.title}".`,
    related_entity_type: 'meeting', related_entity_id: m.id, recipients: [m.host], priority: 'high', time: addMin(m.start, 10), status: 'sent', by: null,
  }));
  const notifRows = notifs.map((x, i) => {
    const sent = x.status === 'sent' ? x.time : null;
    return {
      id: did('notifications', i + 1), notification_code: `NTF-2026-${String(1000 + i)}`, notification_type: x.notification_type, channel: x.channel,
      subject: x.subject, content: x.content, related_entity_type: x.related_entity_type, related_entity_id: x.related_entity_id,
      recipient_scope: 'user_list', recipient_user_ids_json: x.recipients, priority: x.priority, scheduled_send_at: x.time, sent_at: sent,
      delivery_status: x.status, read_count: x.status === 'sent' ? R.int(0, x.recipients.length) : 0, failure_reason: x.failure ?? null,
      retry_count: x.status === 'failed' ? 3 : 0, sent_by: x.by, created_by: x.by, created_at: x.time,
      payload_json: { seed: 'DEMO-2026-10' }, delivery_result_json: x.status === 'sent' ? { delivered: x.recipients.length } : null,
    };
  });

  // ----- Audit log -----
  const audit = [];
  const act = (user, action, entity, entityId, time, severity = 'info', meta = null) => audit.push({
    id: did('audit_logs', audit.length + 1), user_id: user, action_type: action, entity_type: entity, entity_id: entityId, ip_address: `10.20.${R.int(1, 9)}.${R.int(10, 240)}`,
    user_agent: R.pick(UAS), request_id: `req-${R.int(100000, 999999)}`, created_at: time, severity, metadata_json: meta ? { seed: 'DEMO-2026-10', ...meta } : { seed: 'DEMO-2026-10' },
  });
  const all = [...out.staff, ...out.teachers, ...out.students];
  all.forEach((u, i) => act(adminId, 'user_create', 'users', u.id, vnTime(-45, 9, i, now)));
  all.forEach((u, i) => act(adminId, 'role_assign', 'user_role', u.id, vnTime(-45, 9, 40 + (i % 15), now), 'info', { role: u.role }));
  for (let day = -29; day <= 0; day++) {
    const dow = new Date(vnTime(day, 12, 0, now).getTime() + 7 * 3600000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const logins = R.shuffle(out.staff).slice(0, R.int(7, 13));
    logins.forEach((u) => { const t = vnTime(day, 7, R.int(30, 180), now); if (t <= cutoff) act(u.id, 'login', 'user', u.id, t); });
    if (R.chance(0.35)) { const u = R.pick(out.staff); const t = vnTime(day, R.int(8, 17), R.int(0, 59), now); if (t <= cutoff) act(u.id, 'login_failed', 'user', u.id, t, 'warning', { reason: 'wrong_password' }); }
    R.shuffle(out.staff).slice(0, R.int(2, 5)).forEach((u) => { const t = vnTime(day, R.int(16, 19), R.int(0, 59), now); if (t <= cutoff) act(u.id, 'logout', 'user', u.id, t); });
    if (day >= -25) act(adminId, 'read_analytics_dashboard_overview', 'analytics_dashboard', null, vnTime(day, 9, R.int(0, 59), now));
  }
  out.meetings.forEach((m) => {
    act(m.organizer, 'meeting_create', 'meetings', m.id, addMin(m.start, -60 * 48));
    if (m.status === 'completed' || m.status === 'in_progress') act(m.host, 'start_meeting', 'meetings', m.id, m.startedActual);
    if (m.status === 'cancelled') act(m.organizer, 'meeting_cancel', 'meetings', m.id, addMin(m.start, -60 * 5), 'warning');
    if (m.status !== 'draft' && m.status !== 'pending_approval') act(m.host, 'approve', 'meeting_request', m.id, addMin(m.start, -60 * 47));
  });
  out.staff.filter((s) => s._faceProfileId).forEach((s, i) => {
    act(adminId, s._faceStatus === 'rejected' ? 'face_profile_reject' : 'face_profile_review', 'face_profile', s._faceProfileId, vnTime(-29 + (i % 20), 11, i, now), s._faceStatus === 'rejected' ? 'warning' : 'info');
  });
  ['gate_main_cfg', 'staleness_cfg', 'recording_cfg'].forEach((k, i) => act(adminId, 'system_config_update', 'system_configs', null, vnTime(-10 - i, 15, 0, now), 'info', { key: k }));
  audit.sort((a, b) => a.created_at - b.created_at);

  n.media_files = await insert(c, 'media_files', media);
  n.recording_configs = await insert(c, 'recording_configs', configs);
  n.recording_sessions = await insert(c, 'recording_sessions', sessions.map((s) => ({ error_message: null, stopped_at: null, stopped_by: null, file_size_bytes: null, duration_seconds: null, ...s })));
  n.capture_sessions = await insert(c, 'capture_sessions', captures);
  n.capture_session_channels = await insert(c, 'capture_session_channels', channels);
  n.transcripts = await insert(c, 'transcripts', transcripts);
  n.recording_segments = await insert(c, 'recording_segments', segments);
  n.meeting_minutes = await insert(c, 'meeting_minutes', minutes);
  n.meeting_minutes_shares = await insert(c, 'meeting_minutes_shares', shares);
  n.background_jobs = await insert(c, 'background_jobs', jobs.map((j) => ({ error_message: null, started_at: null, completed_at: null, output_json: null, input_json: null, scheduled_at: null, ...j })));
  n.notifications = await insert(c, 'notifications', notifRows);
  n.audit_logs = await insert(c, 'audit_logs', audit);
  out.mediaCounter = nM;
  return n;
}
