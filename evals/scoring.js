// Pure scoring functions (no network) so they can be unit-tested.

const { hasRequiredSections } = require("../format");

const STOPWORDS = new Set(
  "a an the and or to of in on for with by at is are was be will it this that i you we they he she as from up so do does did can".split(" ")
);

const normalizeWords = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

const contentTokens = (text) => normalizeWords(text).filter((w) => !STOPWORDS.has(w));

/** Share of the expected text's content words that appear in the candidate (0..1). */
function overlap(expected, candidate) {
  const exp = new Set(contentTokens(expected));
  if (exp.size === 0) return 0;
  const cand = new Set(contentTokens(candidate));
  let hit = 0;
  for (const t of exp) if (cand.has(t)) hit++;
  return hit / exp.size;
}

// ---------- Word error rate (transcription) ----------

/** WER = (substitutions + deletions + insertions) / reference word count. */
function wordErrorRate(reference, hypothesis) {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;

  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}

// ---------- Parsing the model's markdown ----------

function sectionBullets(md, heading) {
  const re = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "im");
  const m = re.exec(md || "");
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.match(/^\s*[-*]\s+(.*\S)\s*$/))
    .filter(Boolean)
    .map((x) => x[1]);
}

/** "- **Priya:** Send deck _(Due: Thu)_" -> { owner: "Priya", task: "Send deck", due: "Thu" } */
function parseActionItems(md) {
  const items = [];
  for (const line of sectionBullets(md, "Action Items")) {
    const m = line.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
    if (!m) continue; // e.g. "No action items were identified."
    const owner = m[1].replace(/:\s*$/, "").trim();
    let task = m[2].replace(/^:\s*/, "").trim();
    let due = null;
    const d = task.match(/\s*[_*]?\(\s*Due:\s*(.+?)\s*\)[_*]?\s*$/i);
    if (d) {
      due = d[1];
      task = task.slice(0, d.index).trim();
    }
    items.push({ owner, task, due });
  }
  return items;
}

const parseDecisions = (md) => sectionBullets(md, "Key Decisions");

// ---------- Scoring a summary against a labeled example ----------

const sameOwner = (a, b) => {
  const x = String(a || "").toLowerCase().trim();
  const y = String(b || "").toLowerCase().trim();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

const f1 = (p, r) => (p + r === 0 ? 0 : (2 * p * r) / (p + r));

/**
 * @param {string} md          model output
 * @param {object} expected    { decisions: string[], action_items: [{owner, task}] }
 * @param {string} transcript  used to detect owners the model made up
 */
function scoreSummary(md, expected, transcript, { threshold = 0.5 } = {}) {
  const formatOk = hasRequiredSections(md || "");
  const outItems = parseActionItems(md);
  const expItems = expected.action_items || [];
  const expDecisions = expected.decisions || [];

  // Recall side: for each expected item, was the task found, and under the right owner?
  let taskFound = 0;
  let ownerCorrect = 0;
  let fullMatches = 0;
  for (const e of expItems) {
    const candidates = outItems.filter((o) => overlap(e.task, o.task) >= threshold);
    if (candidates.length) {
      taskFound++;
      if (candidates.some((o) => sameOwner(o.owner, e.owner))) {
        ownerCorrect++;
        fullMatches++;
      }
    }
  }

  // Precision side: how many produced items correspond to a real expected item (task + owner)?
  const correctOut = outItems.filter((o) =>
    expItems.some((e) => overlap(e.task, o.task) >= threshold && sameOwner(o.owner, e.owner))
  ).length;

  const recall = expItems.length ? fullMatches / expItems.length : 1;
  const precision = outItems.length ? correctOut / outItems.length : expItems.length ? 0 : 1;

  // Decisions: how many expected decisions show up in some produced decision?
  const outDecisions = parseDecisions(md);
  const decisionsFound = expDecisions.filter((d) => outDecisions.some((o) => overlap(d, o) >= threshold)).length;
  const decisionRecall = expDecisions.length ? decisionsFound / expDecisions.length : 1;

  // Owners that are neither "Unassigned" nor mentioned anywhere in the transcript
  const lowerTranscript = String(transcript || "").toLowerCase();
  const hallucinatedOwners = outItems
    .map((o) => o.owner)
    .filter((owner) => {
      if (/^unassigned$/i.test(owner)) return false;
      const parts = owner.toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
      return !parts.some((p) => lowerTranscript.includes(p));
    });

  return {
    formatOk,
    actionItems: {
      expected: expItems.length,
      produced: outItems.length,
      precision,
      recall,
      f1: f1(precision, recall),
      ownerAccuracy: taskFound ? ownerCorrect / taskFound : null, // among tasks found, right owner?
    },
    decisionRecall,
    hallucinatedOwners,
  };
}

module.exports = {
  normalizeWords,
  overlap,
  wordErrorRate,
  parseActionItems,
  parseDecisions,
  scoreSummary,
};
