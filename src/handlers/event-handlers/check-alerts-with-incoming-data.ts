import { Context, DynamoDBStreamHandler, DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { createLogger, redactConfig } from '../utils/logger';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { PublishCommand, SNS } from '@aws-sdk/client-sns';
import { isEnergyUsageDatabaseEntry } from '../../types/energy-data';
import pino from 'pino';
import { isThesholdAlertData } from '../../types/alerts-threshold';
import { unmarshall } from '@aws-sdk/util-dynamodb';


const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const sns = new SNS();
const ALERTS_TABLE = process.env.ALERTS_TABLE;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

async function processRecord(record: DynamoDBRecord, logger: pino.Logger) {
  const newImage = record.dynamodb?.NewImage;
  if (!newImage) {
    return;
  }

  const recordAsObject = newImage !== undefined ? {
    usage: Number(newImage.usage.N),
    userId: newImage.userId.S,
    date: newImage.date.S,
    timestamp: newImage.timestamp.S
  } : undefined;

  if (!isEnergyUsageDatabaseEntry(recordAsObject)) {
    logger.error({ recordAsObject }, 'Invalid record has been inserted/modified into the database')
    return;
  }

  try {
    const { usage, userId, date } = recordAsObject;

    const { Item } = await docClient.send(new GetItemCommand({
      TableName: ALERTS_TABLE,
      Key: { userId: { S: userId } }
    }));

    if (!Item) {
      logger.info({ userId: recordAsObject.userId }, 'No theshold set for user');
      return;
    }

    const thresholdData = unmarshall(Item);

    if (!isThesholdAlertData(thresholdData)) {
      logger.info({ userId: recordAsObject.userId, newRecord: recordAsObject, thresholdData }, 'No threshold set for user');
      return;
    }

    if (usage > thresholdData.threshold) {
      logger.info({
        userId,
        usage,
        theshold: thresholdData.threshold
      }, 'Threshold exceeded');

      await sns.send(new PublishCommand({
        TargetArn: SNS_TOPIC_ARN,
        MessageAttributes: {
          'email': {
            DataType: 'String',
            StringValue: thresholdData.email
          },
          'userId': {
            DataType: 'String',
            StringValue: thresholdData.userId
          },
          'usage': {
            DataType: 'Number',
            StringValue: usage.toString()
          },
          'theshold': {
            DataType: 'Number',
            StringValue: thresholdData.threshold.toString()
          }
        },
        Subject: 'ALERT: Energy Usage Theshold Exceeded',
        Message: JSON.stringify({
          userId,
          date,
          email: thresholdData.email,
          threshold: thresholdData.threshold,
          usage
        })
      }));

      logger.info({
        userId,
        email: thresholdData.email
      }, 'Alert notification sent');
    }
  } catch (error) {
    logger.error({
      err: error,
      userId: recordAsObject.userId
    }, 'Error processing threshold alert check')
    return;
  }
}

export const handler: DynamoDBStreamHandler = async (event: DynamoDBStreamEvent, context: Context) => {
  const logger = createLogger({
    event,
    context,
    additionalOptions: {
      redact: redactConfig
    },
  });
  const filteredEventRecords = event.Records.filter(record => record.eventName === 'INSERT' || record.eventName === 'MODIFY');
  try {
    logger.info({
      recordCount: event.Records.length
    }, 'Processing DynamoDB Stream records');

    const results = await Promise.allSettled(
      event.Records.map((record) => processRecord(record, logger))
    );

    const failedEvents = results.filter((e) => e.status === 'rejected');

    if (failedEvents.length) {
      throw new Error();
    }
  } catch (error) {
    logger.error({ filteredEventRecords, err: error }, 'Failed to all events in stream records');
    throw error;
  }
}
