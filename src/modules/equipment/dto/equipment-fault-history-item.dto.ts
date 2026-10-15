export type EquipmentFaultEventType = 'reported' | 'confirmed' | 'resolved';

/** Vị trí thiết bị lúc báo hỏng (snapshot trong audit). Bản ghi cũ không có → null. */
export interface EquipmentFaultLocation {
  roomId: string;
  roomName: string;
  siteName: string | null;
  areaName: string | null;
}

/**
 * Item trong lich su bao hong / xac nhan / khac phuc cua 1 thiet bi
 * (GET /equipments/:id/fault-history). Duoc suy ra tu audit_logs — khong co
 * bang rieng, xem EquipmentService.getFaultHistory().
 */
export class EquipmentFaultHistoryItemDto {
  id: string;
  eventType: EquipmentFaultEventType;
  actorId: string | null;
  actorName: string | null;
  note: string | null;
  healthStatus: string | null;
  assetStatus: string | null;
  location: EquipmentFaultLocation | null;
  createdAt: Date;

  constructor(data: EquipmentFaultHistoryItemDto) {
    Object.assign(this, data);
  }
}
