import { APIGatewayEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createLogger, redactConfig } from '../utils/logger';
import { v4 } from 'uuid';

const s3 = new S3Client();
const BUCKET_NAME = process.env.BUCKET_NAME;
const URL_EXPIRATION = 600; // 10 minutes

export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent, context: Context) => {
  const logger = createLogger({
    context,
    event,
    additionalOptions: {
      redact: redactConfig
    },
  });
  try {
    const authorizer = event.requestContext.authorizer;

    if (!authorizer) {
      logger.warn('Unauthorized request');
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' })
      }
    }

    const userId: string = authorizer.claims.sub;
    const username: string = authorizer.claims['cognito:username'];

    if (!userId) {
      logger.warn('Unauthorized request');
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' })
      }
    }

    logger.info({ userId }, 'Getting presigned url');

    const fileKey = `uploads/${userId}/${v4()}.csv`;
    console.log('I made it to file key');
    const putObjectCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ContentType: 'text/csv',
      Metadata: {
        userid: userId,
        username: username
      }
    });
    const presignedUrl = await getSignedUrl(s3, putObjectCommand, { expiresIn: URL_EXPIRATION })

    logger.info({ fileKey, presignedUrl }, 'Presigned url has successfully created');

    return {
      statusCode: 200,
      body: JSON.stringify({
        uploadUrl: presignedUrl,
        fileKey: fileKey,
        expiresIn: URL_EXPIRATION,
      })
    };
  } catch (error) {
    logger.error({ err: error }, 'Failed to generate a presigned s3 url');
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error generating upload URL'
      })
    }
  }
}
