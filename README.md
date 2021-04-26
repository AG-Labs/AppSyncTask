# Food For Thought

To deploy this cdk stack run `npm run deploy`. This will deploy all reasources required for an AppSync Backend integrated with dynamoDb and a batch uploader function for populating the database from an S3 bucket.

adding `-- --context stage=prod` to the deploy command will deploy a production instance. Deleting a production instance will not delete you data storage resources.

## /bin

This folder contains the main function which cdk will use to deploy and tag a stack. The stack passes through the account and region information from that which is set in the user's environment.

A further stage context flag will be passed to the cdk command as detailed above as slight different behaviour would be desired in Production environments compared to dev environments.

## /lib

The files in `/lib` define the AWS resources and their interconnections. These are imported from the @aws-cdk pacakges which are a typescript wrapper around CloudFormation.

The CDK constructors comprise of two main sections

```
Landing area
    This section of the code contains the resources required to deal with new data translation of it and the loading of it into a suitable data store.

    Resources used:
        Bucket - Can be used to dump data to be uploaded to the table
        DynamoDB table - For storing of the processed data where it can be interrogated
        A Node Lambda and is associated Role - Reads csv files placed in the landing bucket and performs minor processing before uploaded to the database in batches
```

```
 Processing
    This section of the code contains the resources required to interigate and modify the data store the resulting url for the api created will be provided as an output of the template, this will be visible in the cloudformation console or in the users's terminal when deploying from the cdk commands.

    Resources used:
        Cognito User Pool and client - allowing for access to the api from a user without AWS console access
        AppSync GraphQL API - Defines the schema which powers the api and resolvers to fetch and return data to the user
        AppSync Data source - Connected to the singular DynamoDB Table defined above but could be expanded to more
        AppSync Resolvers - Link the schema entries to the relevant data source and map values if needed
        A Lambda and associated Role - to log any changes made to the DynamoDB table which can be effected through this api
```

### /lib/src

This folder contains the source for two lambda functions that CDK will utilise to create the functions required therein. CDK deals with the upload of the function data to AWS and simply needs pointing to the right location.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
