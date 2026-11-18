import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FaceEventDto } from './face-event.dto.js';

const base = {
  type: 'face_recognized',
  channelId: 5,
  personUid: 'p1',
  utc: '2026-06-22T09:00:00Z',
};

const errorsFor = async (raw: Record<string, unknown>) => {
  const dto = plainToInstance(FaceEventDto, raw, {
    enableImplicitConversion: false,
  });
  return { dto, errors: await validate(dto, { whitelist: true }) };
};

describe('FaceEventDto (IVS-001 #36, R4)', () => {
  it("channelId '5' (string) → transform thành number 5, @IsInt pass", async () => {
    const { dto, errors } = await errorsFor({ ...base, channelId: '5' });
    expect(typeof dto.channelId).toBe('number');
    expect(dto.channelId).toBe(5);
    expect(errors.find((e) => e.property === 'channelId')).toBeUndefined();
  });

  it("utc 'not-a-date' → lỗi @IsISO8601", async () => {
    const { errors } = await errorsFor({ ...base, utc: 'not-a-date' });
    expect(errors.some((e) => e.property === 'utc')).toBe(true);
  });

  it('utc ISO hợp lệ → KHÔNG lỗi', async () => {
    const { errors } = await errorsFor({ ...base });
    expect(errors.length).toBe(0);
  });

  it('thiếu type → lỗi validate', async () => {
    const { errors } = await errorsFor({
      channelId: 5,
      utc: '2026-06-22T09:00:00Z',
    });
    const props = errors.map((e) => e.property);
    expect(props).toContain('type');
  });

  // [FIX 2026-08-17] personUid giờ optional: nCandidateNum<=0 (người lạ hoàn
  // toàn, 0 candidate) → bridge forward type='face_recognition' KHÔNG kèm
  // personUid. Trước đây @IsNotEmpty() khiến case này bị 400 ngay từ Pipe,
  // KHÔNG bao giờ tới được onFaceEvent() — đây chính là nguyên nhân gốc
  // "người lạ hoàn toàn không có log gì".
  it('thiếu personUid (0 candidate, người lạ hoàn toàn) → KHÔNG lỗi validate', async () => {
    const { dto, errors } = await errorsFor({
      type: 'face_recognized',
      channelId: 5,
      utc: '2026-06-22T09:00:00Z',
    });
    expect(errors.find((e) => e.property === 'personUid')).toBeUndefined();
    expect(dto.personUid).toBeUndefined();
  });

  it('personUid rỗng (string "") → vẫn lỗi @IsString/@IsNotEmpty tương đương KHÔNG áp dụng nữa — chỉ còn @IsString, "" vẫn hợp lệ vì KHÔNG dùng @IsNotEmpty', async () => {
    const { errors } = await errorsFor({ ...base, personUid: '' });
    expect(errors.find((e) => e.property === 'personUid')).toBeUndefined();
  });

  it('field thừa + whitelist:true → bị strip khỏi instance', async () => {
    const dto = plainToInstance(FaceEventDto, {
      ...base,
      bogusField: 'should-be-stripped',
      another: 123,
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.length).toBe(0);
    // whitelist:true → class-validator xóa field không-decorator khỏi instance.
    const asRecord = dto as unknown as Record<string, unknown>;
    expect(asRecord.bogusField).toBeUndefined();
    expect(asRecord.another).toBeUndefined();
    // Field hợp lệ giữ nguyên.
    expect(dto.type).toBe('face_recognized');
    expect(dto.personUid).toBe('p1');
  });
});
