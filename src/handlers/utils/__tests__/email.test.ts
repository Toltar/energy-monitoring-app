import { describe, it, expect } from 'vitest';
import { emailRegex } from '../email';

describe('Email Regex', () => {
  it.each([
    'test@example.com',
    'user@domain.co.uk',
    'first.last@company.org',
    'email@subdomain.domain.com',
    '123@numbers.com',
    'email@domain-with-dash.com',
    'firstname.lastname@example.com',
    '_underscore@example.com',
    'dash-user@example.com',
    // Special characters
    '12345@domain.com',
    'very.common@example.com',
  ])('should validate valid email: %s', (email) => {
    expect(emailRegex.test(email)).toBe(true);
  });

  it.each([
    '',                         // Empty string
    ' ',                        // Whitespace
    'not-an-email',            // No @ symbol
    '@no-local-part.com',      // Missing local part
    'no-domain@',              // Missing domain
    'spaces in@email.com',     // Spaces in local part
    'email@spaces in.com',     // Spaces in domain
    'email@.com',              // Empty domain part
    'email@domain..com',       // Double dots
    'email space@domain.com',  // Space in email
    'email@domain space.com',  // Space in domain
    '@.com',                   // Missing local and subdomain
    'email@.domain.com',       // Dot after @
    'email@domain.com.',       // Trailing dot in domain
    'email@domain',            // Missing top-level domain
    'email@.com.',             // Multiple issues
    'user@domain@domain.com',  // Multiple @ symbols
    // Invalid special character cases
    'email@domain@domain.com', // Multiple @ symbols
    'email\\@domain.com',      // Escaped @ symbol
    '"email"@domain.com',      // Quoted string
    'email@[123.123.123.123]', // IP address format
    'email@domain..com',       // Consecutive dots
  ])('should reject invalid email: %s', (email) => {
    expect(emailRegex.test(email)).toBe(false);
  });

  it.each([
    null,
    undefined,
    {},
    [],
    0,
    false,
    true,
    NaN,
    Infinity,
    -Infinity,
    new Date(),
    /regex/,
    () => { },
    Symbol('test'),
  ])('should handle non-string input: %s', (input) => {
    expect(emailRegex.test(String(input))).toBe(false);
  });

});
