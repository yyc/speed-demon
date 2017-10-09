const fs = require("fs");

// Automatically reads from .in files in grader/testfiles
var testfiles = {};
fs.mkdir("grader/testcases", function(err) {
  console.log(err || "testcases already exists");
});
var files = fs
  .readdirSync("grader/testcases")
  .filter(str => str.indexOf(".in") != -1);
for (var i = 0; i < files.length; i++) {
  let infile = files[i];
  let result = Number(fs.readFileSync(`grader/testcases/${infile}`));
  let outfile = infile.replace(".in", ".out");
  testfiles[outfile] = result;
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
  webServerIP: process.env.SERVER_URL || "127.0.0.1:3000",
  redisConnectionOptions: process.env.REDIS_URL || {}
};
