#!/usr/bin/env node
const argv = require("minimist")(process.argv.slice(2));
const spawn = require("child_process").spawn;
const fs = require("fs");
const getDuration = require("get-video-duration");

if (argv._.length < 3) {
	console.log("Usage: rtmp-fallback rtmpInput fallbackFile rtmpOutput");
	console.log("fallbackFile MUST be a .ts file");
	console.log("Options:");
	console.log("	-f: Force start output with fallback loop.");
	console.log("	-l: Enable logging in /tmp of rtmpdump/ffmpeg outputs.");
	console.log("	-p: Enable persistent logging in /tmp of rtmpdump/ffmpeg outputs.");
	console.log("	-t ms: Timeout in milliseconds before switching to fallback file. Defaults to 5000ms.");
	console.log("	-d ms: Set fallback video's duration in ms. Will fallback to automatic detection if not set.");
	process.exit(1);
}

const timeoutLength = (argv.t) ? argv.t : 5000;
const loggingEnabled = (argv.l != null);
const persistentLogging = (argv.p != null);
const forceStart = (argv.f != null);

const noDataBuf = require("fs").readFileSync(process.argv[3]);
let noDataDur = argv.d;
if (!noDataDur)
	getDuration(process.argv[3])
		.then((duration) => noDataDur = duration * 1000)
		.catch((e) => {
			console.error("An error occured while probing duration for fallback file!", e);
			process.exit(1);
		});
let noDataTimeout = null;
let lastNoData = null;

const ffmpegOut = spawn("ffmpeg", ("-fflags +genpts -re -f mpegts -i - -c copy -bsf:a aac_adtstoasc -f flv " + process.argv[4]).split(" "));
ffmpegOut.on("exit", (code) => { console.log("ffmpegOut exited with code " + code + "! Exiting..."); process.exit(code); });

const ffmpegIn = spawn("ffmpeg", ("-f live_flv -i - -c copy -f mpegts -").split(" "));
ffmpegIn.on("exit", (code) => { console.log("ffmpegIn exited with code " + code + "! Exiting..."); process.exit(code); });
ffmpegIn.stdout.on("data", onData);

const currentStream = spawn("rtmpdump", ("-m 0 -v -r " + process.argv[2]).split(" "));
currentStream.on("exit", (code) => { console.log("rtmpdump exited with code " + code + "+! Exiting..."); process.exit(code); });
currentStream.stdout.on("data", (videoData) => ffmpegIn.stdin.write(videoData));

if (forceStart) {
	noDataTimeout = setTimeout(noData, timeoutLength);
}

if (loggingEnabled || persistentLogging) {
	let log_extension = '.log'

	if (persistentLogging) {
		const datetime = new Date().toISOString().split('.')[0].replace('T', '_').replaceAll(':', '-');
		log_extension = `.${datetime}${log_extension}`
	}

	const ffmpegOutLog = fs.createWriteStream(`/tmp/ffmpegout.${log_extension}`);
	ffmpegOut.stderr.on("data", (msg) => ffmpegOutLog.write(msg));
	const ffmpegInLog = fs.createWriteStream(`/tmp/ffmpegin.${log_extension}`);
	ffmpegIn.stderr.on("data", (msg) => ffmpegInLog.write(msg));
	const rtmpdumpLog = fs.createWriteStream(`/tmp/rtmpdump.${log_extension}`);
	currentStream.stderr.on("data", (msg) => rtmpdumpLog.write(msg));
}

function onData(videoData) {
	ffmpegOut.stdin.write(videoData);
	if (noDataTimeout) {
		clearTimeout(noDataTimeout);
		lastNoData = null
	}
	noDataTimeout = setTimeout(noData, timeoutLength);
}

function noData() {
	console.log("Timeout reached! Switching to fallback file...");
	ffmpegOut.stdin.write(noDataBuf);
	setNoDateTimeout();
}

function setNoDateTimeout() {
	// Instead of using setInterval, we're using setTimeout with re-calculated delay everytime, otherwise the delay will increase over time
	// because of the time it takes to write to the console and pass data to ffmpeg
	noDataTimeout = setTimeout(() => {
		ffmpegOut.stdin.write(noDataBuf);
		lastNoData = Date.now();
		setNoDateTimeout();
	}, (lastNoData == null) ? noDataDur : (Date.now() - lastNoData + noDataDur));
}

console.log("RTMP Fallback successfully initialized");
