import { Context, S3Event, S3Handler } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createLogger, redactConfig } from '../utils/logger';
import * as csv from 'csv';
import { dateInputStringToDate, isValidDateStringInput } from '../utils/date-input-string';
import { BatchWriteItemCommand, DynamoDBClient, WriteRequest } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ENERGY_USAGE_TABLE = process.env.ENERGY_USAGE_TABLE!;
const s3 = new S3Client();


interface EnergyDataRow {
  Date: string;
  'Usage(kWh)': string;
}

export const handler: S3Handler = async (event: S3Event, context: Context) => {
  const logger = createLogger({
    context,
    event,
    additionalOptions: {
      redact: redactConfig
    },
  });
  try {
    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;

      logger.info({ encodedKey: record.s3.object.key }, 'Decoding the URI for the key');
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      logger.info({ decodedKey: key }, 'Decoding the URI for the key');

      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key
      });

      logger.info({ key }, 'Retrieving the object');
      const { Metadata, Body } = await s3.send(getObjectCommand);
      logger.info({ key }, 'Object successfully retrieved');

      logger.info({ key }, 'Validating S3 object');
      if (!Metadata) {
        logger.error('Unable to process record: No object metadata found');
        continue;
      }

      const userId = Metadata.userid;

      if (!userId) {
        logger.error('Unable to process record: No user ID found in object metadata');
        continue;
      }


      if (!Body) {
        logger.error('Empty object body provided');
        continue;
      }

      logger.info({ key }, 'Parsing S3 object');

      // Get file contents as a string
      const fileContent = await Body.transformToString();

      const parsedData: EnergyDataRow[] = await new Promise((resolve, reject) => {
        csv.parse(fileContent, {
          columns: true,
          skip_empty_lines: true
        }, (error, records) => {
          if (error) { reject(error); }
          else { resolve(records); }
        });
      })

      logger.info('Filtering valid parsed data');
      const validRecords = parsedData.filter(data => {
        const usage = parseFloat(data['Usage(kWh)']);
        return !isNaN(usage) && data.Date && isValidDateStringInput(data.Date);
      });

      const batchSize = 25;
      logger.info({ key, validRecords }, `Making batches of put requests to the database`);
      for (let i = 0; i < validRecords.length; i += batchSize) {
        const batch = validRecords.slice(i, i + batchSize);
        const putRequests: WriteRequest[] = batch.map(record => {
          return {
            PutRequest: {
              Item: {
                userId: { S: userId },
                date: { S: dateInputStringToDate(record.Date).toISOString() },
                usage: { N: record['Usage(kWh)'] },
                timestamp: { S: new Date().toISOString() }
              }
            },
          };
        });
        const batchWriteCommand = new BatchWriteItemCommand({
          RequestItems: {
            [ENERGY_USAGE_TABLE]: putRequests
          }
        });
        await docClient.send(batchWriteCommand);
      }

      logger.info({ key }, `Successfully processed ${validRecords.length} records for user ${userId}`);
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to process recently uploaded file');
    throw error;
  }
}
