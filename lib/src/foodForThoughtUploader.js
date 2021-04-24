const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const csvParser = require("csv-parse/lib/sync");
const ddb = new AWS.DynamoDB({ region: "eu-west-2" });

const targetTable = process.env.targetDyanamo;

exports.handler = async (event) => {
  const src_bkt = event.Records[0].s3.bucket.name;
  const src_key = event.Records[0].s3.object.key;

  const data = await s3.getObject({ Bucket: src_bkt, Key: src_key }).promise();
  let parsedData = parseData(data.Body.toString());

  let loopCounter = 0;

  while (parsedData.length !== 0) {
    let block = parsedData.splice(0, 25);

    let batchParams = block.map((item) => {
      return {
        PutRequest: {
          Item: {
            SCIENTIFIC_NAME: { S: item.SCIENTIFIC_NAME },
            FOOD_NAME: { S: item.FOOD_NAME },
            GROUP: { S: item.FOOD_NAME },
            SUB_GROUP: { S: item.SUB_GROUP },
          },
        },
      };
    });
    console.log(`preparing to upload batch ${loopCounter}`);
    try {
      await ddb
        .batchWriteItem({ RequestItems: { [targetTable]: batchParams } })
        .promise();
    } catch (error) {
      //dynamo error check for missed items and can spread the array back
      //into parsed data for another attmept, would need escape hatch for if
      //there is a fundamental issue to the upload of that object,
      console.log(error);
    }
    loopCounter++;
  }

  // Call DynamoDB to add the item to the table

  return { statusCode: 200, body: { hello: "there" } };
};

let parseData = (s3Data) => {
  let parsedData = csvParser(s3Data, {
    columns: true,
    skipEmptyLines: true,
    cast: (value, context) => {
      if (context.header) {
        return value.toUpperCase().replace(/\s/g, "_");
      } else return value;
    },
  });
  return parsedData;
};

exports.parseData = parseData;
