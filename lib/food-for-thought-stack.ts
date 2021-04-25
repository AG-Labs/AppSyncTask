import {
  RemovalPolicy,
  Construct,
  Stack,
  StackProps,
  Duration,
  CfnOutput,
} from "@aws-cdk/core";
import {
  Bucket,
  BucketAccessControl,
  BucketEncryption,
  EventType,
} from "@aws-cdk/aws-s3";
import { Function, Runtime, Code, StartingPosition } from "@aws-cdk/aws-lambda";
import {
  S3EventSource,
  DynamoEventSource,
} from "@aws-cdk/aws-lambda-event-sources";
import {
  Table,
  AttributeType,
  BillingMode,
  StreamViewType,
} from "@aws-cdk/aws-dynamodb";
import {
  GraphqlApi,
  Schema,
  DynamoDbDataSource,
  Resolver,
  MappingTemplate,
  PrimaryKey,
  Assign,
  AttributeValues,
  FieldLogLevel,
  AuthorizationType,
} from "@aws-cdk/aws-appsync";
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "@aws-cdk/aws-iam";
import { UserPool, UserPoolClient } from "@aws-cdk/aws-cognito";

export interface IFoodForThoughtStack extends StackProps {
  stage: string;
}

export class FoodForThoughtStack extends Stack {
  constructor(scope: Construct, id: string, props: IFoodForThoughtStack) {
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
      removalPolicy:
        props.stage === "dev" ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: props.stage === "dev" ? true : false,
    });

    let foodDatabase = new Table(this, "food-table", {
      partitionKey: { name: "food_name", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        props.stage === "dev" ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      stream: StreamViewType.NEW_IMAGE,
    });

    let uploadRole = new Role(this, "upload-role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        new ManagedPolicy(this, "upload-policy", {
          statements: [
            new PolicyStatement({
              sid: "allowServices",
              effect: Effect.ALLOW,
              resources: [`*`],
              actions: ["kms:*", "s3:*", "lambda:*", "logs:*", "dynamodb:*"],
            }),
          ],
        }),
      ],
    });

    let dynamoUpload = new Function(this, `upload-function`, {
      functionName: `${id}-upload-function`,
      runtime: Runtime.NODEJS_14_X,
      code: Code.fromAsset("./lib/src/uploader"),
      handler: "foodForThoughtUploader.handler",
      description: "A function that takes our data and loads it into dynamodb",
      events: [
        new S3EventSource(landingBucket, {
          events: [EventType.OBJECT_CREATED],
        }),
      ],
      environment: { targetDyanamo: foodDatabase.tableName },
      role: uploadRole,
      timeout: Duration.minutes(5),
    });

    let APIUserPool = new UserPool(this, "food-user-pool", {
      removalPolicy:
        props.stage === "dev" ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      userPoolName: `${id}-user-pool`,
    });

    let userPoolClient = new UserPoolClient(this, "food-user-pool-client", {
      userPool: APIUserPool,
      userPoolClientName: `${id}-client`,
      authFlows: { userPassword: true, userSrp: true },
    });

    let foodAPI = new GraphqlApi(this, "food-graph-api", {
      name: `${id}-graphql-api`,
      schema: Schema.fromAsset("./lib/schema.graphql"),
      logConfig: {
        fieldLogLevel: FieldLogLevel.ALL,
      },
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.API_KEY,
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.USER_POOL,
            userPoolConfig: {
              userPool: APIUserPool,
            },
          },
        ],
      },
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

    let listGenericResolver = new Resolver(this, "list-generic-resolver", {
      api: foodAPI,
      typeName: "Query",
      fieldName: "listGenericFoods",
      dataSource: foodAPISource,
      requestMappingTemplate: MappingTemplate.dynamoDbScanTable(),
      responseMappingTemplate: MappingTemplate.dynamoDbResultList(),
    });

    let createGenericReolver = new Resolver(this, "create-generic-resolver", {
      api: foodAPI,
      typeName: "Mutation",
      fieldName: "createGenericFood",
      dataSource: foodAPISource,
      requestMappingTemplate: MappingTemplate.dynamoDbPutItem(
        new PrimaryKey(new Assign("food_name", "$ctx.args.input.food_name")),
        new AttributeValues("$ctx.args.input"),
      ),
      responseMappingTemplate: MappingTemplate.dynamoDbResultItem(),
    });

    let notifierRole = new Role(this, "notifier-role", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        new ManagedPolicy(this, "notifier-policy", {
          statements: [
            new PolicyStatement({
              sid: "allowServices",
              effect: Effect.ALLOW,
              resources: [`*`],
              actions: [
                "kms:*",
                "s3:*",
                "lambda:*",
                "logs:*",
                "dynamodb:*",
                "appsync:*",
              ],
            }),
          ],
        }),
      ],
    });

    let notifierFunc = new Function(this, "notifier-function", {
      functionName: `${id}-notifier-function`,
      runtime: Runtime.NODEJS_14_X,
      code: Code.fromAsset("./lib/src/notifier"),
      handler: "foodForThoughtNotifier.handler",
      description:
        "A function called by AppSync that logs a change so it can be seen in cloudwatch",
      role: notifierRole,
      timeout: Duration.minutes(5),
      events: [
        new DynamoEventSource(foodDatabase, {
          startingPosition: StartingPosition.LATEST,
          retryAttempts: 2,
        }),
      ],
    });

    new CfnOutput(this, "cf-output", {
      value: foodAPI.graphqlUrl,
    });
  }
}
