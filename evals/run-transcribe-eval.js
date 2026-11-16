#!/usr/bin/env node
// Evaluates transcription (Whisper) by word error rate against reference transcripts.
//
// 1. Put audio files in evals/datasets/transcription/
// 2. Create evals/datasets/transcription/manifest.json (see manifest.example.json)
// 3. node evals/run-transcribe-eval.js --models whisper-large-v3-turbo,whisper-large-v3

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { transcribeBuffer } = require("../transcribe");
const { wordErrorRate } = require("./scoring");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const datasetDir = path.resolve(arg("dataset", path.join(__dirname, "datasets", "transcription")));
const models = arg("models", process.env.WHISPER_MODEL || "whisper-large-v3-turbo").split(",").map((s) => s.trim());
const delayMs = Number(arg("delay", 1500));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const MIME = { ".mp3": "audio/mpeg", ".wav": "audio/wav" };

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set (put it in .env)");

  const manifestPath = path.join(datasetDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}. Copy manifest.example.json to manifest.json and add your audio + reference transcripts.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const runs = [];
  for (const model of models) {
    for (const item of manifest) {
      const file = path.join(datasetDir, item.audio);
      const started = Date.now();
      const run = { model, id: item.id || item.audio };
      try {
        const buffer = fs.readFileSync(file);
        const hyp = await transcribeBuffer(buffer, path.basename(file), MIME[path.extname(file).toLowerCase()] || "audio/mpeg", { model });
        run.wer = wordErrorRate(item.reference, hyp);
        run.hypothesis = hyp;
      } catch (err) {
        run.error = `${err.status || ""} ${err.message}`.trim();
      }
      run.latencyMs = Date.now() - started;
      console.log(`${model} | ${run.id} | ${run.error ? `ERROR ${run.error}` : `WER=${(run.wer * 100).toFixed(1)}%`}`);
      runs.push(run);
      await sleep(delayMs);
    }
  }

  const table = models.map((model) => {
    const ok = runs.filter((r) => r.model === model && !r.error);
    return {
      model,
      files: ok.length,
      errors: runs.filter((r) => r.model === model).length - ok.length,
      mean_WER: mean(ok.map((r) => r.wer)) == null ? "n/a" : `${(mean(ok.map((r) => r.wer)) * 100).toFixed(1)}%`,
      avg_latency_s: ((mean(ok.map((r) => r.latencyMs)) || 0) / 1000).toFixed(1),
    };
  });
  console.log("\nTranscription eval (lower WER is better)");
  console.table(table);

  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `transcribe-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ models, table, runs }, null, 2));
  console.log(`Details saved to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
