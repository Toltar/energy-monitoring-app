import { APIGatewayEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger, redactConfig } from '../utils/logger';

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ENERGY_USAGE_TABLE = process.env.ENERGY_USAGE_TABLE;


export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent, context: Context) => {
  const logger = createLogger({
    context,
    event,
    additionalOptions: {
      redact: redactConfig
    },
  });
  try {
    logger.info('Processing historical data request');

    const userId = event.requestContext.authorizer?.claims.sub;
    if (!userId) {
      logger.warn('Unauthorized request - missing user ID');
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' })
      };
    }

    const startDate = event.queryStringParameters?.startDate;
    const endDate = event.queryStringParameters?.endDate;

    if (!startDate || !endDate) {
      logger.warn({
        userId,
        startDate,
        endDate
      }, 'Missing date range parameters');

      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing date range parameters' })
      };
    }

    // Validate dates
    if (startDate > endDate) {
      logger.warn({
        userId,
        startDate,
        endDate
      }, 'Start date is after end date');

      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Start date cannot be after end date' })
      };
    }

    logger.info({
      userId,
      startDate,
      endDate
    }, 'Querying historical data');

    const queryResponse = await docClient.send(new QueryCommand({
      TableName: ENERGY_USAGE_TABLE,
      KeyConditionExpression: 'userId = :userId AND #date BETWEEN :startDate AND :endDate',
      ExpressionAttributeNames: {
        '#date': 'date'
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':startDate': startDate,
        ':endDate': endDate
      }
    }));

    const data = (queryResponse.Items || []).map(item => ({
      date: item.date,
      usage: item.usage
    }));

    logger.info({
      userId,
      recordCount: data.length,
      startDate,
      endDate
    }, 'Successfully retrieved historical data');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    logger.error({
      err: error,
      userId: event.requestContext.authorizer?.claims.sub
    }, 'Error retrieving historical data');

    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error retrieving historical data' })
    };
  }
}
