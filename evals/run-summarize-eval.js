#!/usr/bin/env node
// Evaluates the summarization step on text transcripts (no audio needed, cheap to run).
//
//   node evals/run-summarize-eval.js
//   node evals/run-summarize-eval.js --models llama-3.3-70b-versatile,openai/gpt-oss-120b
//   node evals/run-summarize-eval.js --dataset evals/datasets/summarization --delay 2000

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { summarizeTranscript } = require("../summarize");
const { scoreSummary } = require("./scoring");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const datasetDir = path.resolve(arg("dataset", path.join(__dirname, "datasets", "summarization")));
const models = arg("models", process.env.SUMMARY_MODEL || "llama-3.3-70b-versatile").split(",").map((s) => s.trim());
const delayMs = Number(arg("delay", 1500)); // pause between calls to stay under free-tier rate limits
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (x) => (x == null ? "n/a" : `${(x * 100).toFixed(0)}%`);

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set (put it in .env)");

  const files = fs.readdirSync(datasetDir).filter((f) => f.endsWith(".json"));
  if (!files.length) throw new Error(`No .json cases found in ${datasetDir}`);
  const cases = files.map((f) => ({ id: f.replace(/\.json$/, ""), ...JSON.parse(fs.readFileSync(path.join(datasetDir, f), "utf8")) }));

  const runs = [];
  for (const model of models) {
    for (const c of cases) {
      const started = Date.now();
      const run = { model, caseId: c.id };
      try {
        const md = await summarizeTranscript(c.transcript, { model });
        run.output = md;
        run.latencyMs = Date.now() - started;
        run.score = scoreSummary(md, c.expected, c.transcript);
      } catch (err) {
        run.latencyMs = Date.now() - started;
        if (err.code === "BAD_FORMAT") {
          run.score = scoreSummary("", c.expected, c.transcript); // counts as a format failure
          run.error = "BAD_FORMAT";
        } else {
          run.error = `${err.status || ""} ${err.message}`.trim(); // API/network problem: excluded from averages
          run.excluded = true;
        }
      }
      console.log(`${model} | ${c.id} | ${run.error ? `ERROR ${run.error}` : `format=${run.score.formatOk} F1=${pct(run.score.actionItems.f1)}`}`);
      runs.push(run);
      await sleep(delayMs);
    }
  }

  const table = models.map((model) => {
    const mine = runs.filter((r) => r.model === model);
    const ok = mine.filter((r) => !r.excluded);
    return {
      model,
      cases: ok.length,
      api_errors: mine.length - ok.length,
      format_valid: pct(mean(ok.map((r) => (r.score.formatOk ? 1 : 0)))),
      action_precision: pct(mean(ok.map((r) => r.score.actionItems.precision))),
      action_recall: pct(mean(ok.map((r) => r.score.actionItems.recall))),
      action_f1: pct(mean(ok.map((r) => r.score.actionItems.f1))),
      owner_accuracy: pct(mean(ok.map((r) => r.score.actionItems.ownerAccuracy).filter((x) => x != null))),
      decision_recall: pct(mean(ok.map((r) => r.score.decisionRecall))),
      made_up_owners: ok.reduce((n, r) => n + r.score.hallucinatedOwners.length, 0),
      avg_latency_s: ((mean(ok.map((r) => r.latencyMs)) || 0) / 1000).toFixed(1),
    };
  });
  console.log("\nSummarization eval");
  console.table(table);

  const outDir = path.join(__dirname, "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `summarize-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ models, table, runs }, null, 2));
  console.log(`Details (including raw model outputs) saved to ${path.relative(process.cwd(), outFile)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
