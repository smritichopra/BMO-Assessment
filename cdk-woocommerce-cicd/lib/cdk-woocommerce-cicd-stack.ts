import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';

export class CdkWoocommerceCicdStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for static website content
    const wooCommerceAssets = new s3.Bucket(this, 'WooCommerceAssets', {
      websiteIndexDocument: 'index.html',
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false
      }),
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

    // ECR repository for container images
    const ecrRepository = new ecr.Repository(this, 'WooCommerceRepo');

    // VPC
    const vpc = new ec2.Vpc(this, 'WooCommerceVPC', {
      maxAzs: 2
    });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'WooCommerceCluster', {
      vpc: vpc
    });

    // Fargate task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'WooCommerceTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Container definition
    const container = taskDefinition.addContainer('WooCommerceContainer', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepository),
      logging: ecs.LogDriver.awsLogs({ streamPrefix: 'WooCommerce' }),
      environment: {
        PRODUCTS_TABLE: productsTable.tableName,
        ORDERS_TABLE: ordersTable.tableName,
        CART_TABLE: cartTable.tableName,
      },
    });

    container.addPortMappings({
      containerPort: 80,
    });

    // Fargate service
    const fargateService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'WooCommerceService', {
      cluster: cluster,
      taskDefinition: taskDefinition,
      publicLoadBalancer: true,
    });

    // Grant the ECS task permissions to access the DynamoDB tables
    productsTable.grantReadWriteData(taskDefinition.taskRole);
    ordersTable.grantReadWriteData(taskDefinition.taskRole);
    cartTable.grantReadWriteData(taskDefinition.taskRole);

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(wooCommerceAssets),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(fargateService.loadBalancer),
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

    new cdk.CfnOutput(this, 'LoadBalancerURL', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer URL',
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
              'echo "Writing image definitions file"',
              'printf \'[{"name":"WooCommerceContainer","imageUri":"%s"}]\' $REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION > imagedefinitions.json',
            ],
          },
        },
        artifacts: {
          files: ['imagedefinitions.json']
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
    const deployAction = new codepipeline_actions.EcsDeployAction({
      actionName: 'Deploy',
      service: fargateService.service,
      input: buildOutput,
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
