"use strict";

let bluebird = require("bluebird");
let redis = require("redis");
let cw = require("core-worker");
let fs = require("fs");

const constants = require("../constants");
const testfiles = constants.testfiles;

let db = redis.createClient(constants.redisConnectionOptions);
let sub = redis.createClient(constants.redisConnectionOptions);
sub.subscribe(constants.pubSubName);

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

const cwd = process.cwd();

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
    }
    await processTestCase();
  }
}

async function processTestCase() {
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
  let proc = getDockerProcess(
    `java -classpath /submission -Xmx1500m ${filedata.classname} /testfile`,
    [
      `grader/java/${filedata.key}:/submission`,
      // mount as readonly, so people can't do funny things like modify the input file
      // Also, only mount the input file so they can't cheat by looking for the .out file
      `grader/testcases/${filename}:/testfile:ro`
    ]
  );

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
      // truncate both the number of lines and the length of each line, so it's exceedingly difficult to get stuff out
      let output_lines = proc.instance.instance.output;
      let output = output_lines.slice(0, 50).map(line => line.substring(0, 90));
      result.runtimeError = output.join("\n");
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
    promises.push(db.zaddAsync(constants.leaderboardKey, time, name));
  }
  await Promise.all(promises);
}

/* 
Execute the java code in a docker container. This gives us several advantages:
1. Isolating the code, so they can't mess up the machine we're running the grader on
  NB: if they manage to escape the container, just give them a medal and ask them to use their energy more productively elsewhere
2. Allows us to mount just the test input file in readonly mode, so they can't modify it or look for the corresponding .out file
3. Restricts networking, so they can't send the input file to themselves.
4. More portable, since we don't have to mess with a possibly existing java installation. 
*/
function getDockerProcess(command, volumes = []) {
  let docker_command = ["docker run --rm --network none"];
  docker_command.push(...volumes.map(vol => `-v ${cwd}/${vol}`));
  docker_command.push("openjdk:12");
  docker_command.push(command);
  console.log(docker_command.join(" "));
  return cw.process(docker_command.join(" "));
}

start();
module.exports = start;
