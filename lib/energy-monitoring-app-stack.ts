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
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface EnergyMonitoringStackProps extends cdk.StackProps {
  apiDomainName?: string;
  domainName?: string;
};

export class EnergyMonitoringAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EnergyMonitoringStackProps) {
    super(scope, id, props);

    // VPC Configuration
    const vpc = new ec2.Vpc(this, 'energy-monitoring-vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        },
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
      ],
    });


    vpc.addGatewayEndpoint('energy-monitoring-dynamodb-gateway-endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    vpc.addGatewayEndpoint('energy-monitoring-s3-gatway-endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    vpc.addInterfaceEndpoint('energy-monitoring-sns-gateway-endpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SNS,
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'energy-monitoring-lambda-sg', {
      vpc,
      description: 'Security group for the Lambda functions',
      allowAllOutbound: true
    });

    // Route 53 and Certificate
    const zone = props.domainName !== undefined ? route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: props.domainName,
    }) : undefined;

    const certificate = props.apiDomainName !== undefined ? new acm.Certificate(this, 'Certificate', {
      domainName: props.apiDomainName,
      validation: acm.CertificateValidation.fromDns(zone),
    }) : undefined;

    // API Gateway
    const apiDomainName: apigateway.DomainNameOptions | undefined = props.apiDomainName !== undefined && certificate !== undefined ? {
      domainName: props.apiDomainName,
      certificate: certificate
    } : undefined;
    const restApi = new apigateway.RestApi(this, 'energy-monitoring-rest-api-gateway', {
      restApiName: 'Energey Monitoring API',
      domainName: apiDomainName
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

    // S3
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

    // SNS
    const alertsTopic = new sns.Topic(this, 'energy-monitoring-alerts-topic', {
      displayName: 'Energy Useage Alert'
    });


    // DynamoDB
    const energyUsageTable = new dynamodb.Table(this, 'energy-monitoring-dynamo-database', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'date', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    const alertsTable = new dynamodb.Table(this, 'energy-monitoring-user-threshhold-alerts-db', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    // Cloudwatch
    const logGroup = new logs.LogGroup(this, 'lambda-log-group', {
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    new logs.MetricFilter(this, 'error-metrics-filter', {
      logGroup,
      filterPattern: logs.FilterPattern.literal('{ $.level = "ERROR" }'),
      metricNamespace: 'EnergyMonitor',
      metricName: 'ErrorCount',
      defaultValue: 0,
      metricValue: '1'
    });


    // Lambda Functions
    const commonLambdaConfig = {
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [lambdaSecurityGroup],
      logGroup,
      tracing: lambda.Tracing.ACTIVE,
      bundling: {
        sourceMap: true
      }
    };
    const commonLambdaEnvironment = {
      LOG_LEVEL: 'INFO',
      NODE_OPTIONS: '--enable-source-maps'
    }

    const signupLambda = new nodejs.NodejsFunction(this, 'signup-lambda', {
      entry: path.join(__dirname, '../src/handlers/auth/signup.ts'),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });

    const signinLambda = new nodejs.NodejsFunction(this, 'signin-lambda', {
      entry: path.join(__dirname, '../src/handlers/auth/signin.ts'),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });

    const energyInputLambda = new nodejs.NodejsFunction(this, 'energy-input-lambda', {
      entry: path.join(__dirname, '../src/handlers/energy/input-handler.ts'),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: userPoolClient.userPoolClientId,
        ENERGY_USAGE_TABLE: energyUsageTable.tableName,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });

    const getUploadUrlLambda = new nodejs.NodejsFunction(this, 'energy-get-upload-url-lambda', {
      entry: path.join(__dirname, '../src/handlers/energy/get-upload-url.ts'),
      environment: {
        BUCKET_NAME: csvBucket.bucketName,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });

    const processUploadLambda = new nodejs.NodejsFunction(this, 'energy-useage-process-upload-lambda', {
      entry: path.join(__dirname, '../src/handlers/event-handlers/process-upload.ts'),
      timeout: cdk.Duration.minutes(5),
      environment: {
        ENERGY_USAGE_TABLE: energyUsageTable.tableName,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });


    const manageAlertsLambda = new nodejs.NodejsFunction(this, 'energy-useage-alert-manager-lambda', {
      entry: path.join(__dirname, '../src/handlers/energy/manage-alerts.ts'),
      environment: {
        ALERTS_TABLE: alertsTable.tableName,
        SNS_TOPIC_ARN: alertsTopic.topicArn,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });


    const checkThresholdsFromIncomingDataLambda = new nodejs.NodejsFunction(this, 'energy-useage-incoming-data-alert-lambda', {
      entry: path.join(__dirname, '../src/handlers/event-handlers/check-alerts-with-incoming-data.ts'),
      environment: {
        ALERTS_TABLE: alertsTable.tableName,
        SNS_TOPIC_ARN: alertsTopic.topicArn,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });


    const historyLambda = new nodejs.NodejsFunction(this, 'energy-monitoring-history-lambda', {
      entry: path.join(__dirname, '../src/handlers/energy/get-history.ts'),
      environment: {
        ENERGY_USAGE_TABLE: energyUsageTable.tableName,
        ...commonLambdaEnvironment
      },
      ...commonLambdaConfig
    });

    // Lambda Event Sources
    checkThresholdsFromIncomingDataLambda.addEventSource(new DynamoEventSource(energyUsageTable, {
      startingPosition: lambda.StartingPosition.LATEST
    }));

    // Grant Permissions to Lambdas
    alertsTopic.grantSubscribe(manageAlertsLambda);
    alertsTopic.grantPublish(checkThresholdsFromIncomingDataLambda);
    alertsTable.grantReadWriteData(manageAlertsLambda);
    alertsTable.grantReadData(checkThresholdsFromIncomingDataLambda);
    energyUsageTable.grantReadData(checkThresholdsFromIncomingDataLambda);
    energyUsageTable.grantReadData(historyLambda);
    energyUsageTable.grantWriteData(energyInputLambda);
    userPool.grant(signupLambda, 'cognito-idp:Signup', 'cognito-idp:AdminConfirmSignUp');
    userPool.grant(signinLambda, 'cognito-idp:InitiateAuth');
    csvBucket.grantRead(processUploadLambda);
    csvBucket.grantWrite(getUploadUrlLambda);
    energyUsageTable.grantWriteData(processUploadLambda);


    // Adds in S3 notification for the processing of data 
    csvBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(processUploadLambda)
    );



    // Authorizer
    const authorizer = new apigateway.CfnAuthorizer(this, 'CognitoAuthorizer', {
      name: 'CognitoAuthorizer',
      type: 'COGNITO_USER_POOLS',
      identitySource: 'method.request.header.Authorization',
      providerArns: [userPool.userPoolArn],
      restApiId: restApi.restApiId,
    });

    const commonAuthorizerProps: apigateway.MethodOptions = {
      authorizer: { authorizerId: authorizer.attrAuthorizerId },
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

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
    energyInputResource.addMethod('POST', energyInputLambdaIntegration, commonAuthorizerProps);

    // /energy/upload
    const energyDataUploadResource = energyResource.addResource('upload');
    const energyUploadLambdaIntegration = new apigateway.LambdaIntegration(getUploadUrlLambda);
    energyDataUploadResource.addMethod('POST', energyUploadLambdaIntegration, commonAuthorizerProps);

    // /energy/history
    const energyHistoryResource = energyResource.addResource('history');
    const energyHistoryLambdaIntegration = new apigateway.LambdaIntegration(historyLambda);
    energyHistoryResource.addMethod('GET', energyHistoryLambdaIntegration, {
      requestParameters: {
        'method.request.querystring.startDate': true,
        'method.request.querystring.endDate': true,
      },
      ...commonAuthorizerProps
    });

    // /alerts
    const alerts = restApi.root.addResource('alerts');
    const manageAlertsLambdaIntegration = new apigateway.LambdaIntegration(manageAlertsLambda);
    alerts.addMethod('POST', manageAlertsLambdaIntegration, commonAuthorizerProps);


    // Route53 A Record
    if (props.apiDomainName && zone) {
      new route53.ARecord(this, 'ApiAliasRecord', {
        zone,
        target: route53.RecordTarget.fromAlias(
          new targets.ApiGateway(restApi)
        ),
        recordName: props.apiDomainName,
      });
    }


    // Outputs
    new cdk.CfnOutput(this, 'VpcId', { value: vpc.vpcId });
    new cdk.CfnOutput(this, 'PrivateSubnets', { value: vpc.privateSubnets.map(subnet => subnet.subnetId).join(',') });
    new cdk.CfnOutput(this, 'PublicSubnets', { value: vpc.publicSubnets.map(subnet => subnet.subnetId).join(',') });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'ApiUrl', { value: restApi.url });
    new cdk.CfnOutput(this, 'ApiDomainName', { value: props.apiDomainName ? props.apiDomainName : '' });
  }
}
