import { CognitoIdentityProvider } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { emailRegex } from './util';

const cognito = new CognitoIdentityProvider();
const USER_POOL_ID = process.env.USER_POOL_ID!;
const CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;

interface SignUpRequest {
  email: string;
  password: string;
  name: string;
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayEvent) => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: 'Missing request body' })
      };
    }
    const { email, password }: SignUpRequest = JSON.parse(event.body);

    if (!email || !password) {
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

    const signUpResult = await cognito.signUp({
      ClientId: CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
      ]
    });


    await cognito.adminConfirmSignUp({
      UserPoolId: USER_POOL_ID,
      Username: email
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'User registration successful',
        userId: signUpResult.UserSub
      }),
    };
  } catch (error) {
    console.error('Error:', error);
    if (error && error instanceof Error) {
      return {
        statusCode: error.name === 'UsernameExistsException' ? 409 : 500,
        body: JSON.stringify({
          message: error.message || 'Error during registration'
        })
      };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Fatal Error' })
    };
  };
}
