import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { HgvisionClient, HgvisionHistoryObject } from './hgvision.client';
import { HgvisionPollerService } from './hgvision-poller.service';

describe('HgvisionPollerService', () => {
  const face = (id: string, camera = 'Phong C401'): HgvisionHistoryObject => ({
    object_id: id,
    camera_id: camera,
    face_ident_text: 'EMP001',
    face_image_path: 'FACE_IMAGE/x.jpg',
    first_timestamp: Math.floor(Date.now() / 1000) - 5,
    confidence: 0.9,
  });

  let searchHistory: jest.Mock;
  let onFaceEvent: jest.Mock;
  let provider: string;
  let service: HgvisionPollerService;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    searchHistory = jest.fn();
    onFaceEvent = jest.fn().mockResolvedValue(undefined);
    provider = 'hgvision';
    const config = {
      get: jest.fn((key: string, def?: unknown) =>
        key === 'CAMERA_PROVIDER' ? provider : def,
      ),
    } as unknown as ConfigService;
    const dataSource = {
      manager: {
        query: jest
          .fn()
          .mockResolvedValue([{ config_json: { 'Phong C401': 3 } }]),
      },
    } as unknown as DataSource;
    service = new HgvisionPollerService(
      { searchHistory } as unknown as HgvisionClient,
      { onFaceEvent },
      dataSource,
      config,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('CAMERA_PROVIDER=ivss → không bật poller', () => {
    provider = 'ivss';
    service.onModuleInit();
    jest.advanceTimersByTime(60_000);
    expect(searchHistory).not.toHaveBeenCalled();
  });

  it('đẩy sự kiện đã ánh xạ vào handler, bỏ camera chưa ánh xạ', async () => {
    searchHistory.mockResolvedValue({
      total: 2,
      page: 1,
      page_size: 100,
      data: [face('a'), face('b', 'Cong sau')],
    });

    service.onModuleInit();
    await service.tick();

    expect(searchHistory).toHaveBeenCalledWith(
      expect.objectContaining({ hasFace: true, page: 1 }),
    );
    expect(onFaceEvent).toHaveBeenCalledTimes(1);
    expect(onFaceEvent).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 3, personUid: 'EMP001' }),
    );
  });

  it('không xử lý lại object_id đã thấy ở lượt poll trước (cửa sổ overlap)', async () => {
    const res = { total: 1, page: 1, page_size: 100, data: [face('a')] };
    searchHistory.mockResolvedValue(res);

    service.onModuleInit();
    await service.tick();
    await service.tick();

    expect(onFaceEvent).toHaveBeenCalledTimes(1);
  });

  it('phân trang tới hết total', async () => {
    const full = Array.from({ length: 100 }, (_, i) => face(`p1-${i}`));
    searchHistory
      .mockResolvedValueOnce({
        total: 101,
        page: 1,
        page_size: 100,
        data: full,
      })
      .mockResolvedValueOnce({
        total: 101,
        page: 2,
        page_size: 100,
        data: [face('p2')],
      });

    service.onModuleInit();
    await service.tick();

    expect(searchHistory).toHaveBeenCalledTimes(2);
    expect(onFaceEvent).toHaveBeenCalledTimes(101);
  });

  it('server tự giới hạn page_size nhỏ hơn yêu cầu → vẫn lấy đủ', async () => {
    searchHistory
      .mockResolvedValueOnce({
        total: 3,
        page: 1,
        page_size: 2,
        data: [face('s1'), face('s2')],
      })
      .mockResolvedValueOnce({
        total: 3,
        page: 2,
        page_size: 2,
        data: [face('s3')],
      });

    service.onModuleInit();
    await service.tick();

    expect(searchHistory).toHaveBeenCalledTimes(2);
    expect(onFaceEvent).toHaveBeenCalledTimes(3);
  });

  it('HGVision lỗi / handler lỗi → không ném ra ngoài', async () => {
    searchHistory.mockRejectedValueOnce(new Error('down'));
    service.onModuleInit();
    await expect(service.tick()).resolves.toBeUndefined();

    searchHistory.mockResolvedValueOnce({
      total: 1,
      page: 1,
      page_size: 100,
      data: [face('z')],
    });
    onFaceEvent.mockRejectedValueOnce(new Error('db'));
    await expect(service.tick()).resolves.toBeUndefined();
  });
});
