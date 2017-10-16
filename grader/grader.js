"use strict";

let bluebird = require("bluebird");
let redis = require("redis");
let Docker = require("dockerode");
let child_process = require("child_process");
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

function listen() {
  db.llenAsync(constants.queueName).then(function(length) {
    if (length == 0) {
      if (sub.listenerCount("message") == 0) {
        console.log("waiting");
        sub.once("message", (channel, message) => {
          process();
        });
      }
    } else {
      process();
    }
  });
}

function process() {
  db.lpopAsync(constants.queueName).then(function(filedata) {
    if (filedata == null) {
      return listen();
    }
    filedata = JSON.parse(filedata);
    let classname = filedata.classname;
    let folderkey = filedata.key;
    console.log(filedata);
    if (filedata.type == "zip") {
      var dl = cw
        .process(
          `wget -q -P downloads ${constants.webServerIP}/uploads/${folderkey}`
        )
        .death()
        .catch(e => {
          console.error("Download error");
          error(filedata, "Download Error");
        })
        .then(res => {
          return cw
            .process(
              `unzip -j -o -d grader/java/${folderkey} downloads/${folderkey}`
            )
            .death();
        });
    } else {
      var dl = cw
        .process(`mkdir grader/java/${folderkey}`)
        .death()
        .then(() =>
          cw
            .process(
              `wget -O grader/java/${folderkey}/${classname}.java ${constants.webServerIP}/uploads/${folderkey}`
            )
            .death()
        );
    }
    var compileProcess;
    dl
      .catch(e => {
        console.error(e);
        error(filedata, "Download Error");
      })
      .then(() => {
        let command = `javac -cp ./grader/java/${folderkey} ./grader/java/${folderkey}/${classname}.java`;
        console.log(command);
        compileProcess = cw.process(command, /.+/);
        return compileProcess.death();
      })
      .then(res => {
        test(filedata);
      })
      .catch(e => {
        error(filedata, "Compilation Error");
        var output = compileProcess.instance.instance.output
          .join("")
          .replace(/<error>/g, "");
        error(filedata, output);
      })
      .catch(e => {
        console.log(e);
      });
  });
}

function error(filedata, err) {
  return complete(filedata, { success: false, results: {}, compileError: err });
}

function test(filedata) {
  var files = Object.keys(testfiles);
  return runTestCase(filedata, files, { success: false, results: {} });
}

function runTestCase(filedata, files, result) {
  if (files.length == 0) {
    result.success = true;
    try {
      return complete(filedata, result);
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
  proc
    .ready(constants.executionTimeout)
    .then(res => {
      var output = proc.instance.instance.output.join("");
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
          return complete(filedata, result);
        }
        result.results[filename] = runtime;
        return runTestCase(filedata, files, result);
      } else {
        // console.log(`${filename} incorrect`, testfiles[filename], res.result.data);
        result.results[filename] = false;
        if (output.includes("<error>")) {
          console.log(output);
          result.runtimeError = output.replace(/<error>/g, "");
        } else {
          result.runtimeError = "Wrong Answer";
        }
        return complete(filedata, result);
      }
    })
    .catch(error => {
      // Kill the program if it times out
      result.results[filename] = false;
      if (Date.now() - startTime > constants.executionTimeout) {
        result.runtimeError = "Time Limit Exceeded";
      } else {
        console.error(`exec error for ${command}: ${error}`);
        result.runtimeError = proc.instance.instance.output;
      }
      return complete(filedata, result);
    });
  setTimeout(() => {
    if (proc.instance.instance.isRunning) {
      proc.kill();
    }
  }, constants.executionTimeout);
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
  db.hset(constants.resultsKey, filedata.key, JSON.stringify(results));
  if (results.success) {
    console.log(constants.leaderboardKey, time, filedata.name);
    let name = await db.hgetAsync(constants.secretsNamesKey, filedata.secret);
    console.log(name);
    if (name != null && name != undefined) {
      console.log(`remove ${constants.leaderboardKey}, name`);
      db.zrem(constants.leaderboardKey, name);
    }
    console.log(constants.secretsNamesKey, filedata.secret, filedata.name);
    db.hsetAsync(constants.secretsNamesKey, filedata.secret, filedata.name);
    db.zadd(constants.leaderboardKey, time, filedata.name);
  }

  return listen();
}

start();
module.exports = start;
