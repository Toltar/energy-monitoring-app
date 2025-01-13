import { APIGatewayEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createLogger, redactConfig } from '../utils/logger';
import { dateInputStringToDate, isValidDateStringInput } from '../utils/date-input-string';
import { EnergyUsageDataInput } from '../../types/energy-data';

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ENERGY_USAGE_TABLE = process.env.ENERGY_USAGE_TABLE!;

export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent, context: Context) => {
  const logger = createLogger({
    context,
    event,
    additionalOptions: {
      redact: redactConfig
    },
  });
  try {
    if (!event.body) {
      logger.warn('Missing request body');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing request body' })
      };
    }

    const authorizer = event.requestContext.authorizer;
    if (!authorizer) {
      logger.warn('Unauthorized request');
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' })
      };
    }

    const userId: string = authorizer.claims.sub;

    if (!userId) {
      logger.warn({ userId }, 'Unauthorized request');
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' })
      };
    }

    logger.info({ body: event.body }, 'Parsing request body');

    const data: EnergyUsageDataInput = JSON.parse(event.body);

    logger.info({ data }, 'Request body parsed');

    if (!data.date || !data.usage || isNaN(data.usage) || !isValidDateStringInput(data.date)) {
      logger.info({ data }, 'Invalid request body');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid input data' }),
      };
    }

    logger.info({ data }, 'Storing data into database');
    const putCommand: PutCommand = new PutCommand({
      TableName: ENERGY_USAGE_TABLE,
      Item: {
        userId: userId,
        date: dateInputStringToDate(data.date).toISOString(),
        usage: data.usage,
        timestamp: new Date().toISOString()
      },
    });

    await docClient.send(putCommand);

    logger.info({ data }, 'Energy data was saved successfully');

    return {
      statusCode: 201,
      body: JSON.stringify({
        message: 'Energy data saved successfully'
      })
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error({ err: error, errname: error.name, message: error.message }, 'Error');
    } else {
      logger.error({ err: error }, 'Manual energy input failed');
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal server error'
      })
    }
  }
}
