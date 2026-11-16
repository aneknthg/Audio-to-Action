#!/usr/bin/env node
// Evaluate summaries against MeetingBank human reference summaries using ROUGE-L F1.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { summarizeTranscript } = require("../summarize");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const datasetDir = path.resolve(arg("dataset", path.join(__dirname, "datasets", "meetingbank")));
const models = arg("models", process.env.SUMMARY_MODEL || "llama-3.3-70b-versatile")
  .split(",").map((s) => s.trim()).filter(Boolean);
const delayMs = Number(arg("delay", 1500));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

function tokens(text) {
  return String(text || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

function rougeL(reference, candidate) {
  const ref = tokens(reference);
  const hyp = tokens(candidate);
  if (!ref.length || !hyp.length) return 0;
  let previous = new Uint32Array(hyp.length + 1);
  for (const word of ref) {
    const current = new Uint32Array(hyp.length + 1);
    for (let j = 1; j <= hyp.length; j++) {
      current[j] = word === hyp[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    previous = current;
  }
  const lcs = previous[hyp.length];
  const precision = lcs / hyp.length;
  const recall = lcs / ref.length;
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set (put it in .env)");
  if (!fs.existsSync(datasetDir)) throw new Error(`Dataset not found: ${datasetDir}. Run evals/prepare-meetingbank.py first.`);
  const files = fs.readdirSync(datasetDir).filter((file) => file.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No .json cases found in ${datasetDir}. Run evals/prepare-meetingbank.py first.`);
  const cases = files.map((file) => ({ id: file.replace(/\.json$/, ""), ...JSON.parse(fs.readFileSync(path.join(datasetDir, file), "utf8")) }));
  const runs = [];

  for (const model of models) {
    for (const item of cases) {
      const started = Date.now();
      const run = { model, caseId: item.id };
      try {
        const output = await summarizeTranscript(item.transcript, { model });
        run.output = output;
        run.rougeL = rougeL(item.expected.summary, output);
        run.latencyMs = Date.now() - started;
        console.log(`${model} | ${item.id} | ROUGE-L=${(run.rougeL * 100).toFixed(1)}%`);
      } catch (error) {
        run.latencyMs = Date.now() - started;
        run.error = `${error.status || ""} ${error.message}`.trim();
        run.excluded = error.code !== "BAD_FORMAT";
        console.log(`${model} | ${item.id} | ERROR ${run.error}`);
      }
      runs.push(run);
      await sleep(delayMs);
    }
  }

  const table = models.map((model) => {
    const mine = runs.filter((run) => run.model === model);
    const ok = mine.filter((run) => !run.excluded && run.rougeL != null);
    return {
      model,
      cases: ok.length,
      errors: mine.length - ok.length,
      mean_rougeL_f1: mean(ok.map((run) => run.rougeL)) == null
        ? "n/a" : `${(mean(ok.map((run) => run.rougeL)) * 100).toFixed(1)}%`,
      avg_latency_s: ((mean(ok.map((run) => run.latencyMs)) || 0) / 1000).toFixed(1),
    };
  });
  console.log("\nMeetingBank summarization eval (ROUGE-L F1; higher is better)");
  console.table(table);

  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `meetingbank-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ dataset: "huuuyeah/meetingbank", models, table, runs }, null, 2));
  console.log(`Details saved to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
