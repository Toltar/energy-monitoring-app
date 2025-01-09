import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';


export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent) => {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ message: `Hello, world from ${event.path}` }),
  };
}
