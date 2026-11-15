import { IsNull } from 'typeorm';
﻿import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, Validate } from 'class-validator';
import { IsDepartmentCodeUniqueConstraint } from './is-department-code-unique.validator.js';

// Mock: chúng ta test logic validate method của constraint class
describe('IsDepartmentCodeUniqueConstraint', () => {
  let constraint: IsDepartmentCodeUniqueConstraint;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = { count: jest.fn() };
    constraint = new IsDepartmentCodeUniqueConstraint(mockRepo);
  });

  it('should return true if code does not exist', async () => {
    mockRepo.count.mockResolvedValue(0);
    const result = await constraint.validate('IT', {} as any);
    expect(result).toBe(true);
    expect(mockRepo.count).toHaveBeenCalledWith({
      where: { departmentCode: 'IT', deletedAt: IsNull() },
    });
  });

  it('should return false if code already exists', async () => {
    mockRepo.count.mockResolvedValue(1);
    const result = await constraint.validate('IT', {} as any);
    expect(result).toBe(false);
  });

  it('should return false for empty input', async () => {
    const result = await constraint.validate('', {} as any);
    expect(result).toBe(false);
  });

  it('should return false for non-string input', async () => {
    const result = await constraint.validate(123 as any, {} as any);
    expect(result).toBe(false);
  });
});
