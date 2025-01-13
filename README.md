# Energy Monitoring API

This is the Energy monitoring API developed with Lambdas and other AWS technologies.

![architecture diagram](diagram.png)

see the architecture diagram in the root directory as well.

## Postman collection

A postman collection is provided for you [here](api.postman_collection.json) for you to use when you have deployed the API.

## Deploying the API

I chose CDK as my IAC solution to deploy the API. To deploy the app do the following(assuming you have an AWS account and account credentials setup correctly in your terminal):

```bash
npx cdk bootstrap

npm run synth

npm run deploy
```

And it should deploy the API for you. You may run into some snags with CDK but just in case you can destroy your stacks with:

```bash
npx cdk destroy
```

Then try to redeploy it again with just `npm run deploy`. No need to re-run `npm run bootstrap` and `npm run synth` again when you did it for the first time.

## API Documentation

You can find the api documentation at the root directory [here](openapi.yaml) within the project in OpenApi 3.0 docs form in YAML. 

## Useful project commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the vite unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
