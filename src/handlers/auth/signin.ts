import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { emailRegex } from './util';

const cognito = new CognitoIdentityProvider();
const CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;
interface SignInRequest {
  email: string;
  password: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent) => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing request body' })
      };
    }

    const { email, password }: SignInRequest = JSON.parse(event.body);

    if (!email || !password || !emailRegex.test(email)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing required fields' })
      };
    }

    if (!emailRegex.test(email)) {
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
      throw new Error();
    }

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
    console.error('Error:', error);
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

