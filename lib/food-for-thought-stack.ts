import {
  RemovalPolicy,
  Construct,
  Stack,
  StackProps,
  Duration,
} from "@aws-cdk/core";
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
      timeout: Duration.minutes(5),
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
  }
}
