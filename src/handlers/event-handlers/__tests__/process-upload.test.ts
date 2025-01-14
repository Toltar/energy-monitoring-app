import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Event, Context, S3EventRecord } from 'aws-lambda';
import { handler } from '../process-upload';

// Mock the logger
vi.mock('../utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })),
  redactConfig: {}
}));

// Setup S3 and DynamoDB mocks
const s3Mock = mockClient(S3Client);
const ddbMock = mockClient(DynamoDBDocumentClient);

describe('S3 CSV Processing Lambda Handler', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  } as unknown as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    s3Mock.reset();
    ddbMock.reset();
    process.env.ENERGY_USAGE_TABLE = 'test-energy-table';
  });

  it('should successfully process CSV file and store data in DynamoDB', async () => {
    const testUserId = 'test-user-id';
    const csvContent = `Date,Usage(kWh)
2024-01-01,25.5
2024-01-02,30.2
2024-01-03,28.7`;

    // Mock S3 GetObject response
    s3Mock.on(GetObjectCommand).resolves({
      // @ts-expect-error We are just trying to mock here
      Body: {
        transformToString: (encoding?: string) => {
          console.log(encoding);
          return Promise.resolve(csvContent);
        }
      },
      Metadata: {
        userid: testUserId
      }
    });

    // Mock DynamoDB BatchWriteItem response
    ddbMock.on(BatchWriteItemCommand).resolves({
      UnprocessedItems: {}
    });

    const mockS3Event: S3Event = {
      Records: [{
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: 'test-file.csv'
          }
        }
      }] as unknown as S3EventRecord[]
    };

    await handler(mockS3Event, mockContext, vi.fn());

    // Verify S3 call
    expect(s3Mock.calls()).toHaveLength(1);

    // Verify DynamoDB calls
    expect(ddbMock.calls()).toHaveLength(1);
  });

  it('should handle large CSV files with batch processing', async () => {
    const testUserId = 'test-user-id';
    const csvRows = Array.from({ length: 30 }, (_, i) =>
      `2024-01-${(i + 1).toString().padStart(2, '0')},${(20 + i).toFixed(1)}`
    );
    const csvContent = `Date,Usage(kWh)\n${csvRows.join('\n')}`;

    s3Mock.on(GetObjectCommand).resolves({
      //@ts-expect-error Just trying to mock here
      Body: {
        transformToString: (encoding?: string) => {
          console.log(encoding);
          return Promise.resolve(csvContent);
        }
      },
      Metadata: {
        userid: testUserId
      }
    });

    ddbMock.on(BatchWriteItemCommand).resolves({
      UnprocessedItems: {}
    });

    const mockS3Event: S3Event = {
      Records: [{
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: 'test-file.csv'
          }
        }
      }] as unknown as S3EventRecord[]
    };

    await handler(mockS3Event, mockContext, vi.fn());

    // Verify multiple batch writes (30 items should be split into 2 batches)
    expect(ddbMock.calls()).toHaveLength(2);
  });

  it('should handle missing metadata', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      //@ts-expect-error Just ignore due to mocking reasons
      Body: {
        transformToString: (encoding?: string) => {
          console.log(encoding);
          return Promise.resolve('');
        }
      },
      // No Metadata
    });

    const mockS3Event: S3Event = {
      Records: [{
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: 'test-file.csv'
          }
        }
      }] as unknown as S3EventRecord[]
    };

    await handler(mockS3Event, mockContext, vi.fn());

    // Verify no DynamoDB calls were made
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('should handle missing userId in metadata', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      //@ts-expect-error Mocking here, please ignore type error
      Body: {
        transformToString: (encoding?: string) => {
          console.log(encoding);
          return Promise.resolve('Date,Usage(kWh)\n2024-01-01,25.5');
        }
      },
      Metadata: {
        // No userid field
        otherField: 'value'
      }
    });

    const mockS3Event: S3Event = {
      Records: [{
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: 'test-file.csv'
          }
        }
      }] as unknown as S3EventRecord[]
    };

    await handler(mockS3Event, mockContext, vi.fn());

    // Verify no DynamoDB calls were made
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('should handle empty file content', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      // @ts-expect-error Mocking it here no need to check types
      Body: {
        transformToString: (encoding?: string) => {
          console.log(encoding);
          return Promise.resolve('');
        }
      },
      Metadata: {
        userid: 'test-user-id'
      }
    });

    const mockS3Event: S3Event = {
      Records: [{
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: 'test-file.csv'
          }
        }
      }] as unknown as S3EventRecord[]
    };

    await handler(mockS3Event, mockContext, vi.fn());

    // Verify no DynamoDB calls were made
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('should handle S3 errors gracefully', async () => {
    s3Mock.on(GetObjectCommand).rejects(new Error('S3 error'));

    const mockS3Event: S3Event = {
      Records: [{
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: 'test-file.csv'
          }
        }
      }] as unknown as S3EventRecord[]
    };

    await expect(handler(mockS3Event, mockContext, vi.fn())).rejects.toThrow('S3 error');
  });

  it('should handle DynamoDB errors gracefully', async () => {
    s3Mock.on(GetObjectCommand).resolves({
      // @ts-expect-error Mocking it here no need to check types
      Body: {
        transformToString: (encoding?: string) => {
          console.log(encoding);
          return Promise.resolve('Date,Usage(kWh)\n2024-01-01,25.5');
        }
      },
      Metadata: {
        userid: 'test-user-id'
      }
    });

    ddbMock.on(BatchWriteItemCommand).rejects(new Error('DynamoDB error'));

    const mockS3Event: S3Event = {
      Records: [{
        s3: {
          bucket: {
            name: 'test-bucket'
          },
          object: {
            key: 'test-file.csv'
          }
        }
      }] as unknown as S3EventRecord[]
    };

    await expect(handler(mockS3Event, mockContext, vi.fn())).rejects.toThrow('DynamoDB error');
  });
});
