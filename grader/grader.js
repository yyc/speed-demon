let bluebird = require("bluebird");
let redis = require("redis");
let db = redis.createClient();
let Docker = require("dockerode");
let child_process = require("child_process");
let cw = require("core-worker");

var queueName = "processQueue";

var testcases = require('./testfiles');

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
      try {
        var proc = cw.process(`javac -sourcepath grader/java/${filename}/ grader/java/${filename}/*.java`);
        proc.death()
          .then((res) => {
            console.log(res.data);
            console.log("completed");
          })
          .catch((error) => {
            console.error(`exec error: ${error}`)
          })
      } catch (e) {
        console.error(`exec error: ${e}`)
      } finally {
      }
    });
}

function listen(){
  console.log('start listening');
}
start();
module.exports = start;
