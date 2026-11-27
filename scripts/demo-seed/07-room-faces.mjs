// Giai đoạn E — buổi học trong phòng học + nhật ký nhận diện khuôn mặt theo phòng
// (màn "Nhật ký ra/vào phòng": ngày, giờ, người, hướng, trạng thái, ảnh, độ tin cậy, cuộc họp).
// Ảnh = snapshot thật đã tải lên storage backend (upload-snapshots.mjs).
import { did, insert, rng, vnTime, addMin } from './lib.mjs';

// [mã phòng, camera, GV (index), tiêu đề, [[giờ, phút, thời lượng phút], ...]]
const CLASSES = [
  ['ACD-R101', 'DEMO-CAM-ACD-R101', 0, 'Lập trình ứng dụng đa nền tảng (PRN211)', [[7, 30, 140], [12, 50, 140]]],
  ['ACD-R102', 'DEMO-CAM-ACD-R102', 1, 'Dự án phát triển phần mềm (SWP391)', [[10, 0, 140], [15, 20, 140]]],
  ['ACD-R103', 'DEMO-CAM-ACD-R103', 1, 'Cơ sở dữ liệu (DBI202)', [[7, 30, 140], [12, 50, 140]]],
];

export async function seedRoomFaces(ctx) {
  const { c, ref, out, now, snap } = ctx;
  const R = rng(5150);
  const cutoff = out.cutoff;
  const cnt = {};
  const id = (t) => did(t, 100000 + (cnt[t] = (cnt[t] ?? 0) + 1));
  const adminId = ref.user['sysadmin'];
  const faceSnap = (code) => snap.get(`U-${code}`) ?? null;
  const strangerKeys = [...snap.keys()].filter((k) => k.startsWith('S-'));

  const meetings = [], parts = [], records = [], attEv = [], events = [];
  let seq = 400, strangerIdx = 0;

  for (const [roomCode, camCode, teacherIdx, title, slots] of CLASSES) {
    const roomId = out.room[roomCode];
    const teacher = out.teachers[teacherIdx];
    for (let day = 0; day >= -4; day--) {
      const dow = new Date(vnTime(day, 12, 0, now).getTime() + 7 * 3600000).getUTCDay();
      if (dow === 0 || dow === 6) continue;
      for (const [h, m, dur] of slots) {
        const start = vnTime(day, h, m, now);
        const end = addMin(start, dur);
        if (+start > +cutoff && day === 0 && +start - +cutoff > 3 * 3600000) continue;
        const status = +end <= +cutoff ? 'completed' : +start <= +cutoff ? 'in_progress' : 'scheduled';
        const meetingId = id('meetings');
        seq++;
        const actualStart = status === 'scheduled' ? null : addMin(start, R.int(0, 4));
        const actualEnd = status === 'completed' ? addMin(end, R.int(-5, 6)) : null;
        const roster = R.shuffle(out.students).slice(0, 9);
        meetings.push({
          id: meetingId, meeting_code: `MTG-2026-${seq}`, title, description: `Buổi học: ${title}`, organizer_id: teacher.id, host_id: teacher.id,
          room_id: roomId, meeting_type: 'training', meeting_mode: 'offline', priority: 'normal', status, visibility_level: 'internal',
          start_time: start, end_time: end, actual_start_time: actualStart, actual_end_time: actualEnd, timezone: 'Asia/Ho_Chi_Minh',
          expected_attendee_count: roster.length + 1, created_by: teacher.id, updated_by: teacher.id,
          created_at: addMin(start, -60 * 72), updated_at: addMin(start, -60),
        });
        const people = [{ u: teacher, host: true }, ...roster.map((u) => ({ u, host: false }))];
        const dev = out.device[camCode];
        const ev = (user, direction, time, sim, matchState = 'matched', snapId = undefined) => {
          if (+time > +cutoff) return;
          events.push({
            id: id('iot_device_events'), device_id: dev, room_id: roomId, meeting_id: meetingId, zone_id: null,
            event_type: 'camera_face_event', event_time: time, source_protocol: 'http',
            severity: matchState === 'matched' ? 'info' : 'warning',
            payload_json: {
              userId: user?.id ?? null, direction, matchState, similarity: sim, source: 'camera_api',
              cameraDeviceCode: camCode, hasSnapshot: true, seed: 'DEMO-2026-10',
            },
            processed_status: 'processed', snapshot_file_id: snapId !== undefined ? snapId : user ? faceSnap(user.code) : null, created_at: time,
          });
        };

        people.forEach(({ u, host }, i) => {
          const rowId = id('meeting_participants');
          const absent = !host && status !== 'scheduled' && R.chance(0.1);
          const late = !host && !absent && R.chance(0.18);
          const ciOffset = host ? R.int(-12, -3) : late ? R.int(6, 22) : R.int(-9, 3);
          const checkIn = addMin(start, ciOffset);
          const left = status === 'completed' && !host && R.chance(0.1);
          const checkOut = status === 'completed' ? (left ? addMin(end, -R.int(12, 30)) : addMin(actualEnd ?? end, R.int(-2, 6))) : null;
          const attended = status !== 'scheduled' && !absent && +checkIn <= +cutoff;
          const attStatus = !attended ? (absent ? 'absent' : 'not_checked_in') : late ? 'late' : left ? 'left_early' : 'present';
          parts.push({
            id: rowId, meeting_id: meetingId, user_id: u.id, participant_role: host ? 'host' : 'attendee', is_required: true, attendance_required: true,
            invitation_status: 'accepted', response_at: addMin(start, -60 * 48), attendance_status: attStatus,
            joined_at: attended ? checkIn : null, left_at: attended ? checkOut : null, invited_by: teacher.id,
            created_at: addMin(start, -60 * 72), updated_at: addMin(start, -60),
          });
          if (status === 'scheduled') return;
          const sim = +(0.88 + R.next() * 0.11).toFixed(2);
          if (absent) {
            records.push({
              id: id('attendance_records'), meeting_id: meetingId, participant_id: rowId, user_id: u.id, check_in_method: 'manual', attendance_source: 'manual',
              is_present: false, is_late: false, left_early: false, attendance_status: 'absent', note: 'Vắng không phép', created_at: start, updated_at: addMin(start, 15),
            });
            return;
          }
          if (!attended) return;
          const recId = id('attendance_records');
          records.push({
            id: recId, meeting_id: meetingId, participant_id: rowId, user_id: u.id, check_in_method: 'room_camera', attendance_source: 'camera',
            check_in_time: checkIn, check_out_time: checkOut, first_detected_at: checkIn, last_detected_at: checkOut ?? cutoff,
            is_present: true, is_late: late, left_early: left, late_minutes: late ? ciOffset : null,
            presence_duration_minutes: Math.max(0, Math.round(((checkOut ?? cutoff) - checkIn) / 60000)), confidence_score: sim,
            attendance_status: attStatus, created_at: start, updated_at: addMin(start, 5),
          });
          attEv.push({
            id: id('attendance_events'), meeting_id: meetingId, attendance_record_id: recId, user_id: u.id, room_id: roomId, device_id: dev,
            event_type: 'check_in', event_time: checkIn, source_type: 'camera', confidence_score: sim, evidence_media_file_id: null,
            review_status: 'approved', metadata_json: { seed: 'DEMO-2026-10' },
          });
          // nhật ký nhận diện: vào (+ đôi khi 1 lượt nhận diện độ tin cậy thấp ngay trước đó), ra
          if (i % 7 === 3 && R.chance(0.7)) ev(u, 'enter', addMin(checkIn, -1), +(0.55 + R.next() * 0.12).toFixed(2), 'unmatched_low_confidence');
          ev(u, 'enter', checkIn, sim);
          if (checkOut) ev(u, 'leave', checkOut, +(0.88 + R.next() * 0.1).toFixed(2));
        });

        // Người lạ xuất hiện trong phòng (khoảng 1/3 buổi)
        if (status !== 'scheduled' && strangerKeys.length && R.chance(0.34)) {
          const key = strangerKeys[strangerIdx++ % strangerKeys.length];
          ev(null, 'enter', addMin(start, R.int(8, 35)), +(0.3 + R.next() * 0.15).toFixed(2), 'unmatched_faceid', snap.get(key));
        }
      }
    }
  }

  const n = {};
  n.room_meetings = await insert(c, 'meetings', meetings.map((x) => ({ recurrence_rule_id: null, parent_meeting_id: null, ...x })));
  n.room_participants = await insert(c, 'meeting_participants', parts);
  n.room_attendance_records = await insert(c, 'attendance_records', records.map((r) => ({
    check_in_time: null, check_out_time: null, first_detected_at: null, last_detected_at: null, late_minutes: null, presence_duration_minutes: null, confidence_score: null, note: null, ...r })));
  n.room_attendance_events = await insert(c, 'attendance_events', attEv);
  n.room_face_events = await insert(c, 'iot_device_events', events);
  return n;
}
