import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RoomEntity } from '../../../modules/rooms/entities/room.entity.js';
import { EquipmentEntity } from '../../../modules/equipment/entities/equipment.entity.js';

export enum IoTDeviceType {
  IP_CAMERA = 'ip_camera',
  DOOR_CAMERA = 'door_camera',
  ROOM_CAMERA = 'room_camera',
  ANPR_CAMERA = 'anpr_camera',
  FACE_SERVER = 'face_server',
  MICROPHONE = 'microphone',
  CAPTURE_AGENT = 'capture_agent',
  OCCUPANCY_SENSOR = 'occupancy_sensor',
  DISPLAY = 'display',
}

export enum IoTDeviceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  DISABLED = 'disabled',
  MAINTENANCE = 'maintenance',
}

export enum IoTDeviceHealthStatus {
  HEALTHY = 'healthy',
  WARNING = 'warning',
  FAULTY = 'faulty',
  UNKNOWN = 'unknown',
}

@Entity('iot_devices')
export class IoTDeviceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'device_code', type: 'varchar', length: 80 })
  deviceCode: string;

  @Column({ name: 'device_name', type: 'varchar', length: 150 })
  deviceName: string;

  @Column({ name: 'device_type', type: 'varchar', length: 50 })
  deviceType: IoTDeviceType;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  /**
   * SAVP Zone scope (migration 20260721000002) — zone chứa thiết bị.
   * Song song với `room_id`, KHÔNG thay thế. Cột-only (không khai @ManyToOne)
   * để tránh circular import giữa module `iot` và module `zones`.
   */
  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ name: 'equipment_id', type: 'uuid', nullable: true })
  equipmentId: string | null;

  @Column({
    name: 'network_identifier',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  networkIdentifier: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 100, nullable: true })
  ipAddress: string | null;

  @Column({ name: 'mac_address', type: 'varchar', length: 100, nullable: true })
  macAddress: string | null;

  @Column({ name: 'stream_url', type: 'text', nullable: true })
  streamUrl: string | null;

  @Column({ name: 'mqtt_topic', type: 'varchar', length: 255, nullable: true })
  mqttTopic: string | null;

  @Column({
    name: 'agent_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  agentVersion: string | null;

  @Column({
    name: 'firmware_version',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  firmwareVersion: string | null;

  @Column({ type: 'varchar', length: 30, default: IoTDeviceStatus.OFFLINE })
  status: IoTDeviceStatus;

  @Column({
    name: 'health_status',
    type: 'varchar',
    length: 30,
    default: IoTDeviceHealthStatus.UNKNOWN,
  })
  healthStatus: IoTDeviceHealthStatus;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => RoomEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'room_id' })
  room: RoomEntity | null;

  @ManyToOne(() => EquipmentEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'equipment_id' })
  equipment: EquipmentEntity | null;
}
