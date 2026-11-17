#!/usr/bin/env node
// Local-only review server for saved MeetingBank eval results.
const http = require("http");
const fs = require("fs");
const path = require("path");

const evalDir = __dirname;
const resultDir = path.join(evalDir, "results");
const datasetDir = path.join(evalDir, "datasets", "meetingbank");
const port = Number(process.env.EVAL_REVIEW_PORT || 4178);

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    return send(res, 200, fs.readFileSync(path.join(evalDir, "review-meetingbank.html")), "text/html; charset=utf-8");
  }
  if (req.url === "/api/data") {
    try {
      const files = fs.readdirSync(resultDir)
        .filter((name) => /^meetingbank-.*\.json$/.test(name))
        .map((name) => ({ name, mtime: fs.statSync(path.join(resultDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (!files.length) return send(res, 404, "No MeetingBank result files found.");
      const resultFile = files[0].name;
      const result = JSON.parse(fs.readFileSync(path.join(resultDir, resultFile), "utf8"));
      const cases = result.runs.map((run) => {
        let item = {};
        const file = path.join(datasetDir, `${run.caseId}.json`);
        if (fs.existsSync(file)) item = JSON.parse(fs.readFileSync(file, "utf8"));
        return {
          id: run.caseId,
          transcript: item.transcript || "",
          expected: item.expected?.summary || "",
          runs: result.runs.filter((other) => other.caseId === run.caseId),
        };
      });
      const deduped = [...new Map(cases.map((item) => [item.id, item])).values()];
      return send(res, 200, JSON.stringify({ resultFile, cases: deduped }), "application/json; charset=utf-8");
    } catch (error) {
      return send(res, 500, error.message);
    }
  }
  send(res, 404, "Not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Eval review available at http://127.0.0.1:${port}`);
  console.log("Press Ctrl+C to stop.");
});
