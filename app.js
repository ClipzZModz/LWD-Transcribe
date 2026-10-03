const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { spawn } = require("child_process");
const { pipeline } = require("stream");
const { finished } = require("stream/promises");
const OpenAI = require("openai");
const ffmpegPath = require("ffmpeg-static");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;
const uploadsDir = path.join(__dirname, "uploads");
const MAX_FILES = 5;
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const TRANSCRIPTION_MAX_BYTES = 25_000_000;
const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;
const OPENAI_TIMEOUT_MS = 10 * 60 * 1000;
const OPENAI_MAX_RETRIES = 2;
const STALE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Keep ownership and write completion available even when multipart parsing aborts.
const storage = {
  _handleFile(req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
    const filename = `${randomUUID()}${safeExtension}`;
    const filePath = path.join(uploadsDir, filename);
    const output = fs.createWriteStream(filePath, { flags: "wx" });
    // Only claim a path once this request has exclusively created it.
    output.once("open", () => req.uploadPaths.add(filePath));
    req.uploadStreams.add(output);
    const write = new Promise((resolve) => {
      pipeline(file.stream, output, (error) => {
        req.uploadStreams.delete(output);
        req.uploadWrites.delete(write);
        resolve();
        cb(error, {
          destination: uploadsDir,
          filename,
          path: filePath,
          size: output.bytesWritten,
        });
      });
    });
    req.uploadWrites.add(write);
  },
  _removeFile(req, file, cb) {
    // Multer removes completed files itself; retain only failed removals for retry.
    removeRequestFile(req, file.path).then(() => cb(null), cb);
  },
};

const upload = multer({
  storage,
  // Browsers send multipart filenames as UTF-8, including accents and emoji.
  defParamCharset: "utf8",
  limits: { fileSize: UPLOAD_MAX_BYTES, files: MAX_FILES },
});
const uploadBatch = upload.array("audio", MAX_FILES);

function logFailure(operation, error) {
  // Log operation and known-shaped codes, never SDK payloads, keys or raw messages.
  const code = /^(E[A-Z0-9_]{1,40}|LIMIT_[A-Z_]{1,40})$/.test(error?.code)
    ? error.code
    : "UNKNOWN";
  console.error(`[transcriber] ${operation}`, { code });
}

async function removeFileIfExists(filePath) {
  if (!filePath) return true;
  if (path.dirname(path.resolve(filePath)) !== path.resolve(uploadsDir)) {
    logFailure("Refused cleanup outside uploads directory.");
    return false;
  }
  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    logFailure("Temporary file cleanup failed.", error);
    return false;
  }
}

async function removeRequestFile(req, filePath) {
  if (filePath && req.uploadPaths.has(filePath) && (await removeFileIfExists(filePath))) {
    req.uploadPaths.delete(filePath);
  }
}

async function cleanupRequestUploads(req) {
  for (const filePath of req.uploadPaths) {
    await removeRequestFile(req, filePath);
  }
}

async function cleanupStaleUploads() {
  try {
    const entries = await fs.promises.readdir(uploadsDir, { withFileTypes: true });
    const cutoff = Date.now() - STALE_UPLOAD_MAX_AGE_MS;
    for (const entry of entries) {
      if (entry.name === ".gitkeep" || !entry.isFile()) continue;
      const filePath = path.join(uploadsDir, entry.name);
      try {
        const stats = await fs.promises.lstat(filePath);
        if (stats.isFile() && stats.mtimeMs < cutoff) {
          await removeFileIfExists(filePath);
        }
      } catch (error) {
        if (error.code !== "ENOENT") logFailure("Stale upload inspection failed.", error);
      }
    }
  } catch (error) {
    logFailure("Stale upload scan failed.", error);
  }
}

async function receiveUploads(req, res, next) {
  req.uploadPaths = new Set();
  req.uploadWrites = new Set();
  req.uploadStreams = new Set();
  const stopWrites = () => {
    for (const stream of req.uploadStreams) stream.destroy();
  };
  req.once("aborted", stopWrites);
  req.once("error", stopWrites);

  let uploadError;
  try {
    uploadError = await new Promise((resolve) => uploadBatch(req, res, resolve));
  } catch (error) {
    uploadError = error;
  }
  if (uploadError || req.aborted) stopWrites();
  await Promise.allSettled(req.uploadWrites);
  req.removeListener("aborted", stopWrites);
  req.removeListener("error", stopWrites);

  if (!uploadError && !req.aborted) return next();
  await cleanupRequestUploads(req);
  if (req.aborted || res.destroyed) return;

  let message = "Upload failed. Please select your audio files and try again.";
  let status = 400;
  if (uploadError?.code === "LIMIT_FILE_SIZE") {
    message = "One of the selected files exceeds the upload size limit.";
    status = 413;
  } else if (
    uploadError?.code === "LIMIT_FILE_COUNT" ||
    (uploadError?.code === "LIMIT_UNEXPECTED_FILE" && uploadError.field === "audio")
  ) {
    message = `You can upload a maximum of ${MAX_FILES} files at once.`;
  }
  logFailure("Upload rejected.", uploadError);
  return res.status(status).render("index", {
    transcript: null,
    results: [],
    combinedTranscript: "",
    error: message,
  });
}

