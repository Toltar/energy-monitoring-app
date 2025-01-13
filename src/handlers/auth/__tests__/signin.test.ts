import { afterEach, describe, afterAll, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../signin';
import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognitoMock = mockClient(CognitoIdentityProviderClient)

vi.mock('../util/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }),
  redactConfig: {}
}));


describe('Sign In Lambda', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  };

  beforeEach(() => {
    cognitoMock.reset();
    // Reset date to a fixed point for testing
    vi.setSystemTime(new Date('2024-01-15'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('should successfully authenticate a user', async () => {
    const mockAuthResult = {
      AuthenticationResult: {
        AccessToken: 'mock-access-token',
        IdToken: 'mock-id-token',
        RefreshToken: 'mock-refresh-token'
      }
    };

    cognitoMock.on(InitiateAuthCommand).resolves(mockAuthResult);

    const event = {
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'Password123!'
      })
    } as APIGatewayEvent;

    const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Successfully authenticated',
      tokens: {
        accessToken: 'mock-access-token',
        idToken: 'mock-id-token',
        refreshToken: 'mock-refresh-token'
      }
    });
    expect(cognitoMock.calls()).toHaveLength(1);
  });

  describe('Request Validation', () => {
    it.each([
      ['empty request body', undefined],
      ['null request body', null],
      ['empty string body', ''],
    ])('should reject %s', async (_, body) => {
      const event = { body } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Missing request body'
      });
      expect(cognitoMock.commandCalls(InitiateAuthCommand)).toHaveLength(0);
    });

    it.each([
      ['missing email', { password: 'Password123!' }],
      ['missing password', { email: 'test@example.com' }],
      ['empty email', { email: '', password: 'Password123!' }],
      ['empty password', { email: 'test@example.com', password: '' }],
    ])('should reject %s', async (_, payload) => {
      const event = {
        body: JSON.stringify(payload)
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Missing required fields'
      });
      expect(cognitoMock.commandCalls(InitiateAuthCommand)).toHaveLength(0);
    });

    it.each([
      'invalid-email',
      'email@',
      '@domain.com',
      'email@domain',
      'email@domain..com',
    ])('should reject invalid email: %s', async (invalidEmail) => {
      const event = {
        body: JSON.stringify({
          email: invalidEmail,
          password: 'Password123!'
        })
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: `Invalid email of: ${invalidEmail}`
      });
      expect(cognitoMock.commandCalls(InitiateAuthCommand)).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid credentials', async () => {
      const notAuthError = new Error('Incorrect username or password');
      Object.defineProperty(notAuthError, 'name', { value: 'NotAuthorizedException' });
      cognitoMock.on(InitiateAuthCommand).rejects(notAuthError);

      const event = {
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'wrong-password'
        })
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Incorrect username or password'
      });
    });

    it('should handle missing authentication result', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({});

      const event = {
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'Password123!'
        })
      } as APIGatewayEvent;

      const response: APIGatewayProxyResult = (await handler(event as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Error during authentication'
      });
    });

    it('should handle Cognito service errors', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(new Error('Service error'));

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
  });
});
