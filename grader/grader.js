"use strict";

let bluebird = require("bluebird");
let redis = require("redis");
let Docker = require("dockerode");
let child_process = require("child_process");
let cw = require("core-worker");


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

function listen(){
  db.llenAsync(constants.queueName)
  .then(function(length){
    if(length == 0) {
      console.log("waiting");
      sub.once("message", (channel, message) => {
        process();
      })
    } else {
      process();
    }
  });
}


function process(){
  db.lpopAsync(constants.queueName)
    .then(function(filedata){
      if(filedata == null) {
        return listen();
      }
      filedata = JSON.parse(filedata);
      let classname = filedata.classname;
      let folderkey = filedata.key
      console.log(`Downloading ${folderkey}`);
      if(filedata.type == "zip") {
        var dl = cw.process(`wget -q -P downloads ${constants.webServerIP}/uploads/${folderkey}`).death()
          .then((res) => {
            return cw.process(`unzip -j -o -d grader/java/${folderkey} downloads/${folderkey}`).death()
          });
      } else {
        var dl = cw.process(`wget -P grader/java/${folderkey}/${classname}.java ${constants.webServerIP}/uploads/${folderkey}`).death();
      }
      dl.catch((e) => {
        console.error(e);
        error(filedata, e);})
        .then(() => {
          let command = `javac -cp ./grader/java/${folderkey} ./grader/java/${folderkey}/${classname}.java`;
          var proc = cw.process(command, /.+/);
          return proc.death()
        })
        .then((res) => {
          test(filedata);
        })
        .catch((e) => {
          error(filedata, e);
        })
    });
}

function error(filedata, err) {
  return complete(filedata, {success:false, results:{}, compileError: err})
}

function test(filedata) {
  var files = Object.keys(testfiles);
  return runTestCase(filedata, files, {success:false, results:{}});
}

function runTestCase(filedata, files, result){
  if(files.length == 0) {
    result.success = true;
    try {
      return complete(filedata, result);
    } catch(e) {
      console.error(e);
    }
    return;
  }
  let startTime = Date.now();
  let filename = files.shift();
  let command = `java -classpath grader/java/${filedata.key} ${filedata.classname} grader/testcases/${filename}`
  var proc = cw.process(command, /[0-9]+/);
  proc.ready(constants.executionTimeout)
    .then((res) => {
      console.log(`completed ${filename}`);
      if(res.result.data == testfiles[filename]) {
          result.results[filename] = Date.now() - startTime;
          return runTestCase(filedata, files, result);
      } else{
        // console.log(`${filename} incorrect`, testfiles[filename], res.result.data);
        result.results[filename] = false;
        return complete(filedata, result);
      }
    })
    .catch((error) => {
      // Kill the program if it times out
      proc.kill();
      if(Date.now() - startTime > constants.executionTimeout) {
        result.results[filename] = "Time Limit Exceeded";
      } else{
        result.results[filename] = "Runtime Error";
        console.error(`exec error for ${command}: ${error}`);
      }
      return complete(filedata, result);
    });
}

function complete(filedata, results) {
  if(results.success) {
    var time = Object.values(results.results)
      .reduce((acc, value) => acc + value, 0);
    results.time = time;
  }
  console.log(constants.resultsKey, filedata.key, JSON.stringify(results));
  db.hset(constants.resultsKey, filedata.key, JSON.stringify(results));
  if(results.success) {
    console.log(constants.leaderboardKey, time, filedata.name);
    db.zadd(constants.leaderboardKey, time, filedata.name);
  }

  return listen();
}

start();
module.exports = start;
