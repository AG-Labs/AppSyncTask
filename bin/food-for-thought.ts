#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { FoodForThoughtStack } from "../lib/food-for-thought-stack";

const app = new cdk.App();

let stage = "dev";
let identifier = "";

if (app.node.tryGetContext("stage") === "prod") {
  stage = "prod";
}
if (app.node.tryGetContext("id")) {
  identifier = identifier + "-" + app.node.tryGetContext("id");
}
let foodForThoughtStack = new FoodForThoughtStack(
  app,
  `FoodForThought${identifier}`,
  {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION,
    },
    stage,
  },
);

cdk.Tags.of(foodForThoughtStack).add("project", "food-for-thought");
