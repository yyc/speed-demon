var express = require('express');
var router = express.Router();
var redis = require("redis");
var constants = require("../constants");
let bluebird = require("bluebird");
var fileUpload = require('express-fileupload');
var shortid =require('shortid');
var sanitizer = require('sanitizer');


router.use(fileUpload());
router.use("/uploads", express.static('uploads'));

bluebird.promisifyAll(redis.RedisClient.prototype);
bluebird.promisifyAll(redis.Multi.prototype);

var db = redis.createClient();

db.on('error', function(err){
  console.log("error")
})

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
  } else if(req.files.file.mimetype == "text/java") {
    data.type = "java";
  } else {
      return res.render('upload', {title: "New Submission", error: "Invalid filetype"});
  }

  req.files.file.mv(`uploads/${id}`, (err) => {
    if(err) {
      return res.render('upload', {title: 'New Submission', error: "err"});
    }
    db.lpushAsync(constants.queueName, JSON.stringify(data))
     .then(() => {
       db.publish(constants.pubSubName, "new");
     })
    db.hset(constants.resultsKey, id, "")
     .then(() => {
       res.redirect(`/submission/${id}`);
     })
  });
});

router.get('/submission/:id', function(req, res, next) {
  console.log(req.params['id']);
  if(!shortid.isValid(req.params['id'])) {
    return db.llenAsync(constants.processQueue)
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
