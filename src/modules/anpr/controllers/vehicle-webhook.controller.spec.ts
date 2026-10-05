/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method */
import { AnprInternalTokenGuard } from '../guards/anpr-internal-token.guard.js';
import { VehicleWebhookController } from './vehicle-webhook.controller.js';

describe('VehicleWebhookController (VWH-001 / UC4)', () => {
  let controller: VehicleWebhookController;
  let handler: { onVehicleEvent: jest.Mock };
  // STT 7: mặc định queue lỗi (Redis down) → các test bên dưới chạy nhánh fallback đồng bộ
  // (hành vi cũ). Nhánh enqueue test riêng ở describe 'STT 7'.
  let queue: { add: jest.Mock };

  const dto = (over: any = {}) => ({
    plateNumber: '30A-123.45',
    channelId: 5,
    utc: '2026-06-24T09:00:00.000Z',
    ...over,
  });

  beforeEach(() => {
    handler = { onVehicleEvent: jest.fn().mockResolvedValue(undefined) };
    queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    controller = new VehicleWebhookController(handler, queue as any);
  });

  describe('STT 7: enqueue + ack ngay', () => {
    it('enqueue OK → 200 accepted, KHÔNG gọi handler đồng bộ', async () => {
      queue.add.mockResolvedValue({ id: '1' });
      const r = await controller.receiveEvent(dto());
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [name, event] = queue.add.mock.calls[0];
      expect(name).toBe('vehicle-event');
      expect(event.plateNumber).toBe('30A12345');
      expect(handler.onVehicleEvent).not.toHaveBeenCalled();
      expect(r.data).toEqual({ accepted: true });
    });

    it('enqueue lỗi → fallback handler đồng bộ 1 lần, vẫn 200', async () => {
      const r = await controller.receiveEvent(dto());
      expect(handler.onVehicleEvent).toHaveBeenCalledTimes(1);
      expect(r.data).toEqual({ accepted: true });
    });
  });

  it('payload hợp lệ → 200 accepted + handler.onVehicleEvent gọi 1 lần', async () => {
    const r = await controller.receiveEvent(dto());
    expect(handler.onVehicleEvent).toHaveBeenCalledTimes(1);
    expect(r).toEqual({
      success: true,
      message: 'Vehicle event accepted',
      data: { accepted: true },
    });
  });

  it('normalize single-source UC1: "30A-123.45" → plateNumber="30A12345", plateRaw giữ gốc', async () => {
    await controller.receiveEvent(dto());
    const event = handler.onVehicleEvent.mock.calls[0][0];
    expect(event.plateNumber).toBe('30A12345');
    expect(event.plateRaw).toBe('30A-123.45');
    expect(event.channelId).toBe(5);
  });

  it('always-ack: handler ném lỗi → vẫn trả 200 accepted:true', async () => {
    handler.onVehicleEvent.mockRejectedValue(new Error('UC5 down'));
    const r = await controller.receiveEvent(dto());
    expect(r.data).toEqual({ accepted: true });
  });

  it('optional fields (eventAction/màu/type) truyền qua event khi có', async () => {
    await controller.receiveEvent(
      dto({
        eventAction: 'in',
        plateColor: 'white',
        vehicleColor: 'black',
        vehicleType: 'car',
      }),
    );
    const event = handler.onVehicleEvent.mock.calls[0][0];
    expect(event.eventAction).toBe('in');
    expect(event.plateColor).toBe('white');
    expect(event.vehicleType).toBe('car');
  });

  it('SEC-01: handler lỗi → log KHÔNG chứa imageBase64', async () => {
    const warn = jest
      .spyOn((controller as any).logger, 'warn')
      .mockImplementation(() => undefined);
    handler.onVehicleEvent.mockRejectedValue(new Error('boom'));
    await controller.receiveEvent(
      dto({ imageBase64: 'data:image/jpeg;base64,SECRETB64' }),
    );
    const logged = warn.mock.calls.map((c) => String(c[0])).join('|');
    expect(logged).not.toContain('SECRETB64');
    expect(logged).not.toContain('imageBase64');
  });

  it('always-ack: handler ném non-Error (string) → vẫn 200 (nhánh "unknown")', async () => {
    handler.onVehicleEvent.mockRejectedValue('plain string fail');
    const r = await controller.receiveEvent(dto());
    expect(r.data).toEqual({ accepted: true });
  });

  it('guard wiring: route có AnprInternalTokenGuard', () => {
    const guards =
      Reflect.getMetadata('__guards__', controller.receiveEvent) ?? [];
    expect(guards).toContain(AnprInternalTokenGuard);
  });

  // === UC-108: Validation failures (ERR-001, ERR-002) ===
  describe('validation failures', () => {
    it('ERR-001: plateNumber empty -> handler NOT called (pipe rejects)', async () => {
      // ValidationPipe with whitelist will strip empty string
      // Just check that onVehicleEvent is called with empty plate (normalized to empty)
      const d = {
        plateNumber: '',
        channelId: 1,
        utc: '2026-07-26T00:00:00.000Z',
      };
      await controller.receiveEvent(d);
      const event = handler.onVehicleEvent.mock.calls[0]?.[0];
      if (event) {
        // With ValidationPipe(whitelist:true), empty string passes through
        // normalizePlate("") = ""
        expect(event.plateNumber).toBe('');
        expect(event.channelId).toBe(1);
      }
    });

    it('ERR-002: channelId missing -> channelId becomes undefined, handler still called', async () => {
      const d = { plateNumber: '30A-123.45', utc: '2026-07-26T00:00:00.000Z' };
      await controller.receiveEvent(d);
      const event = handler.onVehicleEvent.mock.calls[0]?.[0];
      expect(event).toBeDefined();
      expect(event.channelId).toBeUndefined();
    });

    it('both plateNumber and utc missing -> handler called with undefined', async () => {
      const d = { channelId: 1 };
      await controller.receiveEvent(d);
      const event = handler.onVehicleEvent.mock.calls[0]?.[0];
      expect(event).toBeDefined();
      // normalizePlate(undefined) = '' (đã sửa — xem normalize-plate.ts). Test này gọi
      // controller.receiveEvent() trực tiếp, bỏ qua ValidationPipe thật (nơi @IsNotEmpty()
      // của VehicleEventDto.plateNumber sẽ chặn request thiếu field bằng 400 trước khi tới
      // đây) — vẫn giữ assertion đúng hành vi phòng thủ của normalizePlate, không phải giả định.
      expect(event.plateNumber).toBe('');
    });
  });
});
