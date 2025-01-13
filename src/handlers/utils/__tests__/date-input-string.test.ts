export type DateInputString = string & { __brand: 'DateInputString' };

export class InvalidDateStringInputError extends Error {
  constructor(dateStringInput: unknown) {
    super(`Invalid date string input of: ${dateStringInput}`);
    this.name = 'InvalidDateStringInputError'
  }
}

export function isValidDateStringInput(str: unknown): str is DateInputString {
  if (typeof str === 'string') {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    try {
      const date = new Date(str);
      return !isNaN(date.getTime()) && dateRegex.test(str);
    } catch {
      return false;
    }
  }
  return false;
};

export function dateInputStringToDate(dateInputString: unknown): Date {
  if (isValidDateStringInput(dateInputString)) {
    return new Date(dateInputString);
  }
  throw new InvalidDateStringInputError(dateInputString);
}
