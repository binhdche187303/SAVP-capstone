import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UelApiClient, UelApiError } from './uel-api.client';
import { UelLookupService } from './uel-lookup.service';

function make(configured = true) {
  const page = jest.fn();
  const client = { configured, page } as unknown as UelApiClient;
  return { svc: new UelLookupService(client), page };
}

describe('UelLookupService', () => {
  it('gọi đúng API + tham số cho từng loại', async () => {
    const { svc, page } = make();
    page.mockResolvedValue({
      items: [{ a: 1 }],
      total: 1,
      page: 1,
      limit: 500,
      totalPages: 1,
    });

    await svc.lookup({ type: 'staff', code: ' NS003 ' });
    await svc.lookup({
      type: 'studentDay',
      code: 'K254061001',
      date: '2026-11-09',
    });
    const r = await svc.lookup({ type: 'session', code: '900100' });

    expect(page.mock.calls).toEqual([
      ['nhansu/thong_tin_nhansu', { ma_nhan_su: 'NS003' }, 1, 500],
      [
        'thoikhoabieu/chi_tiet_tkb_sv_1ngay',
        { ma_sinh_vien: 'K254061001', ngay_hoc: '2026-11-09' },
        1,
        500,
      ],
      ['thoikhoabieu/chi_tiet_tkb_1buoi', { ma_buoi_hoc: 900100 }, 1, 500],
    ]);
    expect(r).toEqual({
      type: 'session',
      api: 'thoikhoabieu/chi_tiet_tkb_1buoi',
      items: [{ a: 1 }],
      total: 1,
      truncated: false,
    });
  });

  it('báo thiếu ngày, mã buổi không phải số, thiếu mã', async () => {
    const { svc, page } = make();
    await expect(
      svc.lookup({ type: 'lecturerDay', code: 'NS003' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.lookup({ type: 'session', code: 'abc' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.lookup({ type: 'student', code: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(page).not.toHaveBeenCalled();
  });

  it('503 khi chưa cấu hình key; 502 khi API UEL lỗi', async () => {
    await expect(
      make(false).svc.lookup({ type: 'staff', code: 'NS001' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    const { svc, page } = make();
    page.mockRejectedValue(
      new UelApiError('UEL API HTTP 401 ApiKey.Invalid', 401, 'ApiKey.Invalid'),
    );
    await expect(
      svc.lookup({ type: 'staff', code: 'NS001' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
