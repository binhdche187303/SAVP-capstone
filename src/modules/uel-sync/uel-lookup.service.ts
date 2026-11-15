import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UelApiClient, UelApiError } from './uel-api.client.js';
import type { UelFilter } from './uel-api.client.js';
import { UEL_API } from './uel-api.types.js';
import { UEL_API_CLIENT } from './uel-sync.constants.js';
import { toUelDate } from './uel-sync.mapper.js';

/** Số dòng tối đa trả về cho 1 lượt tra cứu. */
const LOOKUP_LIMIT = 500;

/**
 * Tra cứu trực tiếp 6 API "từng người / từng buổi" của Đào tạo UEL.
 * Không ghi gì vào DB — chỉ chuyển tiếp và trả lại kết quả cho trang quản trị.
 */
export const UEL_LOOKUP_TYPES = [
  'staff', // thong_tin_nhansu
  'student', // thong_tin_sv
  'studentEnrollments', // dkhp_ds_dangkycua1sinhvien
  'lecturerDay', // chi_tiet_tkb_gv_1ngay
  'studentDay', // chi_tiet_tkb_sv_1ngay
  'session', // chi_tiet_tkb_1buoi
] as const;
export type UelLookupType = (typeof UEL_LOOKUP_TYPES)[number];

export interface UelLookupQuery {
  type: UelLookupType;
  /** Mã cán bộ / mã sinh viên / mã giảng viên / mã buổi học (tùy loại). */
  code: string;
  /** yyyy-MM-dd — bắt buộc với lecturerDay, studentDay. */
  date?: string;
}

export interface UelLookupResult {
  type: UelLookupType;
  api: string;
  items: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}

const SPEC: Record<
  UelLookupType,
  { api: string; build: (q: UelLookupQuery) => UelFilter; needsDate?: true }
> = {
  staff: {
    api: UEL_API.THONG_TIN_NHANSU,
    build: (q) => ({ ma_nhan_su: q.code }),
  },
  student: {
    api: UEL_API.THONG_TIN_SV,
    build: (q) => ({ ma_sinh_vien: q.code }),
  },
  studentEnrollments: {
    api: UEL_API.DKHP_CUA_1_SV,
    build: (q) => ({ ma_sinh_vien: q.code }),
  },
  lecturerDay: {
    api: UEL_API.TKB_GV_1NGAY,
    build: (q) => ({ ma_giang_vien: q.code, ngay_hoc: toUelDate(q.date!) }),
    needsDate: true,
  },
  studentDay: {
    api: UEL_API.TKB_SV_1NGAY,
    build: (q) => ({ ma_sinh_vien: q.code, ngay_hoc: toUelDate(q.date!) }),
    needsDate: true,
  },
  session: {
    api: UEL_API.TKB_1BUOI,
    build: (q) => ({ ma_buoi_hoc: Number(q.code) }),
  },
};

@Injectable()
export class UelLookupService {
  constructor(@Inject(UEL_API_CLIENT) private readonly client: UelApiClient) {}

  async lookup(q: UelLookupQuery): Promise<UelLookupResult> {
    const spec = SPEC[q.type];
    if (!spec)
      throw new BadRequestException(`Loại tra cứu không hợp lệ: ${q.type}`);
    const code = q.code?.trim();
    if (!code) throw new BadRequestException('Thiếu mã cần tra cứu.');
    if (spec.needsDate && !q.date) {
      throw new BadRequestException('Loại tra cứu này cần ngày (yyyy-MM-dd).');
    }
    if (q.type === 'session' && !/^\d{1,12}$/.test(code)) {
      throw new BadRequestException('Mã buổi học phải là số.');
    }
    if (!this.client.configured) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình UEL_API_BASE_URL / UEL_API_KEY.',
      );
    }

    try {
      // Một trang tối đa đủ cho tra cứu 1 người / 1 buổi; báo truncated nếu còn nữa.
      const page = await this.client.page<Record<string, unknown>>(
        spec.api,
        spec.build({ ...q, code }),
        1,
        LOOKUP_LIMIT,
      );
      return {
        type: q.type,
        api: spec.api,
        items: page.items,
        total: page.total,
        truncated: page.total > page.items.length,
      };
    } catch (e) {
      if (e instanceof UelApiError) throw new BadGatewayException(e.message);
      throw e;
    }
  }
}
