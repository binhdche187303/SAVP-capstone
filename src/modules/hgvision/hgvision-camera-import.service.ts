import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HgvisionCameraService } from './hgvision-camera.service.js';
import {
  ImportHgCameraRowDto,
  ImportHgCamerasDto,
} from './dto/import-hg-cameras.dto.js';

/** Khu vực theo bản vẽ Final KTL — tiền tố mã camera (cột "Tên kí hiệu") → zone. */
export interface ImportZoneDef {
  code: string;
  name: string;
  type: 'corridor' | 'lobby' | 'gate';
  building: string | null;
  floor: string | null;
}

const ZONE_BY_PREFIX: Array<[RegExp, ImportZoneDef]> = [
  [
    /^G-\d+$/i,
    {
      code: 'A1_G',
      name: 'Khối A1 – Tầng trệt',
      type: 'corridor',
      building: 'A1',
      floor: 'G',
    },
  ],
  [
    /^T1-\d+$/i,
    {
      code: 'A1_L1',
      name: 'Khối A1 – Lầu 1',
      type: 'corridor',
      building: 'A1',
      floor: '1',
    },
  ],
  [
    /^T2-\d+$/i,
    {
      code: 'A1_L2',
      name: 'Khối A1 – Lầu 2',
      type: 'corridor',
      building: 'A1',
      floor: '2',
    },
  ],
  [
    /^HT-\d+$/i,
    {
      code: 'A2_L1',
      name: 'Hội trường – Lầu 1',
      type: 'lobby',
      building: 'A2',
      floor: '1',
    },
  ],
  [
    /^B1-\d+$/i,
    {
      code: 'B1_G',
      name: 'Khối B1 – Tầng trệt',
      type: 'corridor',
      building: 'B1',
      floor: 'G',
    },
  ],
  [
    /^Gate1-\d+$/i,
    {
      code: 'GATE_1',
      name: 'Cổng 1',
      type: 'gate',
      building: null,
      floor: null,
    },
  ],
  [
    /^Gate2-\d+$/i,
    {
      code: 'GATE_2',
      name: 'Cổng 2',
      type: 'gate',
      building: null,
      floor: null,
    },
  ],
  [
    /^Gate2A-\d+$/i,
    {
      code: 'GATE_2A',
      name: 'Cổng 2A',
      type: 'gate',
      building: null,
      floor: null,
    },
  ],
  [
    /^Gate3-\d+$/i,
    {
      code: 'GATE_3',
      name: 'Cổng 3',
      type: 'gate',
      building: null,
      floor: null,
    },
  ],
];

export const zoneForCode = (code: string): ImportZoneDef | null =>
  ZONE_BY_PREFIX.find(([re]) => re.test(code.trim()))?.[1] ?? null;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export interface ImportRowResult {
  row: number;
  code: string;
  ip: string | null;
  zone: string | null;
  action: 'create' | 'update' | 'error';
  hg: 'created' | 'exists' | 'skipped' | 'failed' | null;
  message?: string;
}

/**
 * Import camera từ file Excel bản vẽ Final (CameraAI.xlsx):
 *  - Mỗi dòng → thiết bị SAVP (device_code = mã camera), gán khu vực theo tiền tố mã.
 *  - Trùng mã hoặc IP → cập nhật thiết bị đó (không tạo trùng).
 *  - pushToHg → thêm camera sang HGVision qua ONVIF nếu bên đó chưa có tên này.
 *  - Mật khẩu camera chỉ chuyển sang HGVision, KHÔNG lưu ở SAVP.
 * Lỗi 1 dòng không chặn các dòng khác.
 */
@Injectable()
export class HgvisionCameraImportService {
  private readonly logger = new Logger(HgvisionCameraImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly cameras: HgvisionCameraService,
  ) {}

  async import(dto: ImportHgCamerasDto): Promise<{
    dryRun: boolean;
    summary: Record<string, number>;
    rows: ImportRowResult[];
  }> {
    const dryRun = dto.dryRun ?? true;
    const pushToHg = dto.pushToHg ?? false;
    const seen = new Set<string>();
    let hgNames: Set<string> | null = null;
    if (pushToHg && !dryRun) {
      try {
        hgNames = new Set(
          (await this.cameras.listCameras()).map((c) => c.name.toLowerCase()),
        );
      } catch (e) {
        this.logger.warn(
          `Không đọc được danh sách camera HGVision: ${(e as Error).message}`,
        );
      }
    }

    const results: ImportRowResult[] = [];
    for (const [i, r] of dto.rows.entries()) {
      results.push(
        await this.importRow(i + 1, r, seen, dryRun, pushToHg, hgNames),
      );
    }
    const count = (k: keyof ImportRowResult, v: string) =>
      results.filter((x) => x[k] === v).length;
    return {
      dryRun,
      summary: {
        total: results.length,
        create: count('action', 'create'),
        update: count('action', 'update'),
        error: count('action', 'error'),
        hgCreated: count('hg', 'created'),
        hgFailed: count('hg', 'failed'),
      },
      rows: results,
    };
  }

