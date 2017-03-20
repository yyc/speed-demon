var express = require('express');
var router = express.Router();
var redis = require("redis");
var constants = require("../constants");
let bluebird = require("bluebird");
var fileUpload = require('express-fileupload');
var shortid =require('shortid');
var sanitizer = require('sanitizer');
var fs = require('fs');


router.use(fileUpload());
router.use("/uploads", express.static('uploads'));

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

fs.mkdir('uploads', function(err){
  console.log(err || "uploads folder created");
});
var db = redis.createClient(constants.redisConnectionOptions);

db.on('error', function(err){
  console.error("error");
})

/* Home page: Leaderboard */
router.get('/', function(req, res, next) {
  Promise.all([
    db.zrangeAsync([constants.leaderboardKey, 0, 15, "WITHSCORES"]),
    db.zrangebyscoreAsync([constants.cheatersKey, '-inf','+inf'])])
    .then((results) => {
      scores = results[0];
      cheaters = results[1] || [];
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
      res.render('index', { title: 'CS2020 Speed Demon Leaderboard',
        leaders,
        cheaters
      });
    })
});

router.get('/submit', function(req, res, next) {
  res.render('upload', {title: 'New Submission'});
});

router.post('/submit', function(req, res, next) {
  var id = shortid.generate();
  if(!req.body || !req.body.firstname || !req.body.classname || !req.files || !req.files.file) {
    res.render('upload', {title: 'New Submission', error: "Missing fields"});
    return;
  }
  var data = {key: id,
    classname: sanitizer.escape(req.body.classname),
    name: sanitizer.sanitize(req.body.firstname),
  }
  if(req.files.file.mimetype == "application/zip") {
    data.type = "zip";
  } else if(req.files.file.mimetype == "application/octet-stream" && req.files.file.name.includes('.zip')) {
    data.type = "zip";
  } else if(req.files.file.name.includes('.java'))
    data.type = "java";
  else {
      return res.render('upload', {title: "New Submission", error: "Invalid filetype"});
  }

  req.files.file.mv(`uploads/${id}`, (err) => {
    if(err) {
      return res.render('upload', {title: 'New Submission', error: err});
    }
    db.lpushAsync(constants.queueName, JSON.stringify(data))
     .then(() => {
       db.publish(constants.pubSubName, "new");
     })
    db.hsetAsync(constants.resultsKey, id, "")
     .then(() => {
       res.redirect(`/submission/${id}`);
     })
  });
});

router.get('/submission/:id', function(req, res, next) {
  console.log(req.params['id']);
  if(!shortid.isValid(req.params['id'])) {
    return db.llenAsync(constants.queueName)
    .then((length) => {
      res.render('notfound', {
        title: 'Submission Not Found',
        queueNumber: length
      });
    });
  }
  db.hgetAsync(constants.resultsKey, escape(req.params['id']))
  .then((json) => {
    if(json == null) {
      return db.llenAsync(constants.queueName)
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
      if(json.success) {
        var ldb = db.zrangebyscoreAsync([constants.leaderboardKey, "-inf", "+inf", "WITHSCORES"])
      } else {
        var ldb = Promise.resolve([]);
      }
      ldb.then((ldrboard) => {
        var scores = ldrboard.filter((elem, index) => index % 2).map((str) => parseInt(str) / 1000);
        res.render('judged', {
          title: 'Submission Evaluated',
          correct: json.success,
          results: json.results,
          runtime: json.time / 1000,
          // allTimes: encodeURIComponent(JSON.stringify(allTimes)),
          filename: json.classname,
          error: json.runtimeError || json.compileError,
          allTimes: JSON.stringify(scores)
        });
      })
      return;
    }
  })
})

module.exports = router;
