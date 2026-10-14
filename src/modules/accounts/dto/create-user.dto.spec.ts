import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateUserDto } from './create-user.dto.js';

describe('CreateUserDto Validation', () => {
  it('should validate a correct DTO payload successfully', async () => {
    const payload = {
      fullName: 'Nguyen Van A',
      email: ' NVA@Company.COM ',
      departmentId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      roleIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
      employeeCode: 'EMP001',
      phoneNumber: '+84-987-654-321',
      positionTitle: 'Developer',
      directManagerId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    };

    const dto = plainToInstance(CreateUserDto, payload);
    const errors = await validate(dto);

    expect(errors.length).toBe(0);
    expect(dto.email).toBe('nva@company.com');
    expect(dto.phoneNumber).toBe('+84-987-654-321');
  });

  it('should fail validation if required fields are missing', async () => {
    const dto = plainToInstance(CreateUserDto, {});
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    const fields = errors.map((err) => err.property);
    expect(fields).toContain('fullName');
    expect(fields).toContain('email');
    expect(fields).toContain('departmentId');
    expect(fields).toContain('roleIds');
  });

  it('should fail validation if email format is invalid', async () => {
    const payload = {
      fullName: 'Nguyen Van A',
      email: 'invalid-email',
      departmentId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      roleIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
    };

    const dto = plainToInstance(CreateUserDto, payload);
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('email');
  });

  it('should fail validation if phone number contains invalid characters', async () => {
    const payload = {
      fullName: 'Nguyen Van A',
      email: 'nva@company.com',
      departmentId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      roleIds: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
      phoneNumber: 'invalid-phone-123!@#',
    };

    const dto = plainToInstance(CreateUserDto, payload);
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('phoneNumber');
  });

  it('should fail validation if roleIds contains invalid UUIDs', async () => {
    const payload = {
      fullName: 'Nguyen Van A',
      email: 'nva@company.com',
      departmentId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      roleIds: ['invalid-uuid'],
    };

    const dto = plainToInstance(CreateUserDto, payload);
    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('roleIds');
  });

  it('should accept a student account with an administrative class and no department', async () => {
    const dto = plainToInstance(CreateUserDto, {
      fullName: 'Le Minh Sinh',
      email: 'student@example.com',
      accountType: 'student',
      administrativeClass: 'DHTH2026',
      roleIds: ['b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('should require a class for a student account', async () => {
    const dto = plainToInstance(CreateUserDto, {
      fullName: 'Le Minh Sinh',
      email: 'student@example.com',
      accountType: 'student',
      roleIds: ['b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'],
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain(
      'administrativeClass',
    );
    expect(errors.map((error) => error.property)).not.toContain('departmentId');
  });
});
