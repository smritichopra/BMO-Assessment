import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';

export class CdkWoocommerceStack1 extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for static website content
    const wooCommerceAssets = new s3.Bucket(this, 'WooCommerceAssets', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB tables
    const productsTable = new dynamodb.Table(this, 'ProductsTable', {
      partitionKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const cartTable = new dynamodb.Table(this, 'CartTable', {
      partitionKey: { name: 'cartId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ECR repository for Lambda functions
    const ecrRepository = new ecr.Repository(this, 'WooCommerceRepo');

    // Lambda functions for different WooCommerce operations
    const productsFunction = new lambda.Function(this, 'ProductsFunction', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/products'),
      environment: {
        PRODUCTS_TABLE: productsTable.tableName,
      },
    });

    const ordersFunction = new lambda.Function(this, 'OrdersFunction', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/orders'),
      environment: {
        ORDERS_TABLE: ordersTable.tableName,
      },
    });

    const cartFunction = new lambda.Function(this, 'CartFunction', {
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/cart'),
      environment: {
        CART_TABLE: cartTable.tableName,
      },
    });

    // Grant the Lambda functions permissions to access the DynamoDB tables
    productsTable.grantReadWriteData(productsFunction);
    ordersTable.grantReadWriteData(ordersFunction);
    cartTable.grantReadWriteData(cartFunction);

    // API Gateway
    const api = new apigateway.RestApi(this, 'WooCommerceApi', {
      restApiName: 'Woo-Commerce API',
    });

    // API resources and methods
    const productsResource = api.root.addResource('products');
    productsResource.addMethod('GET', new apigateway.LambdaIntegration(productsFunction));
    productsResource.addMethod('POST', new apigateway.LambdaIntegration(productsFunction));

    const ordersResource = api.root.addResource('orders');
    ordersResource.addMethod('GET', new apigateway.LambdaIntegration(ordersFunction));
    ordersResource.addMethod('POST', new apigateway.LambdaIntegration(ordersFunction));

    const cartResource = api.root.addResource('cart');
    cartResource.addMethod('GET', new apigateway.LambdaIntegration(cartFunction));
    cartResource.addMethod('POST', new apigateway.LambdaIntegration(cartFunction));

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(wooCommerceAssets),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/api/products/*': {
          origin: new origins.HttpOrigin(`${api.restApiId}.execute-api.${this.region}.amazonaws.com`),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        '/api/orders/*': {
          origin: new origins.HttpOrigin(`${api.restApiId}.execute-api.${this.region}.amazonaws.com`),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        '/api/cart/*': {
          origin: new origins.HttpOrigin(`${api.restApiId}.execute-api.${this.region}.amazonaws.com`),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
    });

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront URL',
    });

    new cdk.CfnOutput(this, 'APIGatewayURL', {
      value: api.url,
      description: 'API Gateway URL',
    });

    // CodePipeline for CI/CD
    const sourceOutput = new codepipeline.Artifact();
    const buildOutput = new codepipeline.Artifact();

    // Source action
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: 'your-github-username',
      repo: 'your-repo-name',
      oauthToken: cdk.SecretValue.secretsManager('your-github-token'),
      output: sourceOutput,
      branch: 'main',
    });

    // Build action
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
        privileged: true,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'echo "Installing dependencies"',
              'npm install',
            ],
          },
          pre_build: {
            commands: [
              'echo "Logging in to Amazon ECR"',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $REPOSITORY_URI',
            ],
          },
          build: {
            commands: [
              'echo "Building Docker image"',
              'docker build -t $REPOSITORY_URI:latest .',
              'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION',
            ],
          },
          post_build: {
            commands: [
              'echo "Pushing Docker image"',
              'docker push $REPOSITORY_URI:latest',
              'docker push $REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION',
            ],
          },
        },
        artifacts: {
          files: '**/*',
        },
      }),
      environmentVariables: {
        REPOSITORY_URI: { value: ecrRepository.repositoryUri },
      },
    });

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: buildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    // Deploy action
    const deployAction = new codepipeline_actions.LambdaInvokeAction({
      actionName: 'Deploy',
      lambda: productsFunction, // Assuming deployment for productsFunction for simplicity
      userParameters: {
        productsFunctionArn: productsFunction.functionArn,
        ordersFunctionArn: ordersFunction.functionArn,
        cartFunctionArn: cartFunction.functionArn,
      },
    });

    // Define the pipeline
    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: 'WooCommercePipeline',
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction],
        },
        {
          stageName: 'Build',
          actions: [buildAction],
        },
        {
          stageName: 'Deploy',
          actions: [deployAction],
        },
      ],
    });

    // Grant CodePipeline and CodeBuild permissions to interact with ECR
    ecrRepository.grantPullPush(buildProject.role!);
    buildProject.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ecr:GetDownloadUrlForLayer', 'ecr:BatchGetImage', 'ecr:CompleteLayerUpload'],
      resources: [ecrRepository.repositoryArn],
    }));
  }
}
