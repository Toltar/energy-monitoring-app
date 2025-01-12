#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EnergyMonitoringAppStack } from '../lib/energy-monitoring-app-stack';
import 'dotenv/config';

const app = new cdk.App();
new EnergyMonitoringAppStack(app, 'EnergyMonitoringAppStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  domainName: process.env.DOMAIN_NAME,
  apiDomainName: process.env.API_DOMAIN_NAME
});
