import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVehicleControlListDto } from './create-vehicle-control-list.dto.js';
import { UpdateVehicleControlListDto } from './update-vehicle-control-list.dto.js';
import {
  PLATE_CHARS_MESSAGE,
  PLATE_FORMAT_MESSAGE,
} from '../utils/plate-format.js';

const messagesFor = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(CreateVehicleControlListDto, {
    list_type: 'blocklist',
    ...body,
  });
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors };
};

describe('CreateVehicleControlListDto (BUG-004)', () => {
  it('biển hợp lệ + loại xe viết hoa → 0 lỗi, chuẩn hóa vehicle_type', async () => {
    const { dto, errors } = await messagesFor({
      plate_raw: ' 30F-256.58 ',
      vehicle_type: 'CAR',
    });
    expect(errors).toHaveLength(0);
    expect(dto.plateRaw).toBe('30F-256.58');
    expect(dto.vehicleType).toBe('car');
  });

  it('không gửi vehicle_type hoặc gửi rỗng → hợp lệ (không xác định)', async () => {
    expect((await messagesFor({ plate_raw: '29A-1234' })).errors).toHaveLength(
      0,
    );
    const { dto, errors } = await messagesFor({
      plate_raw: '29A-1234',
      vehicle_type: '',
    });
    expect(errors).toHaveLength(0);
    expect(dto.vehicleType).toBeNull();
  });

  it('"<b>@@##</b>" → lỗi ký tự trên plateRaw', async () => {
    const { errors } = await messagesFor({ plate_raw: '<b>@@##</b>' });
    const plate = errors.find((e) => e.property === 'plateRaw');
    expect(Object.values(plate?.constraints ?? {})).toEqual([
      PLATE_CHARS_MESSAGE,
    ]);
  });

  it('"1" → lỗi định dạng trên plateRaw', async () => {
    const { errors } = await messagesFor({ plate_raw: '1' });
    const plate = errors.find((e) => e.property === 'plateRaw');
    expect(Object.values(plate?.constraints ?? {})).toContain(
      PLATE_FORMAT_MESSAGE,
    );
  });

  it('vehicle_type ngoài danh sách → lỗi', async () => {
    const { errors } = await messagesFor({
      plate_raw: '30F-256.58',
      vehicle_type: 'spaceship',
    });
    expect(errors.map((e) => e.property)).toContain('vehicleType');
  });

  it('loại xe không ảnh hưởng kiểm tra biển (biển quân đội + xe máy vẫn hợp lệ)', async () => {
    const { errors } = await messagesFor({
      plate_raw: 'TM-12-34',
      vehicle_type: 'motorbike',
    });
    expect(errors).toHaveLength(0);
  });
});

describe('UpdateVehicleControlListDto (BUG-004)', () => {
  it('vehicle_type null → hợp lệ (xóa loại xe); giá trị lạ → lỗi', async () => {
    const ok = plainToInstance(UpdateVehicleControlListDto, {
      vehicle_type: null,
    });
    expect(await validate(ok)).toHaveLength(0);
    expect(ok.vehicleType).toBeNull();
    const bad = plainToInstance(UpdateVehicleControlListDto, {
      vehicle_type: 'x',
    });
    expect((await validate(bad)).map((e) => e.property)).toContain(
      'vehicleType',
    );
  });
});
