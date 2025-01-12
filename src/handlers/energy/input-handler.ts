import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DyanmoDBDocumentClient, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient();
const docClient = DynamoDBDocumentClient.from(client);
const ENERGY_USEAGE_TABLE = process.env.ENERGY_USEAGE_TABLE!;

interface EnergyData {
  date: string;
  usage: number;
}

// TODO: Add more errors along the lines of invalid 

export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent) => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing request body' })
      };
    }

    const authorizer = event.requestContext.authorizer;

    const userId: string = authorizer?.claims.sub;

    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ message: 'Unauthorized' })
      };
    }


    const data: EnergyData = JSON.parse(event.body);

    if (!data.date || !data.usage || isNaN(data.usage)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Invalid input data' }),
      };
    }

    const putCommand: PutCommand = new PutCommand({
      TableName: ENERGY_USEAGE_TABLE,
      Item: {
        userId: userId,
        date: data.date,
        usage: data.usage,
        timestamp: new Date().toISOString()
      },
    });

    await docClient.send(putCommand);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Energy data saved successfully'
      })
    };
  } catch (_) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal server error'
      })
    }
  }
}
