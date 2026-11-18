import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, FindOptionsWhere } from 'typeorm';
import { RoleEntity } from '../entities/role.entity.js';
import { UserRoleEntity } from '../entities/user-role.entity.js';
import { CreateRoleDto } from '../dto/create-role.dto.js';
import { UpdateRoleDto } from '../dto/update-role.dto.js';
import { RoleResponseDto } from '../dto/role-response.dto.js';
import { RoleDetailResponseDto } from '../dto/role-detail-response.dto.js';
import { ListRolesQueryDto } from '../dto/list-roles-query.dto.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';

@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(dto: CreateRoleDto, userId: string): Promise<RoleResponseDto> {
    const existing = await this.roleRepo.findOne({
      where: { roleCode: dto.roleCode },
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Role code ' + dto.roleCode + ' đã tồn tại trong hệ thống.',
        error: { code: 'ROLE_CODE_DUPLICATE' },
      });
    }

    const entity = this.roleRepo.create({
      roleCode: dto.roleCode,
      roleName: dto.roleName,
      description: dto.description ?? null,
      isActive: true,
      isSystemRole: false,
    });
    const saved = await this.roleRepo.save(entity);

    await this.auditLogsService.logAction({
      userId,
      actionType: 'CREATE_ROLE',
      entityType: 'role',
      entityId: saved.id,
      metadataJson: { roleCode: saved.roleCode },
    });

    this.logger.log('Role created: ' + saved.roleCode + ' (' + saved.id + ')');
    return this.toResponse(saved);
  }

  async findAll(
    query: ListRolesQueryDto,
  ): Promise<{ data: RoleResponseDto[]; total: number }> {
    const { page, limit, sortBy, sortOrder, isActive, search } = query;

    const where: FindOptionsWhere<RoleEntity>[] = [];

    const baseWhere: FindOptionsWhere<RoleEntity> = {};
    if (isActive !== undefined) {
      baseWhere.isActive = isActive;
    }
    if (search) {
      where.push({
        ...baseWhere,
        roleCode: ILike('%' + search + '%'),
      });
      where.push({
        ...baseWhere,
        roleName: ILike('%' + search + '%'),
      });
    } else {
      where.push(baseWhere);
    }

    const [entities, total] = await this.roleRepo.findAndCount({
      where,
      order: { [sortBy || 'createdAt']: sortOrder || 'desc' },
      skip: ((page || 1) - 1) * (limit || 20),
      take: limit || 20,
    });

    return { data: entities.map((e) => this.toResponse(e)), total };
  }

  async findOne(id: string): Promise<RoleDetailResponseDto> {
    const entity = await this.roleRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException({
        success: false,
        message: 'Vai trò không tồn tại.',
        error: { code: 'ROLE_NOT_FOUND' },
      });
    }

    const assignedUserCount = await this.userRoleRepo.count({
      where: { roleId: id, isActive: true },
    });

    return {
      ...this.toResponse(entity),
      assignedUserCount,
    };
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    userId: string,
  ): Promise<RoleResponseDto> {
    const entity = await this.roleRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException({
        success: false,
        message: 'Vai trò không tồn tại.',
        error: { code: 'ROLE_NOT_FOUND' },
      });
    }

    if (dto.isActive === false && entity.isSystemRole === true) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Không thể vô hiệu hóa vai trò hệ thống.',
        error: { code: 'CANNOT_MODIFY_SYSTEM_ROLE' },
      });
    }

    const oldValue = {
      roleName: entity.roleName,
      description: entity.description,
      isActive: entity.isActive,
    };

    if (dto.roleName !== undefined) {
      entity.roleName = dto.roleName;
    }
    if (dto.description !== undefined) {
      entity.description = dto.description;
    }
    if (dto.isActive !== undefined) {
      entity.isActive = dto.isActive;
    }

    const saved = await this.roleRepo.save(entity);

    await this.auditLogsService.logAction({
      userId,
      actionType: 'UPDATE_ROLE',
      entityType: 'role',
      entityId: saved.id,
      metadataJson: {
        oldValueJson: oldValue,
        newValueJson: {
          roleName: saved.roleName,
          description: saved.description,
          isActive: saved.isActive,
        },
      },
    });

    return this.toResponse(saved);
  }

  async remove(id: string, userId: string): Promise<void> {
    const entity = await this.roleRepo.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException({
        success: false,
        message: 'Vai trò không tồn tại.',
        error: { code: 'ROLE_NOT_FOUND' },
      });
    }

    if (entity.isSystemRole === true) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Không thể xóa vai trò hệ thống.',
        error: { code: 'CANNOT_DELETE_SYSTEM_ROLE' },
      });
    }

    const activeUserCount = await this.userRoleRepo.count({
      where: { roleId: id, isActive: true },
    });
    if (activeUserCount > 0) {
      throw new ConflictException({
        success: false,
        message: 'Không thể xóa vai trò đang được gán cho người dùng.',
        error: { code: 'ROLE_IN_USE' },
      });
    }

    entity.isActive = false;
    await this.roleRepo.save(entity);

    await this.auditLogsService.logAction({
      userId,
      actionType: 'DELETE_ROLE',
      entityType: 'role',
      entityId: entity.id,
      metadataJson: {
        oldValueJson: { isActive: true },
        newValueJson: { isActive: false },
      },
    });
  }

  private toResponse(entity: RoleEntity): RoleResponseDto {
    return {
      id: entity.id,
      roleCode: entity.roleCode,
      roleName: entity.roleName,
      description: entity.description,
      isSystemRole: entity.isSystemRole,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