  private async importRow(
    rowNo: number,
    r: ImportHgCameraRowDto,
    seen: Set<string>,
    dryRun: boolean,
    pushToHg: boolean,
    hgNames: Set<string> | null,
  ): Promise<ImportRowResult> {
    const code = (r.code ?? '').trim();
    const ip = (r.ip ?? '').trim() || null;
    const zone = zoneForCode(code);
    const base = { row: rowNo, code, ip, zone: zone?.name ?? null, hg: null };
    const fail = (message: string): ImportRowResult => ({
      ...base,
      action: 'error',
      message,
    });

    if (!zone)
      return fail('Mã không thuộc khu vực nào (G-, T1-, T2-, HT-, B1-, Gate…)');
    if (
      !ip ||
      !IPV4.exec(ip)
        ?.slice(1)
        .every((n) => Number(n) <= 255)
    )
      return fail('IP không hợp lệ');
    const key = code.toLowerCase();
    if (seen.has(key) || seen.has(ip))
      return fail('Trùng mã hoặc IP trong file');
    seen.add(key);
    seen.add(ip);

    const existing: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM iot_devices
        WHERE lower(device_code) = $1 OR ip_address = $2
        ORDER BY (lower(device_code) = $1) DESC LIMIT 1`,
      [key, ip],
    );
    const action = existing[0] ? 'update' : 'create';
    if (dryRun) return { ...base, action };

    try {
      const zoneId = await this.ensureZone(zone);
      const isGate = zone.type === 'gate';
      const meta = {
        source: 'hgvision',
        camera_name: code,
        model: r.model?.trim() || null,
        serial: r.serial?.trim() || null,
        cabinet: r.cabinet?.trim() || null,
        drawing_no: r.drawingNo?.trim() || null,
      };
      if (existing[0]) {
        await this.dataSource.query(
          `UPDATE iot_devices
              SET device_code = $2, ip_address = $3, zone_id = $4,
                  metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $5::jsonb,
                  updated_at = now()
            WHERE id = $1`,
          [existing[0].id, code, ip, zoneId, JSON.stringify(meta)],
        );
      } else {
        await this.dataSource.query(
          `INSERT INTO iot_devices (device_code, device_name, device_type, zone_id, ip_address, status, metadata_json)
           VALUES ($1, $2, $3, $4, $5, 'offline', $6::jsonb)`,
          [
            code,
            `${code} ${zone.name}`,
            isGate ? 'door_camera' : 'ip_camera',
            zoneId,
            ip,
            JSON.stringify(meta),
          ],
        );
      }
    } catch (e) {
      return fail(`Lỗi lưu thiết bị: ${(e as Error).message}`);
    }

    if (!pushToHg) return { ...base, action, hg: 'skipped' };
    if (hgNames?.has(key)) return { ...base, action, hg: 'exists' };
    if (!r.username?.trim() || !r.password)
      return {
        ...base,
        action,
        hg: 'failed',
        message: 'Thiếu tài khoản camera để thêm sang HGVision',
      };
    try {
      await this.cameras.createCamera({
        name: code,
        protocol: 'ONVIF',
        ip,
        port: '80',
        username: r.username.trim(),
        password: r.password,
        forceH264: true,
        group: zone.name,
        usingAi: true,
      });
      hgNames?.add(key);
      return { ...base, action, hg: 'created' };
    } catch (e) {
      return {
        ...base,
        action,
        hg: 'failed',
        message: `HGVision: ${(e as Error).message}`,
      };
    }
  }

  private async ensureZone(z: ImportZoneDef): Promise<string> {
    const found: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM zones WHERE zone_code = $1 AND deleted_at IS NULL LIMIT 1`,
      [z.code],
    );
    if (found[0]) return found[0].id;
    const ins: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO zones (zone_code, zone_name, zone_type, building, floor, description)
       VALUES ($1, $2, $3, $4, $5, 'Theo bản vẽ vị trí camera KTL Final') RETURNING id`,
      [z.code, z.name, z.type, z.building, z.floor],
    );
    return ins[0].id;
  }
}
