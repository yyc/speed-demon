"use strict";

let bluebird = require("bluebird");
let redis = require("redis");
let db = redis.createClient();
let Docker = require("dockerode");
let child_process = require("child_process");
let cw = require("core-worker");

var queueName = "processQueue";

var constants = require("../constants");
var testfiles = constants.testfiles;

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

var mutex = false;
// Processes any pending jobs in the queue,
// or waits for a pubsub
function start() {
  db.lpushAsync(queueName, "YuanPS5")
   .then(() => db.llenAsync(queueName))
   .then(function(length){
     if(length == 0) {
       listen();
     } else{
       process();
     }
   });
}

function process(){
  db.lpopAsync(queueName)
    .then(function(filename){
      console.log(filename);
      let command = `javac -cp ./grader/java/${filename} ./grader/java/${filename}/${filename}.java`;
      var proc = cw.process(command, /.+/);
      proc.death()
        .then((res) => {
          console.log("compiled");
          test(filename);
        })
        .catch((error) => {
          console.error(`exec error: ${error}`)
          error(filename);
        })
    });
}

function error(filename) {
}

function test(filename) {
  var files = Object.keys(testfiles);
  return runTestCase(filename, files, {success:false, results:{}});
}

function runTestCase(program, files, result){
  if(files.length == 0) {
    result.success = true;
    return complete(program, result);
  }
  let startTime = Date.now();
  let filename = files.shift();
  let command = `java -classpath grader/java/${program} ${program} grader/testcases/${filename}`
  var proc = cw.process(command, /[0-9]+/);
  proc.ready(constants.executionTimeout)
    .then((res) => {
      console.log(`completed ${filename}`);
      console.log(res.result.data);
      if(res.result.data == testfiles[filename]) {
          result.results[filename] = Date.now() - startTime;
          return runTestCase(program, files, result);
      } else{
        console.log(`${filename} incorrect ${command}`, testfiles[filename], res.result.data);
        result.results[filename] = false;
        return complete(program, result);
      }
    })
    .catch((error) => {
      // Kill the program if it times out
      proc.kill();
      console.error(`exec error for ${command}: ${error}`);
      result.results[filename] = "Runtime Error";
      return complete(program, result);
    });
}

function complete(filename, results) {
  console.log(filename);
  console.log(results);
}

function listen(){
  console.log('start listening');
}
start();
module.exports = start;
