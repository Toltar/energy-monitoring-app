import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, redactConfig } from '../utils/logger';
import { SNS, SubscribeCommand } from '@aws-sdk/client-sns';
import { emailRegex } from '../utils/email';

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const sns = new SNS();
const ALERTS_TABLE = process.env.ALERTS_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
interface ThresholdInput {
  threshold: number;
}

function isThresholdInput(input: unknown): input is ThresholdInput {
  return typeof input === 'object'
    && input !== undefined
    && input !== null
    && 'threshold' in input
    && typeof input.threshold === 'number';
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent, context: Context) => {
  const logger = createLogger({
    event,
    context,
    additionalOptions: {
      redact: redactConfig
    }
  });
  try {
    const userId = event.requestContext.authorizer?.claims.sub;
    const userEmail = event.requestContext.authorizer?.claims.email;

    if (!userId) {
      logger.warn('Unauthorized request: missing user id');
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    if (!userEmail || !emailRegex.test(userEmail)) {
      logger.warn({ userId, userEmail }, 'Unauthorized request: invalid email in sub claim')
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' }),
      };
    }

    if (!event.body) {
      logger.warn({ userId, userEmail }, 'Bad request: user did not specify a body');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'No request body given' })
      };
    }

    const body = JSON.parse(event.body)

    if (!isThresholdInput(body)) {
      logger.warn({ userId, userEmail, body }, 'Bad request: Invalid input');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Bad request body' })
      };
    }

    if (body.threshold <= 0) {
      logger.warn({ userId, userEmail, body }, 'Bad request: Invalid input with threshold less than or equal to zero');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Valid theshold is greater than zero' })
      };
    }

    logger.info({ body, userId, userEmail }, 'Setting up energy usage threshold alerts');

    await docClient.send(new PutCommand({
      TableName: ALERTS_TABLE,
      Item: {
        userId: userId,
        email: userEmail,
        threshold: body.threshold
      }
    }));


    await sns.send(new SubscribeCommand({
      TopicArn: SNS_TOPIC_ARN,
      Protocol: 'email',
      Endpoint: userEmail,
      Attributes: {
        FilterPolicy: JSON.stringify({
          userId: [userId],
        }),
      }
    }));

    logger.info({ body, userId, userEmail }, 'Alerting set up successfully!');
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Threshold alert created successfully'
      })
    };
  } catch (error) {
    logger.error({
      userId: event.requestContext.authorizer?.claims.sub,
      body: event.body,
      error
    }, 'Failed to set the up alerting');
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error setting threshold'
      })
    };
  }
}
