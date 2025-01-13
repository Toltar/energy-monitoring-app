import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../signup';
import { CognitoIdentityProviderClient, SignUpCommand, AdminConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

// Mock logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }),
  redactConfig: {}
}));

describe('Sign Up Lambda', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  };
  beforeEach(() => {
    cognitoMock.reset();
    process.env.CLIENT_ID = 'test-client-id';
    process.env.USER_POOL_ID = 'test-user-pool-id';
  });

  it('should successfully register a new user', async () => {
    const mockUserSub = 'test-user-sub-123';

    cognitoMock
      .on(SignUpCommand).resolves({ UserSub: mockUserSub })
      .on(AdminConfirmSignUpCommand).resolves({});

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123!'
      })
    } as APIGatewayEvent;

    const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      message: 'User registration successful',
      userId: mockUserSub
    });
  });

  describe('Request Validation', () => {
    it('should reject requests without a body', async () => {
      const event = {} as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Missing request body'
      });
    });

    it.each([
      ['missing email', { password: 'Password123!' }],
      ['missing password', { email: 'test@example.com' }],
      ['empty email', { email: '', password: 'Password123!' }],
      ['empty password', { email: 'test@example.com', password: '' }]
    ])('should reject request with %s', async (_, payload) => {
      const event = {
        body: JSON.stringify(payload)
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Missing required fields'
      });
    });

    it.each([
      'invalid-email',
      'email@',
      '@domain.com',
      'email@domain',
      'email@domain..com'
    ])('should reject invalid email: %s', async (invalidEmail) => {
      const event = {
        body: JSON.stringify({
          email: invalidEmail,
          password: 'Password123!'
        })
      };

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: `Invalid email of: ${invalidEmail}`
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle existing user error', async () => {
      const error = new Error('User already exists') as Error & { name: string };
      error.name = 'UsernameExistsException';
      cognitoMock.on(SignUpCommand).rejects(error);

      const event = {
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123!'
        })
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body)).toEqual({
        message: 'User already exists'
      });
    });

    it('should handle Cognito service errors', async () => {
      cognitoMock.on(SignUpCommand).rejects(new Error('Service error'));

      const event = {
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123!'
        })
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Service error'
      });
    });

    it('should handle AdminConfirmSignUp errors', async () => {
      cognitoMock
        .on(SignUpCommand).resolves({ UserSub: 'test-user-sub' })
        .on(AdminConfirmSignUpCommand).rejects(new Error('Confirmation error'));

      const event = {
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123!'
        })
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Confirmation error'
      });
    });
  });
});
