import { In } from 'typeorm';

export type FilterSelection<T = string> = T | T[];
export const filterValues = <T>(
  value: FilterSelection<T> | null | undefined,
): T[] =>
  value === undefined || value === null
    ? []
    : [...new Set(Array.isArray(value) ? value : [value])];
export const filterWhere = <T>(value: FilterSelection<T>) =>
  Array.isArray(value) ? In(value) : value;
