import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export class CdkWoocommerceStack extends cdk.Stack {
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
      // publicReadAccess: true,
      
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
  }
}
