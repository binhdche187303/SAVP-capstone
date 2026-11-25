import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HgvisionClient, HgvisionError } from './hgvision.client';
import {
  assertPlaybackWindow,
  HgvisionCameraService,
  playbackFileName,
  proxiedMediaUrl,
} from './hgvision-camera.service';

const cfg = {
  get: (k: string, d?: unknown) =>
    ({
      HGVISION_BASE_URL: 'http://hg.local:8113',
      HGVISION_CLIENT_ID: 'cli',
      HGVISION_CLIENT_SECRET: 'sk',
    })[k] ?? d,
} as unknown as ConfigService;

const json = (v: unknown) => ({
  status: 200,
  headers: new Headers(),
  body: Buffer.from(JSON.stringify(v)),
});

const T0 = Date.UTC(2026, 10, 23, 2, 0, 0); // 09:00 giờ VN
const H = 3600_000;

function mk(fetchPublicMedia: jest.Mock, extra: Record<string, unknown> = {}) {
  const client = {
    listCameras: jest
      .fn()
      .mockResolvedValue([{ camera_name: 'Cong chinh', status: 'Online' }]),
    fetchPublicMedia,
    ...extra,
  };
  return {
    client,
    svc: new HgvisionCameraService(client as unknown as HgvisionClient, cfg),
  };
}

describe('HGVision playback (xem lại)', () => {
  it('recordings: gộp khoảng + đoạn, cắt theo khoảng tìm, thumb qua proxy BE', async () => {
    const fetch = jest.fn((path: string) =>
      Promise.resolve(
        path.startsWith('/api/playback/recordings')
          ? json([
              { start_ms: T0 + H / 2, end_ms: T0 + 2 * H },
              { start_ms: T0 - H, end_ms: T0 + 600_000 },
            ])
          : json([
              {
                start_ms: T0 + H / 2,
                end_ms: T0 + H,
                thumb_url:
                  'http://10.0.0.5:8113/api/recording/thumb/data/a.jpg',
                file_url: 'http://10.0.0.5:8113/api/recording/video/data/a.mp4',
              },
            ]),
      ),
    );
    const { svc } = mk(fetch);
    const out = await svc.playbackRecordings('Cong chinh', T0, T0 + H);
    expect(fetch).toHaveBeenCalledWith(
      `/api/playback/recordings?camera_id=Cong+chinh&start_time=${T0}&end_time=${T0 + H}`,
    );
    expect(out.ranges).toEqual([
      { startMs: T0, endMs: T0 + 600_000 },
      { startMs: T0 + H / 2, endMs: T0 + H },
    ]);
    expect(out.segments).toEqual([
      {
        startMs: T0 + H / 2,
        endMs: T0 + H,
        thumbUrl:
          '/api/v1/hgvision/stream?path=%2Fapi%2Frecording%2Fthumb%2Fdata%2Fa.jpg',
      },
    ]);
  });

  it('recordings: HGVision 404 (không có bản ghi) → rỗng; segments lỗi 503 không làm hỏng', async () => {
    const fetch = jest.fn((path: string) =>
      Promise.reject(
        new HgvisionError('x', path.includes('segments') ? 503 : 404),
      ),
    );
    const out = await mk(fetch).svc.playbackRecordings(
      'Cong chinh',
      T0,
      T0 + H,
    );
    expect(out.ranges).toEqual([]);
    expect(out.segments).toEqual([]);
  });

  it('recordings: camera lạ → 404, không gọi HGVision playback', async () => {
    const fetch = jest.fn();
    await expect(
      mk(fetch).svc.playbackRecordings('khong-co', T0, T0 + H),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('playlist: viết lại segment /api/recording/video qua proxy', async () => {
    const fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      body: Buffer.from(
        '#EXTM3U\n#EXTINF:60,\n/api/recording/video/data/rec/a.mp4\n#EXT-X-ENDLIST\n',
      ),
    });
    const out = await mk(fetch).svc.playbackPlaylist('Cong chinh', T0, T0 + H);
    expect(out).toContain(
      '/api/v1/hgvision/stream?path=%2Fapi%2Frecording%2Fvideo%2Fdata%2Frec%2Fa.mp4',
    );
    expect(out).toContain('#EXT-X-ENDLIST');
  });

  it('download: vượt 1 giờ → 400; hợp lệ → stream + tên file theo giờ VN', async () => {
    const stream = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-length': '10' }),
      body: {} as ReadableStream,
    });
    const { svc } = mk(jest.fn(), { streamPublicMedia: stream });
    await expect(
      svc.playbackDownload('Cong chinh', T0, T0 + 2 * H),
    ).rejects.toBeInstanceOf(BadRequestException);
    const f = await svc.playbackDownload('Cong chinh', T0, T0 + H / 4);
    expect(stream).toHaveBeenCalledWith(
      expect.stringContaining('/api/playback/download?'),
      expect.any(Number),
    );
    expect(f).toMatchObject({
      contentLength: '10',
      fileName: 'Cong_chinh_20261123-0900_0915.mp4',
    });
  });

  it('assertPlaybackWindow chặn to<=from, thiếu số, quá dài', () => {
    expect(() => assertPlaybackWindow(T0, T0, H)).toThrow(BadRequestException);
    expect(() => assertPlaybackWindow(NaN, T0, H)).toThrow(BadRequestException);
    expect(() => assertPlaybackWindow(T0, T0 + 2 * H, H)).toThrow(
      BadRequestException,
    );
    expect(() => assertPlaybackWindow(T0, T0 + H, H)).not.toThrow();
  });

  it('proxiedMediaUrl chỉ nhận path playback/recording', () => {
    expect(proxiedMediaUrl('http://x/api/cameras')).toBeNull();
    expect(proxiedMediaUrl(null)).toBeNull();
    expect(proxiedMediaUrl('/api/recording/thumb/a.jpg')).toBe(
      '/api/v1/hgvision/stream?path=%2Fapi%2Frecording%2Fthumb%2Fa.jpg',
    );
  });

  it('playbackFileName bỏ dấu tiếng Việt', () => {
    expect(playbackFileName('Cổng đông', T0, T0 + H)).toBe(
      'Cong_dong_20261123-0900_1000.mp4',
    );
  });

  it('lỗi HGVision khác 404 vẫn được báo (vd mất kết nối → 503)', async () => {
    const fetch = jest.fn().mockRejectedValue(new HgvisionError('down', 0));
    const err = (await mk(fetch)
      .svc.playbackRecordings('Cong chinh', T0, T0 + H)
      .catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(503);
  });
});
