import { describe, it, expect } from 'vitest';
import {
  isValidDateStringInput,
  dateInputStringToDate,
  InvalidDateStringInputError
} from '../date-input-string';

describe('Date Helpers', () => {
  describe('isValidDateStringInput', () => {
    it.each([
      '2024-01-15',
      '2023-12-31',
      '2020-02-29', // Leap year
      '2025-01-01'
    ])('should return true for valid date strings: %s', (dateString) => {
      expect(isValidDateStringInput(dateString)).toBe(true);
    });

    it.each(
      [
        '2024/01/15',    // Wrong format
        '15-01-2024',    // Wrong format
        '2024-1-15',     // Missing leading zero
        '2024-01-32',    // Invalid day
        '2024-13-01',    // Invalid month
        'not-a-date',    // Non-date string
        '2024-01-1',     // Missing leading zero
        '',              // Empty string
        '  ',            // Whitespace
        '2024-01-15 ',   // Extra whitespace
        ' 2024-01-15',   // Leading whitespace
        'null',          // String 'null'
        '2024_01_15',    // Wrong separator
      ]
    )('should return false for invalid date strings %s', (invalidDate) => {
      expect(isValidDateStringInput(invalidDate)).toBe(false);
    });

    it.each([
      null,
      undefined,
      123,
      true,
      false,
      {},
      [],
      new Date(),
      NaN,
      Infinity,
      -Infinity,
      Symbol('test'),
      () => { }
    ])('should return false for non-string inputs: %s', (input) => {
      expect(isValidDateStringInput(input)).toBe(false);
    });
  });

  describe('dateInputStringToDate', () => {
    it.each([
      {
        input: '2024-01-15',
        expected: new Date(2024, 0, 15)
      },
      {
        input: '2023-12-31',
        expected: new Date(2023, 11, 31)
      },
      {
        input: '2020-02-29',
        expected: new Date(2020, 1, 29)
      }
    ])('should convert valid date strings to Date objects, %o', ({ input, expected }) => {
      const result = dateInputStringToDate(input);
      expect(result).toStrictEqual(expected);
    });

    it.each([
      '2024/01/15',
      '15-01-2024',
      '2024-1-15',
      '2024-01-32',
      '2024-13-01',
      'not-a-date',
      '',
      ' ',
      null,
      undefined,
      123,
      true,
      {},
      []
    ])('should throw InvalidDateStringInputError for invalid date strings: %s', (input) => {
      expect(() => dateInputStringToDate(input)).toThrow(InvalidDateStringInputError);
      expect(() => dateInputStringToDate(input)).toThrow(`Invalid date string input of: ${input}`);
    });
  });

  describe('InvalidDateStringInputError', () => {
    it('should create error with correct message and name', () => {
      const invalidInput = 'invalid-date';
      const error = new InvalidDateStringInputError(invalidInput);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('InvalidDateStringInputError');
      expect(error.message).toBe('Invalid date string input of: invalid-date');
    });

    it.each([
      { input: null, expected: 'Invalid date string input of: null' },
      { input: undefined, expected: 'Invalid date string input of: undefined' },
      { input: 123, expected: 'Invalid date string input of: 123' },
      { input: {}, expected: 'Invalid date string input of: [object Object]' },
      { input: [], expected: 'Invalid date string input of: ' },
    ])('should handle various input types in error message: %o', ({ input, expected }) => {
      const error = new InvalidDateStringInputError(input);
      expect(error.message).toBe(expected);
    });
  });
});
