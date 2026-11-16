const OpenAI = require("openai");
const { toFile } = OpenAI;

// Groq hosts Whisper behind an OpenAI-compatible API, so the same SDK works;
// only the API key, base URL and model name differ.
const BASE_URL = process.env.WHISPER_BASE_URL || "https://api.groq.com/openai/v1";
const WHISPER_MODEL = process.env.WHISPER_MODEL || "whisper-large-v3-turbo";

let client;
function getClient() {
  if (!process.env.GROQ_API_KEY) {
    const err = new Error("GROQ_API_KEY is not set");
    err.code = "MISSING_API_KEY";
    throw err;
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: BASE_URL });
  }
  return client;
}

/**
 * Send an in-memory audio buffer to the Whisper API.
 * Returns the raw, unformatted transcript as a single string.
 */
async function transcribeBuffer(buffer, filename, mimeType, { model } = {}) {
  const api = getClient();
  // Wrap the buffer as a named file so the API can detect the format from the extension
  const file = await toFile(buffer, filename, { type: mimeType });
  const result = await api.audio.transcriptions.create({
    file,
    model: model || WHISPER_MODEL,
    response_format: "json",
  });
  return result.text;
}

module.exports = { transcribeBuffer };
