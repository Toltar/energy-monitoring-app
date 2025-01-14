import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SNS, SubscribeCommand } from '@aws-sdk/client-sns';
import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { handler } from '../manage-alerts';

// Mock the logger
vi.mock('../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })),
  redactConfig: {}
}));

// Setup DynamoDB and SNS mocks
const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNS);

describe('Manage Alerts Lambda Handler', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  } as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
    snsMock.reset();
  });

  it('should successfully create alert threshold and SNS subscription', async () => {
    // Mock successful DynamoDB put and SNS subscribe
    ddbMock.on(PutCommand).resolves({});
    snsMock.on(SubscribeCommand).resolves({});

    const mockEvent = {
      body: JSON.stringify({
        threshold: 50.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id',
            email: 'test@example.com'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    // Verify response
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Threshold alert created successfully'
    });

    // Verify DynamoDB call
    expect(ddbMock.calls()).toHaveLength(1);

    // Verify SNS call
    expect(snsMock.calls()).toHaveLength(1);
  });

  it('should return 401 if user ID is missing', async () => {
    const mockEvent = {
      body: JSON.stringify({
        threshold: 50.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            email: 'test@example.com'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Unauthorized'
    });
  });

  it('should return 401 if email is missing', async () => {
    const mockEvent = {
      body: JSON.stringify({
        threshold: 50.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Unauthorized'
    });
  });

  it('should return 401 if email is invalid', async () => {
    const mockEvent = {
      body: JSON.stringify({
        threshold: 50.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id',
            email: 'invalid-email'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Unauthorized'
    });
  });

  it('should return 400 if request body is missing', async () => {
    const mockEvent = {
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id',
            email: 'test@example.com'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      message: 'No request body given'
    });
  });

  it('should return 400 if threshold is missing or not a number', async () => {
    const mockEvent = {
      body: JSON.stringify({
        notThreshold: 50.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id',
            email: 'test@example.com'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Bad request body'
    });
  });

  it('should return 400 if threshold is less than or equal to zero', async () => {
    const mockEvent = {
      body: JSON.stringify({
        threshold: 0
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id',
            email: 'test@example.com'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Valid theshold is greater than zero'
    });
  });

  it('should return 500 if DynamoDB operation fails', async () => {
    ddbMock.on(PutCommand).rejects(new Error('DynamoDB error'));
    snsMock.on(SubscribeCommand).resolves({});

    const mockEvent = {
      body: JSON.stringify({
        threshold: 50.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id',
            email: 'test@example.com'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Error setting threshold'
    });
  });

  it('should return 500 if SNS operation fails', async () => {
    ddbMock.on(PutCommand).resolves({});
    snsMock.on(SubscribeCommand).rejects(new Error('SNS error'));

    const mockEvent = {
      body: JSON.stringify({
        threshold: 50.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id',
            email: 'test@example.com'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Error setting threshold'
    });
  });
});
