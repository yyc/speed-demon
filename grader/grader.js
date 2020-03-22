"use strict";

let bluebird = require("bluebird");
let redis = require("redis");
let cw = require("core-worker");
let fs = require("fs");

var constants = require("../constants");
var testfiles = constants.testfiles;

let db = redis.createClient(constants.redisConnectionOptions);
let sub = redis.createClient(constants.redisConnectionOptions);
sub.subscribe(constants.pubSubName);

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

var mutex = false;
// Processes any pending jobs in the queue,
// or waits for a pubsub
function start() {
  listen();
}

["grader/java", "downloads"].forEach(folder => {
  fs.mkdir(folder, function(err) {
    console.log(err || `${folder} already exists`);
  });
});

function messagePromise() {
  return new Promise((resolve, reject) => {
    sub.once("message", (channel, message) => {
      resolve();
    });
  });
}

async function listen() {
  while (true) {
    let length = await db.llenAsync(constants.queueName);
    if (length == 0) {
      await messagePromise();
    } else {
      await process();
    }
  }
}

async function process() {
  let filedata_str = await db.lpopAsync(constants.queueName);

  // someone beat us to the punch
  if (filedata_str == null) {
    return listen();
  }
  let filedata = JSON.parse(filedata_str);
  let folderkey = filedata["key"];
  let { classname } = filedata;
  console.log(filedata);

  try {
    if (filedata.type == "zip") {
      await cw
        .process(
          `wget -q -P downloads ${constants.webServerIP}/uploads/${folderkey}`
        )
        .death();

      await cw
        .process(
          `unzip -j -o -d grader/java/${folderkey} downloads/${folderkey}`
        )
        .death();
    } else {
      await cw.process(`mkdir grader/java/${folderkey}`).death();
      await cw
        .process(
          `wget -O grader/java/${folderkey}/${classname}.java ${constants.webServerIP}/uploads/${folderkey}`
        )
        .death();
    }
  } catch (e) {
    return await error(filedata, "Download Error");
  }
  let compileProcess;
  try {
    let command = `javac -cp ./grader/java/${folderkey} ./grader/java/${folderkey}/${classname}.java`;
    compileProcess = cw.process(command, /.+/);
    await compileProcess.death();
  } catch (e) {
    console.log();
    var output = compileProcess.instance.instance.output
      .join("")
      .replace(/<error>/g, "");
    return await error(filedata, output);
  }
  return test(filedata);
}

function error(filedata, err) {
  console.error(filedata, err);
  return complete(filedata, { success: false, results: {}, compileError: err });
}

function test(filedata) {
  var files = Object.keys(testfiles);
  return runTestCase(filedata, files, { success: false, results: {} });
}

async function runTestCase(filedata, files, result) {
  if (files.length == 0) {
    result.success = true;
    try {
      return await complete(filedata, result);
    } catch (e) {
      console.error(e);
    }
    return;
  }
  let startTime = Date.now();
  let filename = files.shift();
  let command = `java -classpath grader/java/${filedata.key} -Xmx1500m ${filedata.classname} grader/testcases/${filename}`;
  console.log(command);
  var proc = cw.process(command, /[0-9]+/);

  setTimeout(() => {
    if (proc.instance.instance.isRunning) {
      proc.kill();
    }
  }, constants.executionTimeout);

  try {
    await proc.death();
  } catch (error) {
    // Kill the program if it times out
    result.results[filename] = false;
    if (Date.now() - startTime > constants.executionTimeout) {
      result.runtimeError = "Time Limit Exceeded";
    } else {
      console.error(`exec error for ${command}: ${error}`);
      // It's possible to abuse the runtimeError to get the test data, so truncate that
      result.runtimeError = proc.instance.instance.output;
    }
    return await complete(filedata, result);
  }

  let output = proc.instance.instance.output.join("");
  console.log(`completed ${filename} ${output}`);
  if (output == testfiles[filename]) {
    let runtime = Date.now() - startTime;
    if (
      constants.largeTests[filename] &&
      runtime < constants.largeTests[filename]
    ) {
      result.results = [];
      result.runtimeError =
        "CHEATING DETECTED\nHardcoding is not appreciated >:(";
      db.zadd(constants.cheatersKey, runtime, filedata.name);
      return await complete(filedata, result);
    }
    result.results[filename] = runtime;
    return await runTestCase(filedata, files, result);
  } else {
    result.results[filename] = false;
    if (output.includes("<error>")) {
      console.log(output);
      result.runtimeError = output.replace(/<error>/g, "");
    } else {
      result.runtimeError = "Wrong Answer";
    }
    return await complete(filedata, result);
  }
}

async function complete(filedata, results) {
  if (results.success) {
    var time = Object.values(results.results).reduce(
      (acc, value) => acc + value,
      0
    );
    results.time = time;
  }
  console.log(constants.resultsKey, filedata.key, JSON.stringify(results));
  let promises = [
    db.hsetAsync(constants.resultsKey, filedata.key, JSON.stringify(results))
  ];

  if (results.success) {
    console.log(constants.leaderboardKey, time, filedata.name);
    let name = await db.hgetAsync(constants.secretsNamesKey, filedata.secret);
    console.log(name);

    if (name != null && name != undefined) {
      console.log(`remove ${constants.leaderboardKey}, ${name}`);
      promises.push(db.zremAsync(constants.leaderboardKey, name));
    }

    promises.push(
      db.hsetAsync(constants.secretsNamesKey, filedata.secret, name)
    );
    promises.push(db.zaddAsync(constants.leaderboardKey, time, filedata.name));
  }
  await Promise.all(promises);
}

start();
module.exports = start;
