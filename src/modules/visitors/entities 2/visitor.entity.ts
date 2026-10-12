import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('visitors')
export class VisitorEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'full_name', type: 'varchar', length: 150 }) fullName: string;
  @Column({ name: 'id_number', type: 'varchar', length: 30, nullable: true }) idNumber: string | null;
  @Column({ name: 'phone_number', type: 'varchar', length: 20 }) phoneNumber: string;
  @Column({ type: 'varchar', length: 255, nullable: true }) email: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) organization: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true }) deletedAt: Date | null;
}
