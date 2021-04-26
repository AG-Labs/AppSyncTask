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
    /** -- Landing area --
     * This section of the code contains the resources required to deal with new data
     * translation of it and the loading of it into a suitable data store.
     *
     * Resources used:
     * Bucket - Can be used to dump data to be uploaded to the table
     * DynamoDB table - For storing of the processed data where it can be interrogated
     * A Node Lambda and is associated Role - Reads csv files placed in the landing bucket and performs minor processing before uploaded to the database in batches
     */

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

    /** -- Processing --
     * This section of the code contains the resources required to interigate and modify the data store
     * the resulting url for the api created will be provided as an output of the template, this will
     * be visible in the cloudformation console or in the users's terminal when deploying from the cdk
     * commands.
     *
     * The resources in this section comprise:
     * Cognito User Pool and client - allowing for access to the api from a user without AWS console access
     * AppSync GraphQL API - Defines the schema which powers the api and resolvers to fetch and return data to the user
     * AppSync Data source - Connected to the singular DynamoDB Table defined above but could be expanded to more
     * AppSync Resolvers - Link the schema entries to the relevant data source and map values if needed
     * A Lambda and associated Role - to log any changes made to the DynamoDB table which can be effected through this api
     */

    // Create user pool to allows for non api access to the API
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

    // Create the main API service, specify log configuration and connect to user pool for alternate authorisation option
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

    // Create the dynamo data source that can be specified in the resolvers
    // Then create resolvers for a simple get, list and create api call
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

    // Create a lambda that can log when a change is made to the dynamodb table and link it to our table using
    // an event source pointed to foodDatabase
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

    //Proce the API url as an output to this template
    new CfnOutput(this, "cf-output", {
      value: foodAPI.graphqlUrl,
    });
  }
}
