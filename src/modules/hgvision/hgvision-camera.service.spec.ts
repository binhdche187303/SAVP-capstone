import { DataSource } from 'typeorm';
import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HgvisionClient, HgvisionError } from './hgvision.client';
import {
  assertHlsPlaylist,
  assertMediaPath,
  maskUrlCredentials,
  resolveLiveSource,
  HgvisionCameraService,
  rewritePlaylist,
  toUpstreamPath,
} from './hgvision-camera.service';

const cfg = (over: Record<string, string> = {}) =>
  ({
    get: (k: string, d?: unknown) =>
      ({
        HGVISION_BASE_URL: 'http://hg.local:8113',
        HGVISION_CLIENT_ID: 'cli',
        HGVISION_CLIENT_SECRET: 'sk',
        ...over,
      })[k] ?? d,
  }) as unknown as ConfigService;

function mkClient(over: Record<string, unknown> = {}) {
  return {
    listCameras: jest.fn().mockResolvedValue([
      { camera_name: 'B', camera_index: 2, status: 'Offline' },
      {
        camera_name: 'Cong chinh',
        camera_index: 1,
        camera_group: 'Cong',
        status: 'Online',
        using_ai: true,
        using_face_recognition: true,
        fps: 25,
        live_hls_path: '/live/Cong%20chinh/index.m3u8',
      },
    ]),
    listCamerasHealth: jest.fn().mockResolvedValue([
      {
        camera_name: 'Cong chinh',
        level: 'good',
        fps: 24,
        updated_ms: 0,
      },
    ]),
    fetchPublicMedia: jest.fn(),
    writeEnabled: false,
    grantedScopes: [],
    ...over,
  } as unknown as Record<string, jest.Mock>;
}

const mkSvc = (c: Record<string, jest.Mock>, conf = cfg()) =>
  new HgvisionCameraService(c as unknown as HgvisionClient, conf);