function convertOpusToWav(inputPath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error("ffmpeg binary was not found."));
      return;
    }

    const outputPath = `${inputPath}.wav`;
    const ffmpeg = spawn(ffmpegPath, [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });

    // Drain diagnostics without retaining or rendering potentially sensitive paths.
    ffmpeg.stderr.resume();
    let timedOut = false;
    let processError = null;
    const timeout = setTimeout(() => {
      timedOut = true;
      ffmpeg.kill("SIGKILL");
    }, FFMPEG_TIMEOUT_MS);

    ffmpeg.once("error", (error) => {
      clearTimeout(timeout);
      processError = error;
    });

    // Wait for closed process handles before the caller removes the partial WAV.
    ffmpeg.once("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(Object.assign(new Error("Audio conversion timed out."), { code: "FFMPEG_TIMEOUT" }));
      } else if (processError) {
        reject(processError);
      } else if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error("Audio conversion failed."));
      }
    });
  });
}

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.render("index", {
    transcript: null,
    results: [],
    combinedTranscript: "",
    error: null,
  });
});

app.post("/transcribe", receiveUploads, async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : [];
  const results = [];
  let requestError = null;
  let status = 200;

  try {
    if (files.length === 0) {
      return res.status(400).render("index", {
        transcript: null,
        results,
        combinedTranscript: "",
        error: "Please upload an .opus or .mp3 file.",
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      await cleanupRequestUploads(req);
      return res.status(500).render("index", {
        transcript: null,
        results,
        combinedTranscript: "",
        error: "Transcription is not configured. Please contact the administrator.",
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: OPENAI_TIMEOUT_MS,
      maxRetries: OPENAI_MAX_RETRIES,
    });
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const fileResult = {
        index,
        filename: file.originalname,
        success: false,
        transcript: "",
        error: null,
      };
      results.push(fileResult);
      let convertedFilePath = null;
      let transcriptionStream = null;
      let streamFinished = null;
      let failureMessage = "Transcription failed. Please try again.";

      try {
        const ext = path.extname(file.originalname).toLowerCase();
        if (![".opus", ".mp3"].includes(ext)) {
          fileResult.error = "Invalid file type. Only .opus and .mp3 are allowed.";
          continue;
        }
        if (file.size === 0) {
          fileResult.error = "File is empty.";
          continue;
        }

        let transcriptionFilePath = file.path;
        if (ext === ".opus") {
          failureMessage = "Audio conversion failed.";
          // Track the output before conversion so partial WAVs also get cleanup.
          convertedFilePath = `${file.path}.wav`;
          req.uploadPaths.add(convertedFilePath);
          transcriptionFilePath = await convertOpusToWav(file.path);
        }

        failureMessage = "Transcription failed. Please try again.";
        const transcriptionFile = await fs.promises.stat(transcriptionFilePath);
        if (transcriptionFile.size > TRANSCRIPTION_MAX_BYTES) {
          fileResult.error = "Audio is too large to transcribe.";
          continue;
        }
        if (transcriptionFile.size === 0) {
          fileResult.error = "File is empty.";
          continue;
        }
        transcriptionStream = fs.createReadStream(transcriptionFilePath);
        streamFinished = finished(transcriptionStream).catch(() => {});
        const result = await client.audio.transcriptions.create({
          file: transcriptionStream,
          model,
        });

        if (typeof result?.text !== "string") {
          fileResult.error = "Transcription returned an invalid response.";
          continue;
        }

        fileResult.success = true;
        fileResult.transcript = result.text.trim() ? result.text : "";
      } catch (error) {
        fileResult.error = error?.code === "FFMPEG_TIMEOUT"
          ? "Audio conversion timed out."
          : error instanceof OpenAI.APIConnectionTimeoutError
            ? "Transcription timed out."
            : failureMessage;
        logFailure("File processing failed.", error);
      } finally {
        if (transcriptionStream) {
          transcriptionStream.destroy();
          await streamFinished;
        }
        await removeRequestFile(req, file.path);
        await removeRequestFile(req, convertedFilePath);
      }
    }
  } catch (error) {
    logFailure("Batch processing failed.", error);
    status = 500;
    requestError = "Transcription failed. Please try again.";
  } finally {
    // Retry failed removals and clean uploads left by request-level failures.
    await cleanupRequestUploads(req);
  }

  const successfulResults = results.filter((result) => result.success);
  const combinedTranscript = successfulResults
    .map((result) => `===== ${result.filename} =====\n\n${result.transcript}`)
    .join("\n\n");
  const failedCount = results.length - successfulResults.length;
  const transcript = successfulResults.length === 1
    ? successfulResults[0].transcript
    : successfulResults.length > 1 ? combinedTranscript : null;

  return res.status(status).render("index", {
    transcript,
    results,
    combinedTranscript,
    error: requestError || (failedCount === 0
      ? null
      : results.length === 1
        ? results[0].error
        : `${failedCount} of ${results.length} files could not be transcribed.`),
  });
});

// Finish the startup scan before accepting uploads from this process.
cleanupStaleUploads().then(() => {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
});
