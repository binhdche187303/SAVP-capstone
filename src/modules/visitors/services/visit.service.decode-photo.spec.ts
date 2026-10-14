import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { VisitService } from './visit.service.js';

const svc = new VisitService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
const url = (mime: string, bytes: Buffer) => `data:${mime};base64,${bytes.toString('base64')}`;

describe('VisitService.decodePhoto', () => {
  it('không có ảnh → null', () => {
    expect(svc.decodePhoto(null)).toBeNull();
    expect(svc.decodePhoto(undefined)).toBeNull();
  });

  it('JPEG và PNG thật được nhận, mimeType lấy theo nội dung', () => {
    expect(svc.decodePhoto(url('image/jpeg', Buffer.from(JPEG_HEAD)))?.mimeType).toBe('image/jpeg');
    expect(svc.decodePhoto(url('image/png', Buffer.from(PNG_HEAD)))?.mimeType).toBe('image/png');
    // khai sai tiền tố nhưng nội dung là JPEG thật → dùng mime thật
    expect(svc.decodePhoto(url('image/png', Buffer.from(JPEG_HEAD)))?.mimeType).toBe('image/jpeg');
  });

  it('nội dung KHÔNG phải ảnh nhưng khai image/png → 400 INVALID_PHOTO', () => {
    const fake = url('image/png', Buffer.from('<script>alert(1)</script>'.repeat(10)));
    expect(() => svc.decodePhoto(fake)).toThrow(BadRequestException);
    try { svc.decodePhoto(fake); } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ error: { code: 'INVALID_PHOTO' } });
    }
  });

  it('tiền tố không phải JPEG/PNG → 400', () => {
    expect(() => svc.decodePhoto('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toThrow(BadRequestException);
    expect(() => svc.decodePhoto('not-a-data-url')).toThrow(BadRequestException);
  });

  it('quá 2 MB → 413', () => {
    const big = Buffer.concat([Buffer.from(JPEG_HEAD), Buffer.alloc(2 * 1024 * 1024)]);
    expect(() => svc.decodePhoto(url('image/jpeg', big))).toThrow(PayloadTooLargeException);
  });
});
