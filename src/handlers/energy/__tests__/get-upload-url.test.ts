import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handler } from '../get-upload-url';
import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { APIGatewayEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Mock UUID to have consistent file keys in tests
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid'
}));

// Mock the logger
vi.mock('../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }),
  redactConfig: {}
}));

// Mock getSignedUrl
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn()
}));

const s3Mock = mockClient(S3Client);

describe('Upload URL Lambda', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function'
  };

  beforeEach(() => {
    process.env.BUCKET_NAME = 'test-bucket';
    s3Mock.reset();
    vi.clearAllMocks();
  });

  it('should generate presigned URL successfully', async () => {
    const mockEvent = {
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id'
          }
        }
      }
    } as unknown as APIGatewayEvent;

    const mockPresignedUrl = 'https://test-bucket.s3.amazonaws.com/test-file';
    vi.mocked(getSignedUrl).mockResolvedValue(mockPresignedUrl);

    const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      uploadUrl: mockPresignedUrl,
      fileKey: 'uploads/test-user-id/mock-uuid.csv',
      expiresIn: 600
    });
  });

  it('should reject unauthorized requests', async () => {
    const mockEvent = {
      requestContext: {}
    };

    const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Unauthorized'
    });
  });

  it('should reject requests without user ID', async () => {
    const mockEvent = {
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
  });

  it('should handle S3 errors', async () => {
    const mockEvent = {
      requestContext: {
        authorizer: {
          claims: {
            sub: 'test-user-id'
          }
        }
      }
    };

    vi.mocked(getSignedUrl).mockRejectedValue(new Error('S3 Error'));

    const response: APIGatewayProxyResult = (await handler(mockEvent as unknown as APIGatewayEvent, mockContext as unknown as Context, vi.fn())) as APIGatewayProxyResult;

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({
      message: 'Error generating upload URL'
    });
  });
});
