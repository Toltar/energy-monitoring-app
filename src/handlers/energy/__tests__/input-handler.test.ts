import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { handler } from '../input-handler';
import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

// Mock the logger
vi.mock('../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })),
  redactConfig: {}
}));

// Setup DynamoDB mock
const ddbMock = mockClient(DynamoDBDocumentClient);

describe('Energy Usage Input Lambda Handler', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  } as unknown as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
  });

  it('should successfully store energy usage data', async () => {
    // Mock successful DynamoDB put
    ddbMock.on(PutCommand).resolves({});

    const mockEvent = {
      body: JSON.stringify({
        date: '2024-01-13',
        usage: 25.5
      }),
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = ((await handler(mockEvent, mockContext, vi.fn()))) as APIGatewayProxyResult;

    // Verify response
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Energy data saved successfully'
    });

    // Verify DynamoDB call
    expect(ddbMock.calls()).toHaveLength(1);
  });

  it('should return 400 if request body is missing', async () => {
    const mockEvent = {
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Missing request body'
    });
  });

  it('should return 401 if authorizer is missing', async () => {
    const mockEvent = {
      body: JSON.stringify({
        date: '2024-01-13',
        usage: 25.5
      }),
      requestContext: {}
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Unauthorized'
    });
  });

  it('should return 401 if user ID is missing', async () => {
    const mockEvent = {
      body: JSON.stringify({
        date: '2024-01-13',
        usage: 25.5
      }),
      requestContext: {
        authorizer: {
          claims: {}
        }
      }
    } as unknown as APIGatewayEvent;

    const response = (await handler(mockEvent, mockContext, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Unauthorized'
    });
  });

  it('should return 400 if input data is invalid', async () => {
    const mockEvent = {
      body: JSON.stringify({
        date: 'invalid-date',
        usage: 'not-a-number'
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

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Invalid input data'
    });
  });

  it('should return 500 if DynamoDB operation fails', async () => {
    // Mock DynamoDB failure
    ddbMock.on(PutCommand).rejects(new Error('DynamoDB error'));

    const mockEvent = {
      body: JSON.stringify({
        date: '2024-01-13',
        usage: 25.5
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

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Internal server error'
    });
  });
});
