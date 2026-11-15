import { IsNull } from 'typeorm';
﻿import { IsDepartmentNameUniqueConstraint } from './is-department-name-unique.validator.js';

describe('IsDepartmentNameUniqueConstraint', () => {
  let constraint: IsDepartmentNameUniqueConstraint;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = { count: jest.fn() };
    constraint = new IsDepartmentNameUniqueConstraint(mockRepo);
  });

  it('should return true if name does not exist', async () => {
    mockRepo.count.mockResolvedValue(0);
    const result = await constraint.validate('Phòng IT', {} as any);
    expect(result).toBe(true);
    expect(mockRepo.count).toHaveBeenCalledWith({
      where: { departmentName: 'Phòng IT', deletedAt: IsNull() },
    });
  });

  it('should return false if name already exists', async () => {
    mockRepo.count.mockResolvedValue(1);
    const result = await constraint.validate('Phòng IT', {} as any);
    expect(result).toBe(false);
  });
});
