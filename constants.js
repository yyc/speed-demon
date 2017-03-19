module.exports = {
  testfiles: {
    "2.in": 17765,
    "example.input": 2573
  },
  // In milliseconds
  executionTimeout : 20000,
  queueName: "processQueue",
  pubSubName: "processPubSub",
  resultsKey: "results",
  leaderboardKey: "leaderboard",
  webServerIP : "127.0.0.1:3000",
  redisConnectionOptions : process.env.REDIS_URL || {}
}
