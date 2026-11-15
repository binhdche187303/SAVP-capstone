import { IsDepartmentCodeUniqueConstraint } from '../validators/is-department-code-unique.validator.js';
import { IsDepartmentNameUniqueConstraint } from '../validators/is-department-name-unique.validator.js';

beforeEach(() => {
  jest.spyOn(IsDepartmentCodeUniqueConstraint.prototype, 'validate').mockResolvedValue(true);
  jest.spyOn(IsDepartmentNameUniqueConstraint.prototype, 'validate').mockResolvedValue(true);
});
afterEach(() => jest.restoreAllMocks());

﻿import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateDepartmentDto } from './create-department.dto.js';

describe('CreateDepartmentDto Validation', () => {
  describe('departmentCode', () => {
    it('should accept valid codes', async () => {
      const validCodes = [
        'IT',
        'HR_DEPT',
        'DEV-TEAM',
        'A1',
        'FINANCE',
        'OPS2024',
      ];
      for (const code of validCodes) {
        const dto = plainToInstance(CreateDepartmentDto, {
          departmentCode: code,
          departmentName: 'Test Department',
        });
        const errors = await validate(dto);
        const codeErrors = errors.filter(
          (e) => e.property === 'departmentCode',
        );
        expect(codeErrors.length).toBe(0);
      }
    });

    it('should transform to uppercase and trim', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: ' it-dept ',
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.departmentCode).toBe('IT-DEPT');
    });

    it('should reject empty string', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: '',
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'departmentCode');
      expect(codeErrors.length).toBeGreaterThan(0);
    });

    it('should reject whitespace-only', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: '   ',
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'departmentCode');
      expect(codeErrors.length).toBeGreaterThan(0);
    });

    it('should reject code with spaces', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT DEPT',
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'departmentCode');
      expect(codeErrors.length).toBeGreaterThan(0);
    });

    it('should reject code with special characters', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'it@dept',
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'departmentCode');
      expect(codeErrors.length).toBeGreaterThan(0);
    });

    it('should reject code with Vietnamese accents', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'PHÒNG_IT',
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'departmentCode');
      expect(codeErrors.length).toBeGreaterThan(0);
    });

    it('should reject code < 2 characters', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'A',
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'departmentCode');
      expect(codeErrors.length).toBeGreaterThan(0);
    });

    it('should reject code > 50 characters', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'A' + 'B'.repeat(50),
        departmentName: 'Test',
      });
      const errors = await validate(dto);
      const codeErrors = errors.filter((e) => e.property === 'departmentCode');
      expect(codeErrors.length).toBeGreaterThan(0);
    });
  });

  describe('departmentName', () => {
    it('should accept valid Vietnamese names', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'Phòng Công nghệ thông tin',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBe(0);
    });

    it('should accept names with common separators', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'RND',
        departmentName: 'Research & Development (R&D)',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBe(0);
    });

    it('should trim whitespace', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'HR',
        departmentName: '  Phòng Nhân sự  ',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.departmentName).toBe('Phòng Nhân sự');
    });

    it('should reject empty name', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: '',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject whitespace-only name', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: '   ',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject name with emoji', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'TEST',
        departmentName: 'Test 😊 Department',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject name with HTML tags', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'TEST',
        departmentName: '<script>alert("xss")</script>',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject name < 2 characters', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'A',
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });

    it('should reject name > 150 characters', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'A'.repeat(151),
      });
      const errors = await validate(dto);
      const nameErrors = errors.filter((e) => e.property === 'departmentName');
      expect(nameErrors.length).toBeGreaterThan(0);
    });
  });

  describe('parentDepartmentId', () => {
    it('should accept valid UUID', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'IT',
        parentDepartmentId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      });
      const errors = await validate(dto);
      const parentErrors = errors.filter(
        (e) => e.property === 'parentDepartmentId',
      );
      expect(parentErrors.length).toBe(0);
    });

    it('should be optional', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'IT',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject invalid UUID', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'IT',
        parentDepartmentId: 'not-a-uuid',
      });
      const errors = await validate(dto);
      const parentErrors = errors.filter(
        (e) => e.property === 'parentDepartmentId',
      );
      expect(parentErrors.length).toBeGreaterThan(0);
    });
  });

  describe('managerUserId', () => {
    it('should accept valid UUID', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'IT',
        managerUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      });
      const errors = await validate(dto);
      const managerErrors = errors.filter(
        (e) => e.property === 'managerUserId',
      );
      expect(managerErrors.length).toBe(0);
    });

    it('should be optional', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'IT',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('description', () => {
    it('should accept valid description', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'IT',
        description: 'Phòng Công nghệ thông tin',
      });
      const errors = await validate(dto);
      const descErrors = errors.filter((e) => e.property === 'description');
      expect(descErrors.length).toBe(0);
    });

    it('should be optional', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {
        departmentCode: 'IT',
        departmentName: 'IT',
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('required fields', () => {
    it('should fail if both required fields missing', async () => {
      const dto = plainToInstance(CreateDepartmentDto, {});
      const errors = await validate(dto);
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('departmentCode');
      expect(fields).toContain('departmentName');
    });
  });
});
