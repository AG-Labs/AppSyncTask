import { RemovalPolicy, Construct, Stack, StackProps } from "@aws-cdk/core";
import {
  Bucket,
  BucketAccessControl,
  BucketEncryption,
  EventType,
} from "@aws-cdk/aws-s3";
import { Function, Runtime, Code } from "@aws-cdk/aws-lambda";
import { S3EventSource } from "@aws-cdk/aws-lambda-event-sources";
import { Table, AttributeType, BillingMode } from "@aws-cdk/aws-dynamodb";
import {
  GraphqlApi,
  Schema,
  DynamoDbDataSource,
  Resolver,
  MappingTemplate,
  PrimaryKey,
  Assign,
  AttributeValues,
} from "@aws-cdk/aws-appsync";
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "@aws-cdk/aws-iam";

export class FoodForThoughtStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    let landingBucket = new Bucket(this, "landing-bucket", {
      bucketName: `${id}-bucket`.toLowerCase(),
      blockPublicAccess: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      accessControl: BucketAccessControl.PRIVATE,
      encryption: BucketEncryption.KMS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    let foodDatabase = new Table(this, "food-table", {
      partitionKey: { name: "food_name", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    let uploadRole = new Role(this, "upload-role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        new ManagedPolicy(this, "upload-policy", {
          statements: [
            new PolicyStatement({
              sid: "allowServices",
              effect: Effect.ALLOW,
              resources: ["*"],
              actions: ["kms:*", "s3:*", "lambda:*", "logs:*", "dynamodb:*"],
            }),
          ],
        }),
      ],
    });

    let dynamoUpload = new Function(this, `upload-function`, {
      functionName: `${id}-upload-function`,
      runtime: Runtime.NODEJS_14_X,
      code: Code.fromAsset("./lib/src"),
      handler: "foodForThoughtUploader.handler",
      description: "A function that takes our data and loads it into dynamodb",
      events: [
        new S3EventSource(landingBucket, {
          events: [EventType.OBJECT_CREATED],
        }),
      ],
      environment: { targetDyanamo: foodDatabase.tableName },
      role: uploadRole,
    });

    let foodAPI = new GraphqlApi(this, "food-graph-api", {
      name: `${id}-graphql-api`,
      schema: Schema.fromAsset("./lib/schema.graphql"),
    });
    let foodAPISource = new DynamoDbDataSource(this, "food-graph-source", {
      api: foodAPI,
      table: foodDatabase,
      description: "generic food source for GraphQL",
      name: "Generic_Food",
    });

    let getGenericResolver = new Resolver(this, "get-generic-resolver", {
      api: foodAPI,
      typeName: "Query",
      fieldName: "getGenericFood",
      dataSource: foodAPISource,
      requestMappingTemplate: MappingTemplate.dynamoDbGetItem(
        "food_name",
        "food_name",
      ),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    });

    // let listGenericResolver = new Resolver(this, "list-generic-resolver", {
    //   api: foodAPI,
    //   typeName: "Query",
    //   fieldName: "listGenericFoods",
    //   dataSource: foodAPISource,
    //   requestMappingTemplate: MappingTemplate.dynamoDbScanTable(),
    //   responseMappingTemplate: MappingTemplate.dynamoDbResultList(),
    // });
    let createGenericResolver = new Resolver(this, "create-generic-resolver", {
      api: foodAPI,
      typeName: "Mutation",
      fieldName: "createGenericFood",
      dataSource: foodAPISource,
      requestMappingTemplate: MappingTemplate.dynamoDbPutItem(
        new PrimaryKey(new Assign("food_name", "food_name")),
        new AttributeValues("container", [
          new Assign("scientific_name", "scientific_name"),
          new Assign("group", "group"),
          new Assign("sub_group", "sub_group"),
        ]),
      ),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    });
  }
}

/*
{
    "version" : "2017-02-28",
    "operation" : "PutItem",
    "key" : {
        "food_name" : $util.dynamodb.toDynamoDBJson($context.arguments.food_name)
    },
    "attributeValues" : {
        "group" : $util.dynamodb.toDynamoDBJson($context.arguments.group),
        "sub_group" : $util.dynamodb.toDynamoDBJson($context.arguments.sub_group),
        "scientific_name" : $util.dynamodb.toDynamoDBJson($context.arguments.scientific_name),
	} 
}


correct resolver for list item but does not pass through generic food connetction

{
    "version" : "2017-02-28",
    "operation" : "Scan",
    "filter" : {
        "expression" : "begins_with(food_name, :food_name)",
        "expressionValues" : {
            ":food_name" : $util.dynamodb.toDynamoDBJson($context.arguments.filter.food_name.beginsWith)
        },
    },
    ## Add 'limit' and 'nextToken' arguments to this field in your schema to implement pagination. **
    "limit": $util.defaultIfNull(${ctx.args.limit}, 20),
    "nextToken": $util.toJson($util.defaultIfNullOrBlank($ctx.args.nextToken, null))
}
$util.toJson($context.result.items)
*/
