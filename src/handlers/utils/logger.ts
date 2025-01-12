import pino from 'pino';
import { Context, APIGatewayProxyEvent, S3Event } from 'aws-lambda';

interface LoggerOptions {
  context?: Context;
  event?: APIGatewayProxyEvent | S3Event;
  additionalOptions?: pino.LoggerOptions;
}

export function createLogger({ context, event, additionalOptions = {} }: LoggerOptions = {}) {
  const eventBaseProps = (event !== undefined && 'Records' in event) || event === undefined ?
    {} : {
      path: event.path,
      method: event.httpMethod,
      cognitoUser: event.requestContext.identity.cognitoIdentityId
    };
  const baseOptions: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}`,
    formatters: {
      level: (label) => {
        return { level: label };
      }
    },
    base: {
      requestId: context?.awsRequestId,
      functionName: context?.functionName,
      functionVersion: context?.functionVersion,
      ...eventBaseProps
    }
  };

  const options: pino.LoggerOptions = {
    ...baseOptions,
    ...additionalOptions,
    formatters: {
      ...baseOptions.formatters,
      ...additionalOptions.formatters
    }
  };

  const logger = pino(options);

  return logger;
}

export const redactConfig = {
  paths: ['password', 'authorization', 'access_token', 'refresh_token'],
  censor: '[REDACTED]'
};

