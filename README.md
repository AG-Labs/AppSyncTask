# Food For Thought

to deploy this cdk stack run `npm run deploy`. This will deploy all reasources required for an AppSync Backend integrated with dynamoDb and a batch uploader function for populating the database from an S3 bucket.

adding `-- --context stage=prod` to the deploy command will deploy a production instance. Deleting a production instance will not delete you data storage resources.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template
