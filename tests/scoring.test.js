const test = require("node:test");
const assert = require("node:assert/strict");
const { wordErrorRate, parseActionItems, parseDecisions, scoreSummary } = require("../evals/scoring");

const sample = require("../evals/datasets/summarization/product-sync.json");

const GOOD = `## Meeting Summary
Weekly mobile launch sync covering beta feedback and the launch date.

## Key Decisions
- The onboarding flow will be cut from five screens to three.
- The launch date stays October 30 unless the payment bug is not fixed.

## Action Items
- **Dan:** Prepare the new onboarding designs _(Due: Wednesday)_
- **Priya:** Fix the payment bug _(Due: Friday)_
- **Priya:** Post an update in the channel
- **Sarah:** Email the beta testers to thank them _(Due: end of day tomorrow)_`;

test("WER: identical, one substitution, ignores case/punctuation", () => {
  assert.equal(wordErrorRate("the cat sat", "The cat, sat."), 0);
  assert.ok(Math.abs(wordErrorRate("the cat sat", "the dog sat") - 1 / 3) < 1e-9);
  assert.equal(wordErrorRate("a b c d", "a b"), 0.5); // two deletions
  assert.equal(wordErrorRate("", ""), 0);
});

test("parseActionItems extracts owner, task and due date", () => {
  const items = parseActionItems(GOOD);
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], { owner: "Dan", task: "Prepare the new onboarding designs", due: "Wednesday" });
  assert.equal(items[2].due, null);
});

test("parse ignores the 'no action items' placeholder", () => {
  const md = "## Meeting Summary\nx\n\n## Key Decisions\n- a\n\n## Action Items\n- No action items were identified.";
  assert.equal(parseActionItems(md).length, 0);
  assert.equal(parseDecisions(md).length, 1);
});

test("perfect output scores 100%", () => {
  const s = scoreSummary(GOOD, sample.expected, sample.transcript);
  assert.equal(s.formatOk, true);
  assert.equal(s.actionItems.recall, 1);
  assert.equal(s.actionItems.precision, 1);
  assert.equal(s.actionItems.ownerAccuracy, 1);
  assert.equal(s.decisionRecall, 1);
  assert.deepEqual(s.hallucinatedOwners, []);
});

test("wrong owner lowers recall and owner accuracy but the task is still found", () => {
  const bad = GOOD.replace("**Sarah:**", "**Dan:**");
  const s = scoreSummary(bad, sample.expected, sample.transcript);
  assert.equal(s.actionItems.recall, 3 / 4);
  assert.equal(s.actionItems.ownerAccuracy, 3 / 4);
});

test("missing item lowers recall; extra item lowers precision", () => {
  const missing = GOOD.replace(/- \*\*Priya:\*\* Post an update in the channel\n/, "");
  assert.equal(scoreSummary(missing, sample.expected, sample.transcript).actionItems.recall, 3 / 4);

  const extra = GOOD + "\n- **Dan:** Order pizza for the whole team";
  const s = scoreSummary(extra, sample.expected, sample.transcript);
  assert.equal(s.actionItems.recall, 1);
  assert.equal(s.actionItems.precision, 4 / 5);
});

test("made-up owner is flagged; 'Unassigned' is not", () => {
  const md = GOOD + "\n- **Gregory:** Review contracts\n- **Unassigned:** Book a room";
  const s = scoreSummary(md, sample.expected, sample.transcript);
  assert.deepEqual(s.hallucinatedOwners, ["Gregory"]);
});

test("bad format is detected", () => {
  const s = scoreSummary("Here are your notes: Dan will do designs.", sample.expected, sample.transcript);
  assert.equal(s.formatOk, false);
  assert.equal(s.actionItems.recall, 0);
});
