import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { GetItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SNS, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBStreamEvent, Context, DynamoDBRecord } from 'aws-lambda';
import { handler } from '../check-alerts-with-incoming-data';

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

describe('DynamoDB Stream Lambda Handler', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  } as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    ddbMock.reset();
    snsMock.reset();
    process.env.ALERTS_TABLE = 'test-alerts-table';
    process.env.SNS_TOPIC_ARN = 'test-topic-arn';
  });

  it('should process new record and send SNS notification when threshold is exceeded', async () => {
    const testUserId = 'test-user-id';
    const testEmail = 'test@example.com';
    const testUsage = 100;
    const testThreshold = 50;
    const testDate = '2024-01-13T12:00:00Z';

    // Mock DynamoDB GetItem response for threshold check
    ddbMock.on(GetItemCommand).resolves({
      Item: {
        userId: { S: testUserId },
        email: { S: testEmail },
        threshold: { N: testThreshold.toString() }
      }
    });

    // Mock successful SNS publish
    snsMock.on(PublishCommand).resolves({});

    const mockStreamEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              userId: { S: testUserId },
              usage: { N: testUsage.toString() },
              date: { S: testDate },
              timestamp: { S: new Date().toISOString() }
            }
          }
        } as unknown as DynamoDBRecord
      ]
    };

    await handler(mockStreamEvent, mockContext, vi.fn());

    // Verify DynamoDB call
    expect(ddbMock.calls()).toHaveLength(1);

    // Verify SNS call
    expect(snsMock.calls()).toHaveLength(1);
  });

  it('should not send SNS notification when usage is below threshold', async () => {
    const testUserId = 'test-user-id';
    const testEmail = 'test@example.com';
    const testUsage = 30;
    const testThreshold = 50;

    // Mock DynamoDB GetItem response
    ddbMock.on(GetItemCommand).resolves({
      Item: {
        userId: { S: testUserId },
        email: { S: testEmail },
        threshold: { N: testThreshold.toString() }
      }
    });

    const mockStreamEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              userId: { S: testUserId },
              usage: { N: testUsage.toString() },
              date: { S: new Date().toISOString() },
              timestamp: { S: new Date().toISOString() }
            }
          }
        } as unknown as DynamoDBRecord
      ]
    };

    await handler(mockStreamEvent, mockContext, vi.fn());

    // Verify DynamoDB was called but SNS was not
    expect(ddbMock.calls()).toHaveLength(1);
    expect(snsMock.calls()).toHaveLength(0);
  });

  it('should skip processing if no threshold is set for user', async () => {
    // Mock DynamoDB GetItem response with no Item
    ddbMock.on(GetItemCommand).resolves({});

    const mockStreamEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              userId: { S: 'test-user-id' },
              usage: { N: '100' },
              date: { S: new Date().toISOString() },
              timestamp: { S: new Date().toISOString() }
            }
          }
        } as unknown as DynamoDBRecord
      ]
    };

    await handler(mockStreamEvent, mockContext, vi.fn());

    // Verify DynamoDB was called but SNS was not
    expect(ddbMock.calls()).toHaveLength(1);
    expect(snsMock.calls()).toHaveLength(0);
  });

  it('should handle multiple records in the stream', async () => {
    // Mock DynamoDB GetItem to return different thresholds for different users
    ddbMock.on(GetItemCommand)
      .resolvesOnce({
        Item: {
          userId: { S: 'user1' },
          email: { S: 'user1@example.com' },
          threshold: { N: '50' }
        }
      })
      .resolvesOnce({
        Item: {
          userId: { S: 'user2' },
          email: { S: 'user2@example.com' },
          threshold: { N: '100' }
        }
      });

    const mockStreamEvent: DynamoDBStreamEvent = {
      Records: [
        {
          eventName: 'INSERT',
          dynamodb: {
            NewImage: {
              userId: { S: 'user1' },
              usage: { N: '75' },
              date: { S: new Date().toISOString() },
              timestamp: { S: new Date().toISOString() }
            }
          }
        } as unknown as DynamoDBRecord,
        {
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: {
              userId: { S: 'user2' },
              usage: { N: '80' },
              date: { S: new Date().toISOString() },
              timestamp: { S: new Date().toISOString() }
            }
          }
        } as unknown as DynamoDBRecord
      ]
    };

    await handler(mockStreamEvent, mockContext, vi.fn());

    // Verify DynamoDB calls
    expect(ddbMock.calls()).toHaveLength(2);

    // Verify SNS was called only for user1 (usage > threshold)
    expect(snsMock.calls()).toHaveLength(1);
  });
});
