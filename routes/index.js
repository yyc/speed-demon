var express = require('express');
var router = express.Router();
var redis = require("redis");

var db = redis.createClient();

db.on('error', function(err){
  console.log("error")
})

// Advay: Here are stubs for you to test the layout

/* Home page: Leaderboard */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Leaderboard',
    leaders: [
      {name: "Ary", time: 10.2},
      {name: "Hailong", time: 12.2},
      {name: "Advay", time: 15.9},
      {name: "Jiayee", time: 20.2319290},
      {name: "Herbert Illhan Tanujaya", time: 23},
      {name: "Govind", time: 50.99},
      {name: "yyc", time: 60.709},
      {name: "Shiyuan", time: 60.709},
    ]
  });
});

router.get('/submit', function(req, res, next) {
  res.render('upload', {title: 'New Submission'});
})

router.get('/pending', function(req, res, next) {
  res.render('pending', {
    title: 'Submission Pending',
    queueNumber: 3
  });
})

router.get('/correct', function(req, res, next) {
  var results = {"test1": true, "test2": true, "test3": true};
  var allTimes = [10.2, 12.2, 15.9, 20.2319290, 23, 50.99, 60.709, 60.709];
  res.render('judged', { title: 'Submission Evaluated',
    correct: true,
    results,
    runtime: 10.3,
    allTimes: encodeURIComponent(JSON.stringify(allTimes)),
    filename: "correctSubmissionPS5.java"
  });
});

router.get('/wrong', function(req, res, next) {
  var results = {"test1": true, "test2": false, "test3": true};
  var allTimes = [10.2, 12.2, 15.9, 20.2319290, 23, 50.99, 60.709, 60.709];
  res.render('judged', { title: 'Submission Evaluated',
    correct: false,
    results,
    runtime: 7.2,
    alltimes: encodeURIComponent(JSON.stringify(allTimes)),
    filename: "wrongSubmissionPS5.java"
  });
});

module.exports = router;
