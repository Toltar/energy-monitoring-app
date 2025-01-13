import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayEvent, APIGatewayProxyHandler, Context } from 'aws-lambda';
import { createLogger, redactConfig } from '../utils/logger';
import { emailRegex } from '../utils/email';

const cognito = new CognitoIdentityProvider();
const CLIENT_ID = process.env.CLIENT_ID;
interface SignInRequest {
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

    const { email, password }: SignInRequest = JSON.parse(event.body);

    logger.info({ email }, 'Processing signin request');

    if (!email || !password) {
      logger.warn({ email }, 'Missing required fields');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required fields' })
      };
    }

    if (!emailRegex.test(email)) {
      logger.warn({ email }, 'Email failed validation');
      return {
        statusCode: 400,
        body: JSON.stringify({ message: `Invalid email of: ${email}` })
      };
    }

    const { AuthenticationResult } = await cognito.initiateAuth({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password
      }
    });

    if (!AuthenticationResult) {
      logger.error('Authentication result is undefined');
      throw new Error();
    }

    logger.info({ email }, 'User authenticated successfully');

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Successfully authenticated',
        tokens: {
          accessToken: AuthenticationResult.AccessToken,
          idToken: AuthenticationResult.IdToken,
          refreshToken: AuthenticationResult.RefreshToken
        }
      })
    };
  }
  catch (error) {
    logger.error({ err: error }, 'Authentication Failed');
    if (error && error instanceof Error) {
      return {
        statusCode: error.name === 'NotAuthorizedException' ? 401 : 500,
        body: JSON.stringify({
          message: error.message || 'Error during authentication'
        })
      }
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Fatal Error'
      })
    };
  }
}

