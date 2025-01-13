import { CognitoIdentityProviderClient, SignUpCommand, AdminConfirmSignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, redactConfig } from '../utils/logger';
import { emailRegex } from '../utils/email';

const cognito = new CognitoIdentityProviderClient();
const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;

interface SignUpRequest {
  email: string;
  password: string;
}

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
    const { email, password }: SignUpRequest = JSON.parse(event.body);
    logger.info({ email }, 'Processing signup request');

    if (!email || !password) {
      logger.warn('Missing required fields');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required fields' })
      };
    }

    if (!emailRegex.test(email)) {
      logger.warn({ email }, 'Invalid email');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: `Invalid email of: ${email}` })
      };
    }

    const signUpResult = await cognito.send(new SignUpCommand({
      ClientId: CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
      ]
    }));

    logger.info({ userId: signUpResult.UserSub }, 'User signup successful');

    await cognito.send(new AdminConfirmSignUpCommand({
      UserPoolId: USER_POOL_ID,
      Username: email
    }));

    logger.info({ userId: signUpResult.UserSub }, 'User confirmation successful');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'User registration successful',
        userId: signUpResult.UserSub
      }),
    };
  } catch (error) {
    if (error instanceof Error) {
      logger.error({ err: error, message: error.message }, 'Signup process failed');
      return {
        statusCode: error.name === 'UsernameExistsException' ? 409 : 500,
        body: JSON.stringify({
          message: error.message || 'Error during registration'
        })
      };
    }
    logger.error({ err: error }, 'Signup process failed');
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Fatal Error' })
    };
  };
}
