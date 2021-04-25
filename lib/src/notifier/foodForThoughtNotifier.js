const AWS = require("aws-sdk");

exports.handler = async (event) => {
  event.Records.forEach((record) => {
    const foodName = record.dynamodb.NewImage.food_name.S;
    const group = record.dynamodb.NewImage?.group?.S ?? "not present";
    const subGroup = record.dynamodb.NewImage?.sub_group?.S ?? "not present";
    const scientificName =
      record.dynamodb.NewImage?.scientific_name?.S ?? "not present";
    console.log(`new item successfully created 
      food name: ${foodName}
      Scientific Name: ${scientificName}
      Group: ${group}
      Sub Group: ${subGroup}`);
  });

  return { statusCode: 200 };
};
