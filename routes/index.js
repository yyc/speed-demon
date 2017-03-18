var express = require('express');
var router = express.Router();
var redis = require("redis");
var constants = require("../constants");
let bluebird = require("bluebird");
var fileUpload = require('express-fileupload');

router.use(fileUpload());

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

var db = redis.createClient();

db.on('error', function(err){
  console.log("error")
})

// Advay: Here are stubs for you to test the layout

/* Home page: Leaderboard */
router.get('/', function(req, res, next) {
  db.zrangeAsync([constants.leaderboardKey, -10, -1, "WITHSCORES"])
    .then((scores) => {
      var leaders = [];
      scores.reduce((name, time) => {
        if(name) {
          // Convert from miliseconds to seconds
          time = time / 1000;
          leaders.push({name, time});
          return false;
        } else{
          return time;
        }
      }, false);
      res.render('index', { title: 'Leaderboard',
        leaders
      });
    })
});

router.get('/submit', function(req, res, next) {
  res.render('upload', {title: 'New Submission'});
});

router.post('/submit', function(req, res, next) {
  console.log(req.body);
  console.log(req.files);
  res.end("okay");
});

router.get('/submission/:id', function(req, res, next) {
  console.log(req.params['id']);
  db.hgetAsync(constants.resultsKey, escape(req.params['id']))
  .then((json) => {
    if(json == null) {
      return db.llenAsync(constants.processQueue)
      .then((length) => {
        res.render('notfound', {
          title: 'Submission Not Found',
          queueNumber: length
        });
      })
    } else if(json == "") {
      return db.llenAsync(constants.processQueue)
      .then((length) => {
        res.render('pending', {
          title: 'Submission Pending',
          queueNumber: length
        });
      })
    } else {
      try{
        var json = JSON.parse(json);
      } catch (e) {
        res.render('error', {
          message: "JSON parsing error",
          error: e
        });
        return;
      }
      res.render('judged', {
        title: 'Submission Evaluated',
        correct: json.success,
        results: json.results,
        runtime: json.time / 1000,
        // allTimes: encodeURIComponent(JSON.stringify(allTimes)),
        filename: json.classname
      });
      return;
    }
  })
})

module.exports = router;
