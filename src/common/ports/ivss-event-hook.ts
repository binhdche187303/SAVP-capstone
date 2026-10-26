/**
 * IVSS_EVENT_HANDLER (IVS-001 / IVSS #36) — port nối webhook IVSS → handler nghiệp vụ.
 *
 * Đặt ở `common` (leaf, không import module nào) để controller IVSS inject handler mà
 * KHÔNG phụ thuộc module nghiệp vụ → tránh circular (mẫu y hệt FACE_VERIFY_HOOK / STRANGER_ALERT_HOOK).
 * #36 cung cấp default impl log-only; #38–40 override bằng `useExisting` impl thật.
 */

export interface IvssFaceEvent {
  /** Loại event bridge gửi (vd 'face_recognized'). */
  type: string;
  /** Channel camera trên IVSS (đã normalize về number — R4). */
  channelId: number;
  /** Định danh person trên IVSS — KHÔNG có nếu 0 candidate (người lạ hoàn toàn, [FIX 2026-08-17]). */
  personUid?: string;
  /** Tên hiển thị (nếu có). */
  name?: string;
  /** Độ tương đồng (nếu có). */
  similarity?: number;
  /** Hành động event (nếu có). */
  eventAction?: string;
  /** Thời điểm event (ISO-8601 từ bridge). */
  utc: string;
  /** Ảnh chụp base64 (nếu có) — SEC-01: KHÔNG log/audit. */
  imageBase64?: string;
  allowHistorical?: boolean;
}

export interface IvssEventHandlerPort {
  onFaceEvent(evt: IvssFaceEvent): Promise<void>;
}

/** Injection token cho handler event IVSS. */
export const IVSS_EVENT_HANDLER = Symbol('IVSS_EVENT_HANDLER');
