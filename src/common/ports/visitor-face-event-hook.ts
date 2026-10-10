/**
 * VISITOR_FACE_EVENT_HOOK (VIS-BE-001 / Khách 2.10) — port nối `ivss` và `face-access` → `visitors`.
 *
 * Đặt ở `common` (leaf, không import module nào) để ivss/face-access gọi sang phân hệ Khách mà KHÔNG import
 * ngược → tránh vòng phụ thuộc (mẫu y hệt FACE_VERIFY_HOOK / STRANGER_ALERT_HOOK). Đăng ký bằng `useExisting`
 * ở `VisitorHooksModule`. Hook KHÔNG được ném lỗi và không được làm chậm webhook thiết bị.
 */
export interface VisitorIvssFaceEvent {
  /** users.id đã nhận diện (đã qua ngưỡng độ tương đồng của IVSS). */
  userId: string;
  /** Khu vực của camera (channel_presence_zone_map), null nếu camera không map khu. */
  zoneId: string | null;
  /** Hướng suy từ channel_direction_map / eventAction; 'seen' = camera không phân biệt vào/ra. */
  direction: 'enter' | 'leave' | 'seen';
  eventTime: Date;
  /** 0..1, null nếu bridge không gửi. */
  similarity: number | null;
  /** iot_device_events.id vừa lưu. */
  sourceEventId: string | null;
  /** iot_devices.id của bridge. */
  deviceId: string | null;
}

export interface VisitorFaceGateVerify {
  visitId: string;
  /** iot_devices.id của FaceGate. */
  deviceId: string;
  /** iot_devices.zone_id của thiết bị, null nếu thiết bị gắn theo phòng. */
  zoneId: string | null;
  direction: 'in' | 'out';
  verifyTime: Date;
}

export interface VisitorFaceEventHook {
  onIvssFaceEvent(evt: VisitorIvssFaceEvent): Promise<void>;
  onFaceGateVerify(evt: VisitorFaceGateVerify): Promise<void>;
}

/** Injection token cho hook sự kiện khuôn mặt → phân hệ Khách. */
export const VISITOR_FACE_EVENT_HOOK = Symbol('VISITOR_FACE_EVENT_HOOK');
