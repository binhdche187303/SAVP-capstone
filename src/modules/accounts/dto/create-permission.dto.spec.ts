import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePermissionDto } from './create-permission.dto.js';

describe('CreatePermissionDto Validation', () => {
  const validDto = {
    permissionCode: 'meetings.create',
    permissionName: 'Create Meeting',
    moduleCode: 'meetings',
    actionCode: 'create',
  };

  describe('permissionCode', () => {
    it('should accept valid dot-format codes', async () => {
      const validCodes = [
        'meetings.create',
        'rooms.read',
        'admin.manage_permissions',
        'attendance.check_in',
        'a.b',
      ];
      for (const code of validCodes) {
        const dto = plainToInstance(CreatePermissionDto, {
          ...validDto,
          permissionCode: code,
        });
        const errors = await validate(dto);
        const fieldErrors = errors.filter(
          (e) => e.property === 'permissionCode',
        );
        expect(fieldErrors.length).toBe(0);
      }
    });

    it('should reject codes without a dot', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        permissionCode: 'invalid',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'permissionCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should normalize uppercase codes before validation', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        permissionCode: 'Meetings.Create',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'permissionCode');
      expect(fieldErrors.length).toBe(0);
      expect(dto.permissionCode).toBe('meetings.create');
    });

    it('should reject codes with spaces', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        permissionCode: 'meetings. create',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'permissionCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should reject codes with colons', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        permissionCode: 'meetings:create',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'permissionCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });

    it('should accept codes with underscores', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        permissionCode: 'meetings.check_in',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'permissionCode');
      expect(fieldErrors.length).toBe(0);
    });

    it('should reject empty string', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        permissionCode: '',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'permissionCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });
  });

  describe('permissionName', () => {
    it('should accept valid name', async () => {
      const dto = plainToInstance(CreatePermissionDto, validDto);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject empty name', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        permissionName: '',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'permissionName');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });
  });

  describe('moduleCode', () => {
    it('should accept valid module codes from allowlist', async () => {
      const validModules = [
        'meetings',
        'rooms',
        'admin',
        'accounts',
        'attendance',
      ];
      for (const mod of validModules) {
        const dto = plainToInstance(CreatePermissionDto, {
          ...validDto,
          moduleCode: mod,
        });
        const errors = await validate(dto);
        const fieldErrors = errors.filter((e) => e.property === 'moduleCode');
        expect(fieldErrors.length).toBe(0);
      }
    });

    it('should reject invalid module codes', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        moduleCode: 'nonexistent',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'moduleCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });
  });

  describe('actionCode', () => {
    it('should accept valid action', async () => {
      const dto = plainToInstance(CreatePermissionDto, validDto);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject empty action', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        actionCode: '',
      });
      const errors = await validate(dto);
      const fieldErrors = errors.filter((e) => e.property === 'actionCode');
      expect(fieldErrors.length).toBeGreaterThan(0);
    });
  });

  describe('description (optional)', () => {
    it('should accept null description', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        description: null,
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept valid description', async () => {
      const dto = plainToInstance(CreatePermissionDto, {
        ...validDto,
        description: 'Test permission',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('required fields', () => {
    it('should reject missing permissionCode', async () => {
      const { permissionCode, ...rest } = validDto;
      const dto = plainToInstance(CreatePermissionDto, rest);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject missing permissionName', async () => {
      const { permissionName, ...rest } = validDto;
      const dto = plainToInstance(CreatePermissionDto, rest);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject missing moduleCode', async () => {
      const { moduleCode, ...rest } = validDto;
      const dto = plainToInstance(CreatePermissionDto, rest);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('should reject missing actionCode', async () => {
      const { actionCode, ...rest } = validDto;
      const dto = plainToInstance(CreatePermissionDto, rest);
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
});
