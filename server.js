require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");
const { transcribeBuffer } = require("./transcribe");
const { summarizeTranscript } = require("./summarize");

const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB (Groq free-tier per-file limit for Whisper)

const ALLOWED_EXTENSIONS = new Set([".mp3", ".wav"]);
const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
]);

// Keep the upload in memory as a Buffer; it goes straight to Whisper and is never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      const err = new Error("Only .mp3 and .wav audio files are allowed");
      err.code = "INVALID_FILE_TYPE";
      return cb(err);
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

// Extension and MIME type are client-supplied, so also check the buffer's magic bytes.
function hasValidAudioSignature(buf, ext) {
  if (buf.length < 12) return false;
  if (ext === ".wav") {
    return buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
  }
  if (ext === ".mp3") {
    const hasId3 = buf.toString("ascii", 0, 3) === "ID3";
    const hasFrameSync = buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
    return hasId3 || hasFrameSync;
  }
  return false;
}

const app = express();

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// POST /api/upload — multipart/form-data with a single file in the "audio" field.
// Pipeline: audio buffer -> Whisper (raw transcript) -> LLM (structured markdown).
app.post("/api/upload", upload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use form field name "audio".' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!hasValidAudioSignature(req.file.buffer, ext)) {
      return res.status(415).json({ error: "File content does not match a valid .mp3 or .wav file" });
    }

    // Step 1: speech-to-text. If this fails there is nothing to return, so errors go to the handler.
    const transcript = await transcribeBuffer(
      req.file.buffer,
      path.basename(req.file.originalname),
      req.file.mimetype
    );

    const response = {
      file: {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
      },
      transcript, // raw, unformatted text from Whisper
      summary: null, // markdown string: Meeting Summary / Key Decisions / Action Items
      summaryError: null,
    };

    // Step 2: summarize. A failure here still returns the transcript so the work isn't lost.
    if (!transcript.trim()) {
      response.summaryError = "No speech was detected in the audio.";
    } else {
      try {
        response.summary = await summarizeTranscript(transcript);
      } catch (err) {
        console.error("Summarization failed:", err.status || err.code || "", err.message);
        response.summaryError =
          err.code === "BAD_FORMAT"
            ? "The AI did not return the expected format. Try again."
            : err instanceof OpenAI.APIError
              ? `Summarization failed: ${err.message}`
              : "Summarization failed.";
      }
    }

    res.status(200).json(response);
  } catch (err) {
    next(err);
  }
});

// Serve the built React app (after `npm run build`) from the same server in production.
const CLIENT_DIST = path.join(__dirname, "client", "dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
}

// Error handling for Multer, validation, and Groq/OpenAI-SDK errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `File too large. Max size is ${MAX_FILE_SIZE / (1024 * 1024)} MB`
        : err.message;
    return res.status(status).json({ error: message });
  }
  if (err.code === "INVALID_FILE_TYPE") {
    return res.status(415).json({ error: err.message });
  }
  if (err.code === "MISSING_API_KEY") {
    return res.status(500).json({ error: "Server is missing GROQ_API_KEY" });
  }
  if (err instanceof OpenAI.APIError) {
    console.error("Groq API error:", err.status, err.message);
    return res.status(502).json({ error: `Transcription failed: ${err.message}` });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

if (require.main === module) {
  if (!process.env.GROQ_API_KEY) {
    console.warn("Warning: GROQ_API_KEY is not set; /api/upload will fail until it is.");
  }
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}

module.exports = app;