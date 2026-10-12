import { isValidVnPhone, normalizeVnPhone } from './phone.util.js';
import type { VisitChannel } from '../constants/visit-status.constant.js';

export class VisitValidationError extends Error {
  constructor(message: string, public readonly code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'VisitValidationError';
  }
}

export interface VisitPayload {
  visitor?: {
    fullName?: string; idNumber?: string; phone?: string; email?: string;
    organization?: string; plateNumber?: string; photo?: string | null;
  };
  hostId?: string;
  purpose?: string;
  companions?: number;
  scheduledFrom?: string;
  scheduledTo?: string;
  consent?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * BR-V1, BR-V2. Thứ tự kiểm tra và THÔNG ĐIỆP trùng từng chữ với FE (`validateVisitPayload` của lớp giả) —
 * FE so chuỗi để hiện lỗi đúng chỗ. `hostExists` do người gọi tra DB.
 */
export function validateVisitPayload(
  p: VisitPayload,
  channel: VisitChannel,
  now: Date,
  cfg: { maxVisitDays: number },
  hostExists: boolean,
): void {
  const v = p.visitor ?? {};
  if (!String(v.fullName ?? '').trim()) throw new VisitValidationError('Vui lòng nhập họ tên khách');
  if (!isValidVnPhone(normalizeVnPhone(String(v.phone ?? '')))) throw new VisitValidationError('Số điện thoại không hợp lệ');
  if (channel === 'online' && !EMAIL.test(String(v.email ?? '').trim())) {
    throw new VisitValidationError('Vui lòng nhập email hợp lệ để nhận kết quả');
  }
  if (v.email && String(v.email).trim() && !EMAIL.test(String(v.email).trim())) {
    throw new VisitValidationError('Vui lòng nhập email hợp lệ để nhận kết quả');
  }
  if (!p.hostId || !hostExists) throw new VisitValidationError('Vui lòng chọn người cần gặp');
  if (!String(p.purpose ?? '').trim()) throw new VisitValidationError('Vui lòng chọn mục đích');

  const from = new Date(p.scheduledFrom ?? '').getTime();
  const to = new Date(p.scheduledTo ?? '').getTime();
  if (Number.isNaN(from) || from < now.getTime() - 5 * MIN_MS) throw new VisitValidationError('Thời gian bắt đầu không được ở quá khứ');
  if (Number.isNaN(to) || to <= from) throw new VisitValidationError('Thời gian kết thúc phải sau thời gian bắt đầu');
  if (to - from > cfg.maxVisitDays * DAY_MS) throw new VisitValidationError(`Khung giờ hẹn tối đa ${cfg.maxVisitDays} ngày`);

  if (channel !== 'host_invite') {
    if (!v.photo) throw new VisitValidationError('Vui lòng chụp hoặc tải ảnh khuôn mặt');
    if (p.consent !== true) throw new VisitValidationError('Cần đồng ý xử lý dữ liệu sinh trắc để tiếp tục');
  }
}
