const fs = require("fs");

// Automatically reads from .in files in grader/testfiles
var testfiles = {};
fs.mkdir("grader/testcases", function(err) {
  console.log(err || "testcases already exists");
});
var files = fs
  .readdirSync("grader/testcases")
  .filter(str => str.indexOf(".out") != -1);
for (var i = 0; i < files.length; i++) {
  let outfile = files[i];
  let result = Number(fs.readFileSync(`grader/testcases/${outfile}`));
  let infile = outfile.replace(".out", ".in");
  testfiles[infile] = result;
}

module.exports = {
  testfiles,
  // large tests, with minimum time taken. Any less and cheating is likely
  largeTests: {
    // "2.in": 1000
  },
  // In milliseconds
  executionTimeout: 20000,
  queueName: "processQueue",
  pubSubName: "processPubSub",
  resultsKey: "results",
  nameIdKey: "names",
  secretIdKey: "secrets",
  leaderboardKey: "leaderboard",
  cheatersKey: "cheaters",
  secretsNamesKey: "secretName",
  webServerIP: process.env.SERVER_URL || "127.0.0.1:3000",
  redisConnectionOptions: process.env.REDIS_URL || {},
  validKeys: (process.env.VALID_KEYS || "test1,test2,aaa")
    .split(",")
    .reduce((hash, key) => {
      hash[key] = true;
      return hash;
    }, {})
};
