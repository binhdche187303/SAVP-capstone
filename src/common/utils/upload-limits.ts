/**
 * Trần cứng kích thước file ở tầng Multer.
 *
 * Vì sao: Multer (memoryStorage) nạp TOÀN BỘ file vào RAM trước khi service kiểm tra giới hạn
 * nghiệp vụ. Không đặt `limits.fileSize` thì một request 500MB chiếm 500MB RAM rồi mới bị từ chối
 * → vài request lớn cùng lúc có thể làm backend hết bộ nhớ.
 *
 * Trần đặt GẤP ĐÔI giới hạn nghiệp vụ: file vượt nhẹ vẫn tới service để nhận đúng mã lỗi + thông
 * báo tiếng Việt như cũ; file khổng lồ bị Multer cắt ngay khi đang nhận (413).
 */
const MB = 1024 * 1024;

/** Giới hạn nghiệp vụ đọc từ biến môi trường (giống ConfigService của service), không có → mặc định. */
export function envBytes(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function uploadCeiling(serviceLimitBytes: number): number {
  return Math.max(serviceLimitBytes * 2, 1 * MB);
}

export const UPLOAD_CEILING = {
  avatar: uploadCeiling(envBytes('AVATAR_PHOTO_MAX_BYTES', 5 * MB)),
  biometric: uploadCeiling(envBytes('FACE_PORTRAIT_MAX_BYTES', 5 * MB)),
  /** Excel + ảnh lẻ + file zip ảnh (zip tối đa 100MB). */
  accountImport: uploadCeiling(100 * MB),
  floorPlan: uploadCeiling(10 * MB),
  agendaAttachment: uploadCeiling(envBytes('AGENDA_ATTACHMENT_MAX_BYTES', 20 * MB)),
  minutesAttachment: uploadCeiling(envBytes('MINUTES_ATTACHMENT_MAX_BYTES', 20 * MB)),
  excelImport: 20 * MB,
  reportAsset: 10 * MB,
} as const;
