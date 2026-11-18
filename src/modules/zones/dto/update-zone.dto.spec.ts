import { ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateZoneDto } from './update-zone.dto.js';

const validateBody = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateZoneDto, body);
  return validate(dto);
};

const propertiesOf = (errors: Awaited<ReturnType<typeof validate>>) =>
  errors.map((e) => e.property);

describe('UpdateZoneDto (ZNU-001 / UC-91)', () => {
  it('body rỗng → 0 lỗi (mọi field optional)', async () => {
    expect(await validateBody({})).toHaveLength(0);
  });

  it('body hợp lệ đầy đủ → 0 lỗi', async () => {
    const errors = await validateBody({
      zone_code: 'GATE-02',
      zone_name: 'Cổng phụ',
      zone_type: 'gate',
      status: 'inactive',
      building: 'A',
      floor: 'B1',
      description: 'Cổng phía Tây',
      metadata_json: { lane: 1 },
    });
    expect(errors).toHaveLength(0);
  });

  // CRUX: 4 field KHÔNG nhận null — @ValidateIf phải bắt được (nếu dùng @IsOptional sẽ lọt).
  it('null cho 4 field KHÔNG-nullable → CÓ lỗi validate', async () => {
    expect(propertiesOf(await validateBody({ zone_code: null }))).toContain(
      'zoneCode',
    );
    expect(propertiesOf(await validateBody({ zone_name: null }))).toContain(
      'zoneName',
    );
    expect(propertiesOf(await validateBody({ zone_type: null }))).toContain(
      'zoneType',
    );
    expect(propertiesOf(await validateBody({ status: null }))).toContain(
      'status',
    );
  });

  it('null cho 4 field nullable (xóa giá trị) → 0 lỗi', async () => {
    expect(await validateBody({ building: null })).toHaveLength(0);
    expect(await validateBody({ floor: null })).toHaveLength(0);
    expect(await validateBody({ description: null })).toHaveLength(0);
    expect(await validateBody({ metadata_json: null })).toHaveLength(0);
  });

  it('giá trị ngoài danh sách → lỗi isIn', async () => {
    expect(
      (await validateBody({ zone_type: 'garden' })).find(
        (e) => e.property === 'zoneType',
      )?.constraints,
    ).toHaveProperty('isIn');

    // status chỉ chấp nhận active | inactive (KHÔNG phải disabled như vehicle_registrations).
    expect(
      (await validateBody({ status: 'disabled' })).find(
        (e) => e.property === 'status',
      )?.constraints,
    ).toHaveProperty('isIn');
  });

  it('5 zone_type + 2 status hợp lệ đều pass', async () => {
    for (const zone_type of ['room', 'gate', 'corridor', 'lobby', 'parking']) {
      expect(await validateBody({ zone_type })).toHaveLength(0);
    }
    for (const status of ['active', 'inactive']) {
      expect(await validateBody({ status })).toHaveLength(0);
    }
  });

  it('vượt MaxLength → lỗi maxLength (80/150/100/30/255)', async () => {
    const cases: Array<[string, string, number]> = [
      ['zone_code', 'zoneCode', 81],
      ['zone_name', 'zoneName', 151],
      ['building', 'building', 101],
      ['floor', 'floor', 31],
      ['description', 'description', 256],
    ];
    for (const [apiField, property, len] of cases) {
      const errors = await validateBody({ [apiField]: 'A'.repeat(len) });
      expect(
        errors.find((e) => e.property === property)?.constraints,
      ).toHaveProperty('maxLength');
    }
  });

  it('chuỗi rỗng cho zone_code / zone_name → lỗi isNotEmpty', async () => {
    expect(
      (await validateBody({ zone_code: '' })).find(
        (e) => e.property === 'zoneCode',
      )?.constraints,
    ).toHaveProperty('isNotEmpty');
    expect(
      (await validateBody({ zone_name: '' })).find(
        (e) => e.property === 'zoneName',
      )?.constraints,
    ).toHaveProperty('isNotEmpty');
  });

  // `whitelist` là option của ValidationPipe, KHÔNG phải của plainToInstance.
  it('ValidationPipe whitelist loại field lạ (id/created_at/deleted_at)', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const result = (await pipe.transform(
      {
        zone_name: 'Cổng chính',
        id: '00000000-0000-0000-0000-000000000000',
        created_at: '2026-07-22T00:00:00.000Z',
        deleted_at: '2026-07-22T00:00:00.000Z',
      },
      { type: 'body', metatype: UpdateZoneDto },
    )) as UpdateZoneDto & Record<string, unknown>;

    expect(result).toBeInstanceOf(UpdateZoneDto);
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('created_at');
    expect(result).not.toHaveProperty('deleted_at');
    expect(result.zoneName).toBe('Cổng chính');
  });
});
