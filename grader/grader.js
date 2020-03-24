"use strict";

let bluebird = require("bluebird");
let redis = require("redis");
let cw = require("core-worker");
let fs = require("fs");

const constants = require("../constants");
const testfiles = constants.testfiles;
const { getDockerProcess, getExecutionTimeAllotment } = require("./utils");

let db = redis.createClient(constants.redisConnectionOptions);
let sub = redis.createClient(constants.redisConnectionOptions);
sub.subscribe(constants.pubSubName);

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

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
  let queueLength = 0;
  while (true) {
    queueLength = await db.llenAsync(constants.queueName);
    if (queueLength == 0) {
      await messagePromise();
    } else {
      await processTestCase(getExecutionTimeAllotment(queueLength));
    }
  }
}

async function processTestCase(timeAllotment) {
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
    compileProcess = getDockerProcess(
      `javac -cp /submission ./submission/${classname}.java`,
      [`grader/java/${folderkey}:/submission`]
    );
    await compileProcess.death();
  } catch (e) {
    console.error(e);
    var output = compileProcess.instance.instance.output
      .join("")
      .replace(/<error>/g, "");
    return await error(filedata, output);
  }
  let files = Object.keys(testfiles);
  return runTestCase(filedata, files, timeAllotment);
}

function error(filedata, err) {
  console.error(filedata, err);
  return complete(filedata, { success: false, results: {}, compileError: err });
}

async function runTestCase(filedata, files, totalTimeout) {
  let result = { success: false, results: {} };
  let proc;
  let timedOut = false;
  setTimeout(() => {
    if (proc.instance.instance.isRunning) {
      timedOut = true;
      proc.kill();
    }
  }, totalTimeout);
  for (let filename of files) {
    let startTime = Date.now();
    proc = getDockerProcess(
      `java -classpath /submission -Xmx1500m ${filedata.classname} /testfile`,
      [
        `grader/java/${filedata.key}:/submission`,
        // mount as readonly, so people can't do funny things like modify the input file
        // Also, only mount the input file so they can't cheat by looking for the .out file
        `grader/testcases/${filename}:/testfile:ro`
      ]
    );

    try {
      await proc.death();
      // Sometimes it gets killed but exits with 0
      if (timedOut) {
        throw Exception();
      }
    } catch (error) {
      // Kill the program if it times out
      result.results[filename] = false;
      if (timedOut) {
        result.runtimeError = "Time Limit Exceeded.";
        if (totalTimeout < constants.timeouts.maxTotalExecution) {
          result.runtimeError +=
            `\nYour submission was given a ${totalTimeout /
              1000}s to finish all test cases, based on the size of the current queue.\n` +
            "If you need more time, try submitting when there are fewer submissions in the queue.";
        }
      } else {
        //console.error(`exec error for ${command}: ${error}`);
        console.error(`exec error: ${error}`);
        // It's possible to abuse the runtimeError to get the test data, so truncate that
        // truncate both the number of lines and the length of each line, so it's exceedingly difficult to get stuff out
        let output_lines = proc.instance.instance.output;
        let output = output_lines
          .slice(0, 50)
          .map(line => line.substring(0, 90));
        result.runtimeError = output.join("\n");
      }
      return await complete(filedata, result);
    }

    let output = proc.instance.instance.output.join("");
    console.log(`completed ${filename} ${output}`);
    if (output == testfiles[filename]) {
      let runtime = Date.now() - startTime;
      result.results[filename] = runtime;
      continue;
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
  result.success = true;
  return await complete(filedata, result);
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
    promises.push(db.zaddAsync(constants.leaderboardKey, time, name));
  }
  await Promise.all(promises);
}

start();
module.exports = start;
