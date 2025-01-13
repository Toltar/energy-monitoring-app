import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { describe, afterAll, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from '../get-history';
import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

const ddbMock = mockClient(DynamoDBDocumentClient);

vi.mock('../util/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }),
  redactConfig: {}
}));

describe('Historical Data Lambda', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  };

  beforeEach(() => {
    ddbMock.reset();
    // Reset date to a fixed point for testing
    vi.setSystemTime(new Date('2024-01-15'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('should retrieve and sort historical data successfully', async () => {
    const mockEvent = {
      queryStringParameters: {
        startDate: '2024-01-01',
        endDate: '2024-01-14'
      },
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id'
          }
        }
      }
    };

    const unsortedData = [
      { date: '2024-01-02', usage: 26.3 },
      { date: '2024-01-01', usage: 25.5 },
    ];

    ddbMock.on(QueryCommand).resolves({
      Items: unsortedData
    });

    const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;
    const responseBody = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    // Verify data is sorted by date
    expect(responseBody).toEqual([
      { date: '2024-01-01', usage: 25.5 },
      { date: '2024-01-02', usage: 26.3 }
    ]);

    // Verify the query parameters
    const queryCommand = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(queryCommand).toEqual({
      TableName: process.env.ENERGY_TABLE,
      KeyConditionExpression: 'userId = :userId AND #date BETWEEN :startDate AND :endDate',
      ExpressionAttributeNames: {
        '#date': 'date'
      },
      ExpressionAttributeValues: {
        ':userId': 'test-user-id',
        ':startDate': '2024-01-01',
        ':endDate': '2024-01-14'
      }
    });
  });

  describe('Authorization Validation', () => {
    it('should reject unauthorized requests', async () => {
      const mockEvent = {
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-01-31'
        },
        requestContext: {
          authorizer: {
            claims: {}
          }
        }
      };

      const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Unauthorized'
      });

      // Verify no DynamoDB calls were made
      expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    });
  });

  describe('Date Parameter Validation', () => {
    it('should reject missing date parameters', async () => {
      const mockEvent = {
        queryStringParameters: {},
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-user-id'
            }
          }
        }
      };

      const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Missing date range parameters'
      });
    });

    it('should reject invalid date formats', async () => {
      const mockEvent = {
        queryStringParameters: {
          startDate: '2024/01/01',
          endDate: '2024-01-31'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-user-id'
            }
          }
        }
      };

      const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Invalid date format. Use YYYY-MM-DD'
      });
    });

    it('should reject future dates', async () => {
      const mockEvent = {
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-user-id'
            }
          }
        }
      };

      const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Dates cannot be in the future'
      });
    });

    it('should reject when start date is after end date', async () => {
      const mockEvent = {
        queryStringParameters: {
          startDate: '2024-01-10',
          endDate: '2024-01-01'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-user-id'
            }
          }
        }
      };

      const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Start date cannot be after end date'
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle DynamoDB errors gracefully', async () => {
      const mockEvent = {
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-01-14'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-user-id'
            }
          }
        }
      };

      ddbMock.on(QueryCommand).rejects(new Error('DynamoDB error'));

      const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body)).toEqual({
        message: 'Error retrieving historical data'
      });
    });

    it('should return empty array when no data found', async () => {
      const mockEvent = {
        queryStringParameters: {
          startDate: '2024-01-01',
          endDate: '2024-01-14'
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-user-id'
            }
          }
        }
      };

      ddbMock.on(QueryCommand).resolves({
        Items: []
      });

      const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual([]);
    });
  });
});
