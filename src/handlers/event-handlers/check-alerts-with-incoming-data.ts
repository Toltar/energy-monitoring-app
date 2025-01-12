import { Context, DynamoDBStreamHandler, DynamoDBStreamEvent } from 'aws-lambda';
import { createLogger, redactConfig } from '../utils/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';


const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ALERTS_TABLE = process.env.ALERTS_TABLE;
const ENERGY_USAGE_TABLE = process.env.ENERGY_USAGE_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

export const handler: DynamoDBStreamHandler = async (event: DynamoDBStreamEvent, context: Context) => {
  const logger = createLogger({
    event,
    context,
    additionalOptions: {
      redact: redactConfig
    },
  });
  try {

  } catch (error) {

  }
}
