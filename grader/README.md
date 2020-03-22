# Grader files

These files are intended to be run on a non-cloud server for grading, since cloud servers (which share resources with other cloud servers) don't have a stable amount of compute resources, which can cause considerable variance in the timed runs.

grader.js: Run continuously on a server to test files.

localGrader.js: Runs through a list of files (specified in localFiles.js) for the purpose of doing a once-through grading.

populateNames.js: connects to the redis instance for the purpose of populating the secretsNames key with each student's name and secret.