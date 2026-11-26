import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { HgvisionClient, HgvisionError } from './hgvision.client';
import { HgvisionCameraService } from './hgvision-camera.service';

const conf = {
  get: (k: string, d?: unknown) =>
    ({
      HGVISION_BASE_URL: 'http://hg.local:8113',
      HGVISION_CLIENT_ID: 'cli',
      HGVISION_CLIENT_SECRET: 'sk',
    })[k] ?? d,
} as unknown as ConfigService;

const mk = (over: Record<string, jest.Mock> = {}) => {
  const c = {
    createCamera: jest.fn().mockResolvedValue({}),
    onvifGetUrls: jest.fn().mockResolvedValue({
      main_url: 'rtsp://10.0.0.5:554/main',
      sub_url: 'rtsp://10.0.0.5:554/sub',
      urls: [
        { profile: 'P1', url: 'rtsp://10.0.0.5:554/main' },
        { profile: 'P2', url: 'rtsp://10.0.0.5:554/sub' },
      ],
    }),
    onvifGetConfig: jest.fn().mockResolvedValue({
      codec: 'H265',
      image_width: 2688,
      image_height: 1520,
      bitrate: 4096,
      fps: 25,
    }),
    onvifSetConfig: jest.fn().mockResolvedValue({}),
    ...over,
  };
  return {
    c,
    svc: new HgvisionCameraService(c as unknown as HgvisionClient, conf),
  };
};

const onvifDto = {
  name: 'G-1 A1-101',
  ip: '10.0.0.5',
  username: 'admin',
  password: 'p@ss',
};

describe('HgvisionCameraService.createCamera', () => {
  it('ONVIF: lấy URL, ép H.264 cả 2 profile, tạo camera ONVIF', async () => {
    const { c, svc } = mk();
    const r = await svc.createCamera(onvifDto);
    expect(r).toEqual({ name: 'G-1 A1-101', h264: 'ok' });
    expect(c.onvifGetUrls).toHaveBeenCalledWith({
      ip_address: '10.0.0.5',
      port: '80',
      username: 'admin',
      password: 'p@ss',
    });
    expect(c.onvifSetConfig).toHaveBeenCalledTimes(2);
    expect(c.onvifSetConfig).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        profile_token: 'P2',
        codec: 'H264',
        image_width: 2688,
        fps: 25,
      }),
    );
    expect(c.createCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol_type: 'ONVIF',
        camera_url: 'rtsp://10.0.0.5:554/main',
        sub_url: 'rtsp://10.0.0.5:554/sub',
        username: 'admin',
      }),
    );
  });

  it('ONVIF: đã là H.264 thì không ghi cấu hình', async () => {
    const { c, svc } = mk({
      onvifGetConfig: jest.fn().mockResolvedValue({ codec: 'H264' }),
    });
    const r = await svc.createCamera(onvifDto);
    expect(r.h264).toBe('already');
    expect(c.onvifSetConfig).not.toHaveBeenCalled();
  });

  it('ONVIF: ép H.264 lỗi vẫn thêm camera, trả cảnh báo', async () => {
    const { c, svc } = mk({
      onvifSetConfig: jest
        .fn()
        .mockRejectedValue(new HgvisionError('fail', 502)),
    });
    const r = await svc.createCamera(onvifDto);
    expect(r.h264).toBe('failed');
    expect(r.h264Message).toBeTruthy();
    expect(c.createCamera).toHaveBeenCalled();
  });

  it('ONVIF: không kết nối được camera → 502 dễ hiểu, không tạo camera', async () => {
    const { c, svc } = mk({
      onvifGetUrls: jest
        .fn()
        .mockRejectedValue(new HgvisionError('timeout', 502)),
    });
    const err = await svc.createCamera(onvifDto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getResponse()).toMatchObject({
      error: { code: 'HGVISION_ONVIF_FAILED' },
    });
    expect(c.createCamera).not.toHaveBeenCalled();
  });

  it('RTSP: dùng URL nhập tay, không gọi ONVIF', async () => {
    const { c, svc } = mk();
    const r = await svc.createCamera({
      name: 'X',
      protocol: 'RTSP',
      mainUrl: 'rtsp://a/b',
    });
    expect(r.h264).toBe('skipped');
    expect(c.onvifGetUrls).not.toHaveBeenCalled();
    expect(c.createCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol_type: 'RTSP',
        camera_url: 'rtsp://a/b',
      }),
    );
  });
});
