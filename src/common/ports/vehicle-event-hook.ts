/**
 * VEHICLE_EVENT_HANDLER (VWH-001 / UC4 ANPR) — port nối webhook vehicle → handler nghiệp vụ.
 *
 * Đặt ở `common` (leaf, KHÔNG import module nghiệp vụ) để webhook controller inject handler
 * mà không phụ thuộc module → tránh circular (mẫu y hệt IVSS_EVENT_HANDLER #36).
 * UC4 cung cấp default impl log-only; UC5 override bằng `useExisting` impl thật (resolve+persist).
 */

export interface VehicleEvent {
  /** Biển gốc từ camera (CHƯA normalize) — để lưu hiển thị/debug. */
  plateRaw: string;
  /** Biển đã chuẩn hóa qua normalizePlate (UC1) — để khớp DB. */
  plateNumber: string;
  /** Channel camera IVSS thấy xe. */
  channelId: number;
  /** Thời điểm event (ISO-8601 từ bridge). */
  utc: string;
  /** Hướng/cổng vào-ra (nếu bridge gửi) — UC5/UC7 diễn giải. */
  eventAction?: string;
  /** Màu biển (szPlateColor) nếu có. */
  plateColor?: string;
  /** Màu xe (szVehicleColor) nếu có. */
  vehicleColor?: string;
  /** Loại xe camera đoán nếu có. */
  vehicleType?: string;
  /** Ảnh chụp base64 (nếu có) — SEC-01: KHÔNG log/audit. */
  imageBase64?: string;
  /**
   * Nguồn HGVision: đường dẫn ảnh trên server HGVision (ảnh toàn cảnh / ảnh cắt biển).
   * Chỉ lưu đường dẫn vào payload — ảnh xem qua BE proxy (DeviceEventSnapshotService),
   * không tải về MinIO trừ khi poller đã gửi kèm imageBase64 (sự kiện quan trọng).
   */
  remoteImagePath?: string;
  remotePlateImagePath?: string;
}

export interface VehicleEventHandlerPort {
  onVehicleEvent(evt: VehicleEvent): Promise<void>;
}

/** Injection token cho handler event vehicle. */
export const VEHICLE_EVENT_HANDLER = Symbol('VEHICLE_EVENT_HANDLER');
