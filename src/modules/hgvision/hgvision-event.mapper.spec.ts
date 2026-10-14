import {
  parseCameraChannelMap,
  toIvssFaceEvent,
} from './hgvision-event.mapper';

describe('hgvision-event.mapper', () => {
  const map = { 'Phong C401': 3 };

  it('đổi sự kiện khuôn mặt → IvssFaceEvent', () => {
    expect(
      toIvssFaceEvent(
        {
          object_id: 'cam1_1760090000_42',
          camera_id: 'Phong C401',
          face_ident_text: ' EMP001 ',
          face_image_path: 'FACE_IMAGE/x.jpg',
          first_timestamp: 1760090000,
          last_timestamp: 1760090012,
          confidence: 0.92,
        },
        map,
      ),
    ).toEqual({
      type: 'face_recognized',
      channelId: 3,
      personUid: 'EMP001',
      name: 'EMP001',
      similarity: 0.92,
      utc: '2025-10-10T09:53:20.000Z',
    });
  });

  it('người lạ (không face_ident) → personUid undefined', () => {
    const evt = toIvssFaceEvent(
      {
        object_id: 'o1',
        camera_id: 'Phong C401',
        face_image_path: 'FACE_IMAGE/x.jpg',
        first_timestamp: 1760090000,
      },
      map,
    );
    expect(evt?.personUid).toBeUndefined();
  });

  it('bỏ sự kiện không có khuôn mặt / camera chưa ánh xạ / thiếu thời gian', () => {
    const base = { object_id: 'o', first_timestamp: 1760090000 };
    expect(
      toIvssFaceEvent(
        { ...base, camera_id: 'Phong C401', lp_text: '30A1' },
        map,
      ),
    ).toBeNull();
    expect(
      toIvssFaceEvent(
        { ...base, camera_id: 'Cong sau', face_ident_text: 'A' },
        map,
      ),
    ).toBeNull();
    expect(
      toIvssFaceEvent(
        { object_id: 'o', camera_id: 'Phong C401', face_ident_text: 'A' },
        map,
      ),
    ).toBeNull();
  });

  it('parseCameraChannelMap chỉ giữ channelId số nguyên', () => {
    expect(
      parseCameraChannelMap({ a: 1, b: '2', c: 'x', d: 1.5, e: null }),
    ).toEqual({ a: 1, b: 2 });
    expect(parseCameraChannelMap(null)).toEqual({});
  });
});
