import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

const body = (message: string, code: string, details: Record<string, unknown> = {}) => ({ success: false, message, error: { code, details } });

export const reportBadRequest = (message: string, code = 'VALIDATION_ERROR', details: Record<string, unknown> = {}) =>
  new BadRequestException(body(message, code, details));
export const reportNotFound = (message: string, code: string) => new NotFoundException(body(message, code));
export const reportConflict = (message: string, code: string) => new ConflictException(body(message, code));
