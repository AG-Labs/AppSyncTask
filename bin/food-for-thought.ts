#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { FoodForThoughtStack } from "../lib/food-for-thought-stack";

const app = new cdk.App();

let stage = "dev";
if (app.node.tryGetContext("stage") === "prod") {
  stage = "prod";
}

let foodForThoughtStack = new FoodForThoughtStack(app, "FoodForThought", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  stage,
});

cdk.Tags.of(foodForThoughtStack).add("project", "food-for-thought");
