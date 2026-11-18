/**
 * FaceDeviceProviderPort (FGC-001 / §11.3) — hợp đồng vendor-agnostic cho thiết bị face.
 * B/C/D phụ thuộc port này, KHÔNG phụ thuộc FaceGate impl cụ thể.
 */

export interface FaceFileRef {
  dwfiletype: number;
  dwfileindex: number;
  dwfilepos: number;
}

export interface AddPersonInput {
  /** Khoá định danh của mình (Ticket B: userId:bookingId — duy nhất per enrollment). */
  uname: string;
  faceRef: FaceFileRef;
  /** Giờ bắt đầu họp (UTC instant). */
  validFrom: Date;
  /** Giờ kết thúc họp (UTC instant). */
  validTo: Date;
  /** Danh sách door/IPC channel cho phép; mặc định tất cả. */
  jurisdiction?: number[];
}

export interface FaceGateResponse {
  errNo: number;
  root: Record<string, Record<string, string>>;
}

export type FaceDeviceErrorKind =
  | 'device_error'
  | 'http_error'
  | 'timeout'
  | 'parse_error'
  | 'not_implemented';

/** Lỗi typed — message ĐÃ sanitize (KHÔNG chứa creds/Authorization/url-có-cred). */
export class FaceDeviceError extends Error {
  constructor(
    public readonly kind: FaceDeviceErrorKind,
    message: string,
    public readonly errNo?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'FaceDeviceError';
  }
}

export interface FaceDeviceProviderPort {
  /** Upload ảnh khuôn mặt → file ref (ẩn số, reverse-engineer khi smoke). */
  uploadFace(image: Buffer): Promise<FaceFileRef>;
  /** Thêm person vào whitelist (validity = giờ họp). ok khi ERR.no=0. */
  addPerson(input: AddPersonInput): Promise<{ ok: true }>;
  /** Tìm uid theo uname (vì add KHÔNG trả uid). null nếu không thấy. */
  findUidByName(uname: string): Promise<string | null>;
  /** Xóa person theo uid. */
  deletePerson(uid: string): Promise<{ ok: true }>;
  /** Parse response text `root.<NS>.<field>=value` (pure, không ném). */
  parseResponse(text: string): FaceGateResponse;
}
