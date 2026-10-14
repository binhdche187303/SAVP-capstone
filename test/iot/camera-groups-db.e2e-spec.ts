/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { AppDataSource } from '../../src/database/data-source';
import { CameraGroupsService } from '../../src/modules/camera-groups/services/camera-groups.service';
import { DeviceMaintenanceAlertService } from '../../src/modules/device-alert/services/device-maintenance-alert.service';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('CAMG-001 nhóm camera + cảnh báo bảo trì (DB thật)', () => {
  const tag = `CAMGTEST-${Date.now()}`;
  const groups = () => new CameraGroupsService(AppDataSource);
  const recorded: Array<Record<string, any>> = [];
  const notified: string[] = [];
  const maint = () =>
    new DeviceMaintenanceAlertService(
      AppDataSource,
      {
        recordAlert: async (a: Record<string, any>) => {
          recorded.push(a);
          const rows = await AppDataSource.query(
            `INSERT INTO security_alerts (alert_type, severity, zone_id, status, triggered_at, payload_json)
             VALUES ($1, 'medium', $2, 'new', NOW(), $3::jsonb) RETURNING id`,
            [a.alertType, a.zoneId, JSON.stringify(a.payloadJson)],
          );
          return { alert: { id: rows[0].id }, isNew: true };
        },
      } as any,
      { notifyDeviceStatus: async (_a: unknown, title: string) => void notified.push(title) } as any,
    );
  let staleCam: string, freshCam: string, onlineCam: string, zoneId: string;

  const mkDev = async (suffix: string, status: string, type = 'ip_camera') =>
    (
      await AppDataSource.query(
        `INSERT INTO iot_devices (device_code, device_name, device_type, status, zone_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [`${tag}-${suffix}`, `Cam ${suffix}`, type, status, zoneId],
      )
    )[0].id as string;
  const auditOffline = (id: string, hoursAgo: number) =>
    AppDataSource.query(
      `INSERT INTO audit_logs (action_type, entity_type, entity_id, severity, metadata_json, created_at)
       VALUES ('auto_offline','iot_devices',$1,'info','{"changed_fields":{"status":{"old":"online","new":"offline"}}}'::jsonb, NOW() - ($2::int * INTERVAL '1 hour'))`,
      [id, hoursAgo],
    );

  beforeAll(async () => {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
    zoneId = (await AppDataSource.query(`INSERT INTO zones (zone_code, zone_name, building, floor) VALUES ($1,$1,'T','1') RETURNING id`, [tag]))[0].id;
    staleCam = await mkDev('STALE', 'offline');
    freshCam = await mkDev('FRESH', 'offline');
    onlineCam = await mkDev('ON', 'online');
    await auditOffline(staleCam, 30);
    await auditOffline(freshCam, 2);
  });

  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM security_alerts WHERE alert_type='device_maintenance' AND zone_id=$1`, [zoneId]);
    await AppDataSource.query(`DELETE FROM camera_groups WHERE group_code LIKE $1`, [`${tag}%`]);
    await AppDataSource.query(`DELETE FROM audit_logs WHERE entity_type='iot_devices' AND entity_id IN (SELECT id FROM iot_devices WHERE device_code LIKE $1)`, [`${tag}%`]);
    await AppDataSource.query(`DELETE FROM iot_devices WHERE device_code LIKE $1`, [`${tag}%`]);
    await AppDataSource.query(`DELETE FROM zones WHERE id=$1`, [zoneId]);
    await AppDataSource.destroy();
  });

  it('CRUD nhóm + gán camera, chặn mã trùng và thiết bị không phải camera', async () => {
    const g = await groups().create({ groupCode: `${tag}-g1`, groupName: 'Tòa A' }, null as any);
    await expect(groups().create({ groupCode: `${tag}-G1`, groupName: 'x' }, null as any)).rejects.toMatchObject({ response: { code: 'CAMERA_GROUP_CODE_EXISTS' } });

    const mic = await mkDev('MIC', 'online', 'microphone');
    await expect(groups().addDevices(g.id, { deviceIds: [mic] })).rejects.toMatchObject({ response: { code: 'CAMERA_GROUP_INVALID_DEVICE' } });

    const withDevs = await groups().addDevices(g.id, { deviceIds: [staleCam, freshCam, onlineCam] });
    await groups().addDevices(g.id, { deviceIds: [staleCam] }); // idempotent
    expect(withDevs.device_count).toBe(3);
    expect(withDevs.offline_count).toBe(2);

    const after = await groups().removeDevice(g.id, onlineCam);
    expect(after.device_count).toBe(2);
    expect((await groups().update(g.id, { groupName: 'Tòa B' })).group_name).toBe('Tòa B');
    expect((await groups().list(tag)).map((r) => r.id)).toContain(g.id);

    await groups().remove(g.id);
    await expect(groups().get(g.id)).rejects.toMatchObject({ response: { code: 'CAMERA_GROUP_NOT_FOUND' } });
    // Xoá nhóm không xoá camera.
    expect((await AppDataSource.query(`SELECT 1 FROM iot_devices WHERE id=$1`, [staleCam])).length).toBe(1);
  });

  it('scan: chỉ camera offline quá 24h bị báo, kèm tên nhóm; online lại thì alert tự đóng', async () => {
    const g = await groups().create({ groupCode: `${tag}-g2`, groupName: 'Nhóm bảo trì' }, null as any);
    await groups().addDevices(g.id, { deviceIds: [staleCam] });

    const r = await maint().scan();
    expect(r).toMatchObject({ thresholdHours: 24, alertsRecorded: 1 });
    const mine = recorded.filter((a) => a.zoneId === zoneId);
    expect(mine).toHaveLength(1);
    expect(mine[0].alertType).toBe('device_maintenance');
    expect(mine[0].payloadJson.devices.map((d: any) => d.deviceId)).toEqual([staleCam]);
    expect(mine[0].payloadJson.devices[0].groups).toEqual(['Nhóm bảo trì']);
    expect(notified.length).toBe(1);

    await AppDataSource.query(`UPDATE iot_devices SET status='online' WHERE id=$1`, [staleCam]);
    const r2 = await maint().scan();
    expect(r2.alertsResolved).toBeGreaterThanOrEqual(1);
    const open = await AppDataSource.query(`SELECT 1 FROM security_alerts WHERE alert_type='device_maintenance' AND zone_id=$1 AND status<>'resolved'`, [zoneId]);
    expect(open).toHaveLength(0);
  });
});