describe('HgvisionCameraService', () => {
  it('gộp camera + health, sắp theo index, trả link live qua BE', async () => {
    const svc = mkSvc(mkClient(), cfg());
    const list = await svc.listCameras();
    expect(list.map((c) => c.name)).toEqual(['Cong chinh', 'B']);
    expect(list[0]).toMatchObject({
      status: 'online',
      group: 'Cong',
      usingFace: true,
      health: { level: 'good', fps: 24 },
      liveUrl: '/api/v1/hgvision/live/Cong%20chinh/index.m3u8',
    });
    expect(list[1]).toMatchObject({ status: 'offline', health: null });
  });

  it('gắn khu vực SAVP: thiết bị gán trực tiếp ưu tiên hơn ánh xạ kênh', async () => {
    const query = jest.fn((sql: string) => {
      if (sql.includes('system_configs'))
        return [
          {
            config_key: 'hgvision.camera_channel_map',
            config_json: { 'Cong chinh': 3, B: 4 },
          },
          {
            config_key: 'ivss.channel_presence_zone_map',
            config_json: { '3': 'z-gate', '4': 'z-gate' },
          },
        ];
      if (sql.includes('iot_devices'))
        return [{ camera_name: ' b ', zone_id: 'z-lobby' }];
      return [
        { id: 'z-gate', zone_name: 'Cổng chính' },
        { id: 'z-lobby', zone_name: 'Sảnh bảo vệ' },
      ];
    });
    const ds = { manager: { query } } as unknown as DataSource;
    const svc = new HgvisionCameraService(
      mkClient() as unknown as HgvisionClient,
      cfg(),
      ds,
    );
    const list = await svc.listCameras();
    expect(list.map((c) => [c.name, c.zoneId, c.zoneName])).toEqual([
      ['Cong chinh', 'z-gate', 'Cổng chính'],
      ['B', 'z-lobby', 'Sảnh bảo vệ'],
    ]);
  });

  it('lỗi đọc khu vực vẫn trả danh sách camera', async () => {
    const ds = {
      manager: { query: jest.fn().mockRejectedValue(new Error('db down')) },
    } as unknown as DataSource;
    const svc = new HgvisionCameraService(
      mkClient() as unknown as HgvisionClient,
      cfg(),
      ds,
    );
    const list = await svc.listCameras();
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ zoneId: null, zoneName: null });
  });

  it('cache danh sách trong TTL', async () => {
    const client = mkClient();
    const svc = mkSvc(client, cfg());
    await svc.listCameras();
    await svc.listCameras();
    expect(client.listCameras).toHaveBeenCalledTimes(1);
  });

  it('health lỗi vẫn trả danh sách camera', async () => {
    const client = mkClient({
      listCamerasHealth: jest
        .fn()
        .mockRejectedValue(new HgvisionError('scope', 403)),
    });
    const list = await mkSvc(client, cfg()).listCameras();
    expect(list).toHaveLength(2);
    expect(list[0].health).toBeNull();
  });

  it('chưa cấu hình → 503 HGVISION_NOT_CONFIGURED, không gọi client', async () => {
    const client = mkClient();
    const svc = mkSvc(client, cfg({ HGVISION_CLIENT_SECRET: '' }));
    await expect(svc.listCameras()).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'HGVISION_NOT_CONFIGURED' } },
    });
    expect(client.listCameras).not.toHaveBeenCalled();
  });

  it.each([
    [0, 503, 'HGVISION_UNAVAILABLE'],
    [401, 502, 'HGVISION_AUTH_FAILED'],
    [403, 502, 'HGVISION_SCOPE_MISSING'],
    [404, 404, 'HGVISION_NOT_FOUND'],
    [500, 502, 'HGVISION_ERROR'],
  ])('lỗi HGVision %s → HTTP %s %s', async (up, status, code) => {
    const client = mkClient({
      listCameras: jest.fn().mockRejectedValue(new HgvisionError('x', up)),
    });
    const err = (await mkSvc(client, cfg())
      .listCameras()
      .catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(status);
    expect(err.getResponse()).toMatchObject({ error: { code } });
  });

  it('livePlaylist viết lại segment qua proxy', async () => {
    const client = mkClient({
      fetchPublicMedia: jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: Buffer.from('#EXTM3U\n#EXTINF:2,\nseg1.ts\n'),
      }),
    });
    const out = await mkSvc(client, cfg()).livePlaylist('Cong chinh');
    expect(client.fetchPublicMedia).toHaveBeenCalledWith(
      '/live/Cong%20chinh/index.m3u8',
      undefined,
      'api',
    );
    expect(out).toContain(
      '/api/v1/hgvision/stream?path=%2Flive%2FCong%2520chinh%2Fseg1.ts',
    );
  });

  it('livePlaylist: live_hls_path là TÊN luồng MediaMTX → gọi nguồn hls, segment gắn src=hls', async () => {
    const client = mkClient({
      listCameras: jest.fn().mockResolvedValue([
        {
          camera_name: 'Camera 2',
          status: 'Online',
          live_hls_path: 'afcd30ac-d287',
        },
      ]),
      fetchPublicMedia: jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: Buffer.from(
          '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nvideo1_stream.m3u8\n',
        ),
      }),
    });
    const out = await mkSvc(client, cfg()).livePlaylist('Camera 2');
    expect(client.fetchPublicMedia).toHaveBeenCalledWith(
      '/afcd30ac-d287/index.m3u8',
      undefined,
      'hls',
    );
    expect(out).toContain(
      'URI="/api/v1/hgvision/stream?path=%2Fafcd30ac-d287%2Finit.mp4&src=hls"',
    );
    expect(out).toContain(
      '/api/v1/hgvision/stream?path=%2Fafcd30ac-d287%2Fvideo1_stream.m3u8&src=hls',
    );
  });

  it('livePlaylist: HGVision trả HTML thay vì playlist → 502 HGVISION_LIVE_NOT_HLS', async () => {
    const client = mkClient({
      fetchPublicMedia: jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: Buffer.from('<!DOCTYPE html><html><head><title>HGVision'),
      }),
    });
    const err = (await mkSvc(client, cfg())
      .livePlaylist('Cong chinh')
      .catch((e: unknown) => e)) as HttpException;
    expect(err.getStatus()).toBe(502);
    expect(err.getResponse()).toMatchObject({
      error: { code: 'HGVISION_LIVE_NOT_HLS' },
    });
  });

  it('media: src=hls chuyển nguồn xuống client và giữ src=hls khi viết lại playlist con', async () => {
    const client = mkClient({
      fetchPublicMedia: jest.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({
          'content-type': 'application/vnd.apple.mpegurl',
        }),
        body: Buffer.from('#EXTM3U\nseg7.mp4\n'),
      }),
    });
    const out = await mkSvc(client, cfg()).media(
      '/cam/video1_stream.m3u8',
      undefined,
      'hls',
    );
    expect(client.fetchPublicMedia).toHaveBeenCalledWith(
      '/cam/video1_stream.m3u8',
      undefined,
      'hls',
    );
    expect(out.body.toString()).toContain(
      '/api/v1/hgvision/stream?path=%2Fcam%2Fseg7.mp4&src=hls',
    );
  });

  it('livePlaylist camera lạ → 404', async () => {
    const svc = mkSvc(mkClient(), cfg());
    await expect(svc.livePlaylist('khong-co')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('helpers', () => {
  it('maskUrlCredentials che tài khoản trong URL', () => {
    expect(
      maskUrlCredentials('lỗi rtsp://admin:Pa55@10.0.0.5:554/s timeout'),
    ).toBe('lỗi rtsp://***@10.0.0.5:554/s timeout');
    expect(maskUrlCredentials('rtsp://10.0.0.5:554 timeout')).toBe(
      'rtsp://10.0.0.5:554 timeout',
    );
    expect(maskUrlCredentials(undefined)).toBeUndefined();
  });

  it('rewritePlaylist: segment tương đối, tuyệt đối, URI= và URL ngoài', () => {
    const out = rewritePlaylist(
      [
        '#EXTM3U',
        '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
        'a.ts',
        '/media/b.ts',
        'https://cdn.example/c.ts',
        '',
      ].join('\n'),
      '/live/cam/index.m3u8',
    );
    const lines = out.split('\n');
    expect(lines[1]).toBe(
      '#EXT-X-KEY:METHOD=AES-128,URI="/api/v1/hgvision/stream?path=%2Flive%2Fcam%2Fkey.bin"',
    );
    expect(lines[2]).toBe('/api/v1/hgvision/stream?path=%2Flive%2Fcam%2Fa.ts');
    expect(lines[3]).toBe('/api/v1/hgvision/stream?path=%2Fmedia%2Fb.ts');
    expect(lines[4]).toBe('https://cdn.example/c.ts');
  });

  it.each([
    '/live/cam/seg1.ts',
    '/media/hls/seg000.ts',
    '/api/playback/stream/x.m3u8',
    '/api/recording/a.mp4',
  ])('assertMediaPath cho phép %s', (p) => {
    expect(() => assertMediaPath(p)).not.toThrow();
  });

  it.each([
    '',
    'live/x.ts',
    '//evil.com/x.ts',
    '/live/../api/oauth/token',
    '/api/identification/faces',
    '/api/cameras',
  ])('assertMediaPath chặn %s', (p) => {
    expect(() => assertMediaPath(p)).toThrow(BadRequestException);
  });

  it('resolveLiveSource: tên luồng → hls, path/URL → api, trống → /live/<tên>', () => {
    const base = 'http://hg.local:8113';
    expect(resolveLiveSource('abc_sub', 'Cam A', base)).toEqual({
      source: 'hls',
      path: '/abc_sub/index.m3u8',
    });
    expect(resolveLiveSource('/live/x/index.m3u8', 'Cam A', base)).toEqual({
      source: 'api',
      path: '/live/x/index.m3u8',
    });
    expect(resolveLiveSource(undefined, 'Cam A', base)).toEqual({
      source: 'api',
      path: '/live/Cam%20A/index.m3u8',
    });
  });

  it('assertHlsPlaylist: chấp nhận #EXTM3U (kể cả BOM/khoảng trắng), chặn HTML', () => {
    expect(() => assertHlsPlaylist('﻿  #EXTM3U\n')).not.toThrow();
    expect(() => assertHlsPlaylist('<!DOCTYPE html>')).toThrow(HttpException);
    expect(() => assertHlsPlaylist('')).toThrow(HttpException);
  });

  it('toUpstreamPath: URL cùng host → path, khác host → lỗi', () => {
    const base = 'http://hg.local:8113';
    expect(toUpstreamPath('http://hg.local:8113/live/a/index.m3u8', base)).toBe(
      '/live/a/index.m3u8',
    );
    expect(toUpstreamPath('live/a/index.m3u8', base)).toBe(
      '/live/a/index.m3u8',
    );
    expect(() => toUpstreamPath('http://evil:1/x.m3u8', base)).toThrow(
      BadRequestException,
    );
  });
});
