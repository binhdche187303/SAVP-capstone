import {
  parseCameraChannelMap,
  resolveCameraChannel,
  toIvssFaceEvent,
  toVehicleEvent,
} from './hgvision-event.mapper';

describe('hgvision-event.mapper', () => {
  const map = { 'Phong C401': 3 };

  it('nhận camera phòng IT khi HGVision trả tên không dấu', () => {
    const event = toIvssFaceEvent({
      object_id: 'it-person', camera_id: 'Camera phong IT',
      object_type: 'pedestrian', object_image_path: 'OBJECT_IMAGE/it.jpg',
      first_timestamp: 1760090000,
    }, { 'Camera phòng IT': 7 });
    expect(event?.channelId).toBe(7);
    expect(resolveCameraChannel(' CAMERA   PHONG IT ', { 'Camera phòng IT': 7 })).toBe(7);
  });

  it('áp dụng cùng cách khớp tên cho sự kiện biển số', () => {
    expect(toVehicleEvent({
      object_id: 'gate-car', camera_id: 'Cong 1 huong ra', lp_text: '30A12345',
      first_timestamp: 1760090000,
    }, { 'Cổng 1 hướng ra': 8 })?.channelId).toBe(8);
  });

  it('ưu tiên tên chính xác và không đoán kênh khi tên bỏ dấu bị trùng', () => {
    const channels = { 'Camera phòng IT': 7, 'Camera phong IT': 9 };
    expect(resolveCameraChannel('Camera phong IT', channels)).toBe(9);
    expect(resolveCameraChannel('CAMERA PHONG IT', channels)).toBeUndefined();
    expect(resolveCameraChannel('Camera phong IT 2', channels)).toBeUndefined();
  });

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

  it('event người đi bộ chỉ có object_image_path vẫn được nhận', () => {
    const evt = toIvssFaceEvent(
      {
        object_id: 'o2',
        camera_id: 'Phong C401',
        object_type: 'pedestrian',
        object_image_path: 'OBJECT_IMAGE/1/o2.jpg',
        first_timestamp: 1760090000,
      },
      map,
    );
    expect(evt).toEqual({
      type: 'face_recognized',
      channelId: 3,
      personUid: undefined,
      name: undefined,
      similarity: undefined,
      utc: '2025-10-10T09:53:20.000Z',
    });
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
