import { PLATE_ALLOWED_CHARS, isPlateStructureValid } from './plate-format.js';

const isValid = (raw: string): boolean =>
  PLATE_ALLOWED_CHARS.test(raw) && isPlateStructureValid(raw);

describe('plate-format (BUG-004)', () => {
  it.each([
    '30F-256.58',
    '29A-12345',
    '51F-004.88',
    '30f 256 58',
    '29A-1234',
    'TM-12-34',
    '80-NG-123-45',
  ])('chấp nhận %s', (raw) => {
    expect(isValid(raw)).toBe(true);
  });

  it.each([
    '1',
    '<b>@@##</b>',
    '@@##',
    'QA TEST',
    '30Đ-256.58',
    '30F-256.58💥',
    '123456789012345678',
    'ABCD-123',
    '',
    '   ',
  ])('từ chối %j', (raw) => {
    expect(isValid(raw)).toBe(false);
  });

  it('ký tự lạ bị chặn ở PLATE_ALLOWED_CHARS dù phần còn lại hợp lệ', () => {
    expect(PLATE_ALLOWED_CHARS.test('30F_25658')).toBe(false);
    expect(isPlateStructureValid('30F_25658')).toBe(true);
  });
});
