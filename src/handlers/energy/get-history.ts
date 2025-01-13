import { APIGatewayEvent, APIGatewayProxyHandler, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createLogger, redactConfig } from '../utils/logger';

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ENERGY_USAGE_TABLE = process.env.ENERGY_USAGE_TABLE;

interface ValidationResult {
  isValid: boolean;
  statusCode: number;
  message: string;
}

function validateDateRange(startDate: string, endDate: string): ValidationResult {
  const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;
  // Check date format using regex
  if (!DATE_FORMAT_REGEX.test(startDate) || !DATE_FORMAT_REGEX.test(endDate)) {
    return {
      isValid: false,
      statusCode: 400,
      message: 'Invalid date format. Use YYYY-MM-DD'
    };
  }

  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDate);
  const now = new Date();

  // Check if dates are valid
  if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
    return {
      isValid: false,
      statusCode: 400,
      message: 'Invalid date format. Use YYYY-MM-DD'
    };
  }

  // Check if dates are in the future
  if (startDateObj > now || endDateObj > now) {
    return {
      isValid: false,
      statusCode: 400,
      message: 'Dates cannot be in the future'
    };
  }

  // Check date order
  if (startDateObj > endDateObj) {
    return {
      isValid: false,
      statusCode: 400,
      message: 'Start date cannot be after end date'
    };
  }

  return {
    isValid: true,
    statusCode: 200,
    message: 'Valid date range'
  };
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
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

    // Validate date range
    const validation = validateDateRange(startDate, endDate);
    if (!validation.isValid) {
      logger.warn({
        userId,
        startDate,
        endDate,
        error: validation.message
      }, 'Date validation failed');

      return {
        statusCode: validation.statusCode,
        body: JSON.stringify({ message: validation.message })
      };
    }

    logger.info({
      userId,
      startDate,
      endDate
    }, 'Querying historical data');

    const { Items } = await docClient.send(new QueryCommand({
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

    if (!Items) {
      return {
        statusCode: 200,
        body: JSON.stringify([])
      }
    }

    const data = Items.map(item => ({
      date: item.date,
      usage: item.usage
    }));

    data.sort((a, b) => a.date.localeCompare(b.date));

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
