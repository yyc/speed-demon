let cw = require("core-worker");
const {
  minTotalExecution,
  maxTotalExecution,
  targetWaitTime
} = require("../constants").timeouts;

const cwd = process.cwd();

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

/**
 * Provides a scaling execution time allotment based on the queue length, and {minTotalExecutionTimeout, maxTotalExecutionTimeout} in constants
 * This is to allow for slower solutions to still be graded during less-busy times, while not slowing down the queue too much during heavier load.
 * @param int queueLength
 */
function getExecutionTimeAllotment(queueLength) {
  // no divide by 0
  let proportionateTime = targetWaitTime / Math.max(queueLength, 1);
  // in case too many people are in the queue, give the minimum amount of time
  let givenTime = Math.max(proportionateTime, minTotalExecution);
  // Give at most the maxTotalExecution time
  console.log(`Given ${Math.min(givenTime, maxTotalExecution)} millis to run.`);
  return Math.min(givenTime, maxTotalExecution);
}

module.exports = {
  getDockerProcess,
  getExecutionTimeAllotment
};
