"use strict";

const bluebird = require("bluebird");
const redis = require("redis");
const fs = require("fs");
const csv = require("csv-parser");

const constants = require("../constants");
const { testfiles, redisConnectionOptions } = constants;

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

console.log(process.argv);
if (process.argv.length < 2) {
  console.log("Please specify the name of the csv file to be used");
}

let filename = process.argv[2];
let promises = [];
let db = redis.createClient(redisConnectionOptions);

fs.createReadStream(filename)
  .pipe(csv(["name", "secret"]))
  .on("data", data =>
    promises.push(
      db.hsetAsync(constants.secretsNamesKey, data.secret, data.name)
    )
  )
  .on("end", async () => {
    await Promise.all(promises);
    let results = await db.hgetallAsync(constants.secretsNamesKey);
    console.log(results.length);
    console.log(results);
  });
