import { DataSource } from 'typeorm';
import { VisitorConfigService, VISITOR_CONFIG_DEFAULTS } from './visitor-config.service.js';

const make = (rows: unknown[] | Error) => {
  const query = jest.fn(async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  });
  return { svc: new VisitorConfigService({ query } as unknown as DataSource), query };
};

describe('VisitorConfigService', () => {
  it('không có dòng cấu hình → 11 giá trị mặc định', async () => {
    const { svc } = make([]);
    const cfg = await svc.get();
    expect(cfg).toEqual(VISITOR_CONFIG_DEFAULTS);
    expect(Object.keys(cfg)).toHaveLength(11);
    expect(cfg.faceMatchThreshold).toBe(0.8);
    expect(cfg.accessBufferMinutes).toBe(30);
    expect(cfg.maxVisitDays).toBe(7);
    expect(cfg.overstayEscalateMinutes).toBe(30);
    expect(cfg.approverMode).toBe('host_or_manager');
    expect(cfg.photoRetentionDays).toBe(30);
    expect(cfg.purposes).toHaveLength(8);
    expect(cfg.publicHostSearchEnabled).toBe(true);
    expect(cfg.publicRateLimit.register).toEqual([5, 600]);
  });

  it('ghi đè một khóa, các khóa khác vẫn mặc định', async () => {
    const { svc } = make([{ config_key: 'visitor.face_match_threshold', config_value: '0.9', config_json: null }]);
    const cfg = await svc.get();
    expect(cfg.faceMatchThreshold).toBe(0.9);
    expect(cfg.accessBufferMinutes).toBe(30);
  });

  it('đọc được giá trị JSON và boolean', async () => {
    const { svc } = make([
      { config_key: 'visitor.purposes', config_value: null, config_json: ['A', 'B'] },
      { config_key: 'visitor.notify_host_email', config_value: 'false', config_json: null },
      { config_key: 'visitor.public_rate_limit', config_value: null, config_json: { register: [2, 60], lookup: [3, 60], hosts: [4, 60] } },
    ]);
    const cfg = await svc.get();
    expect(cfg.purposes).toEqual(['A', 'B']);
    expect(cfg.notifyHostEmail).toBe(false);
    expect(cfg.publicRateLimit.register).toEqual([2, 60]);
  });

  it('sai kiểu thì dùng mặc định, không ném', async () => {
    const { svc } = make([
      { config_key: 'visitor.face_match_threshold', config_value: 'abc', config_json: null },
      { config_key: 'visitor.approver_mode', config_value: 'bậy', config_json: null },
      { config_key: 'visitor.max_visit_days', config_value: '-3', config_json: null },
    ]);
    const cfg = await svc.get();
    expect(cfg.faceMatchThreshold).toBe(0.8);
    expect(cfg.approverMode).toBe('host_or_manager');
    expect(cfg.maxVisitDays).toBe(7);
  });

  it('lỗi DB → mặc định, không ném', async () => {
    const { svc } = make(new Error('db down'));
    await expect(svc.get()).resolves.toEqual(VISITOR_CONFIG_DEFAULTS);
  });

  it('nhớ đệm 30 giây', async () => {
    const { svc, query } = make([]);
    await svc.get();
    await svc.get();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
