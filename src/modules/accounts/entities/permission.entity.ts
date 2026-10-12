import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';

@Index('UQ_permissions_permission_code', ['permissionCode'], { unique: true })
@Entity('permissions')
export class PermissionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'permission_code', type: 'varchar', length: 120 })
  permissionCode: string;

  @Column({ name: 'permission_name', type: 'varchar', length: 150 })
  permissionName: string;

  @Column({ name: 'module_code', type: 'varchar', length: 80 })
  moduleCode: string;

  @Column({ name: 'action_code', type: 'varchar', length: 80 })
  actionCode: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
