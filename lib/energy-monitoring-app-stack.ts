import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export class EnergyMonitoringAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Route 53 and Certificate
    const zone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: 'mattcloudlab.dev',
    });

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: 'api.mattcloudlab.dev',
      validation: acm.CertificateValidation.fromDns(zone),
    });



    // Cognito
    const userPool = new cognito.UserPool(this, 'energy-monitoring-user-pool', {
      selfSignUpEnabled: true,
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
    });

    const userPoolClient = userPool.addClient('EnergyApiClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
    });



    const csvBucket = new s3.Bucket(this, 'energy-monitoring-bucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
    });

    new sns.Topic(this, 'energy-monitoring-alerts-topic', {});


    const energyUseageDB = new dynamodb.Table(this, 'energy-monitoring-dynamo-database', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    energyUseageDB.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    })

    const userThreshholdDB = new dynamodb.Table(this, 'energy-monitoring-user-threshhold-db', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Lambda Functions
    const signupLambda = new nodejs.NodejsFunction(this, 'signup-lambda', {
      handler: 'handler',
      entry: path.join(__dirname, '../src/handlers/auth/signup.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    const signinLambda = new nodejs.NodejsFunction(this, 'signin-lambda', {
      handler: 'handler',
      entry: path.join(__dirname, '../src/handlers/auth/signin.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    const energyInputLambda = new nodejs.NodejsFunction(this, 'energy-input-lambda', {
      handler: 'handler',
      entry: path.join(__dirname, '../src/handlers/energy/input-handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    const getUploadUrlLambda = new nodejs.NodejsFunction(this, 'GetUploadUrlFunction', {
      entry: path.join(__dirname, '../src/handlers/energy/get-upload-url.ts'),
      handler: 'handler',
      environment: {
        BUCKET_NAME: csvBucket.bucketName,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['s3:PutObject'],
          resources: [csvBucket.arnForObjects('*')],
        }),
      ],
    });

    const processUploadLambda = new nodejs.NodejsFunction(this, 'ProcessUploadFunction', {
      entry: path.join(__dirname, '../src/handlers/energy/process-upload.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      environment: {
        TABLE_NAME: energyUseageDB.tableName,
      },
    });



    // Grant Permissions to Lambdas
    energyUseageDB.grantWriteData(energyInputLambda);
    userPool.grant(signupLambda, 'cognito-idp:Signup', 'cognito-idp:AdminConfirmSignUp');
    userPool.grant(signinLambda, 'cognito-idp:InitiateAuth');
    csvBucket.grantRead(processUploadLambda);
    energyUseageDB.grantWriteData(processUploadLambda);


    // Adds in S3 notification for the processing of data 
    csvBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processUploadLambda)
    );


    // API Gateway
    const restApi = new apigateway.RestApi(this, 'energy-monitoring-rest-api-gateway', {
      restApiName: 'Energey Monitoring API',
      domainName: {
        domainName: 'api.mattcloudlab.dev',
        certificate: certificate,
      },
    });

    // Authorizer
    const authorizer = new apigateway.CfnAuthorizer(this, 'CognitoAuthorizer', {
      name: 'CognitoAuthorizer',
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [userPool.userPoolArn],
      restApiId: restApi.restApiId,
    });

    // Auth endpoints
    // /auth
    const authResource = restApi.root.addResource('auth');

    // /auth/signup
    const signupLambdaIntegration = new apigateway.LambdaIntegration(signupLambda);
    const signUpResource = authResource.addResource('signup');
    signUpResource.addMethod('POST', signupLambdaIntegration);

    // /auth/signin
    const signInLambdaIntegration = new apigateway.LambdaIntegration(signinLambda);
    const signInResource = authResource.addResource('signin');
    signInResource.addMethod('POST', signInLambdaIntegration);


    // Eneregy endpoints
    const energyResource = restApi.root.addResource('energy');

    // /energy/input
    const energyInputLambdaIntegration = new apigateway.LambdaIntegration(energyInputLambda);
    const energyInputResource = energyResource.addResource('input');
    energyInputResource.addMethod('POST', energyInputLambdaIntegration, {
      authorizer: { authorizerId: authorizer.ref },
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // /energy/upload
    const energyDataUploadResource = energyResource.addResource('upload');
    const energyUploadLambdaIntegration = new apigateway.LambdaIntegration(getUploadUrlLambda);
    energyDataUploadResource.addMethod('POST', energyUploadLambdaIntegration, {
      authorizer: { authorizerId: authorizer.ref },
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });


    // Route53 A Record
    new route53.ARecord(this, 'ApiAliasRecord', {
      zone,
      target: route53.RecordTarget.fromAlias(
        new targets.ApiGateway(restApi)
      ),
      recordName: 'api.mattcloudlab.dev',
    });


    // Outputs
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'ApiUrl', { value: restApi.url });
  }
}