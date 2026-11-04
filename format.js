// Pure helpers for checking/cleaning the LLM's markdown output (no network, easy to test).

const REQUIRED_HEADINGS = ["Meeting Summary", "Key Decisions", "Action Items"];

/** Strip wrapping code fences / preamble the model sometimes adds, and trim. */
function normalizeMarkdown(text) {
  let out = String(text || "").trim();

  // ```markdown ... ``` wrapper
  const fenced = out.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) out = fenced[1].trim();

  // Drop any chatter before the first required heading
  const first = out.search(/^#{1,3}\s*Meeting Summary\s*$/im);
  if (first > 0) out = out.slice(first).trim();

  // Force the three headings to a consistent level (## ) regardless of what the model chose
  for (const h of REQUIRED_HEADINGS) {
    out = out.replace(new RegExp(`^#{1,4}\\s*${h}\\s*:?\\s*$`, "im"), `## ${h}`);
  }
  return out;
}

/** True when all three sections exist, in order, each with some content. */
function hasRequiredSections(md) {
  let cursor = 0;
  const positions = [];
  for (const h of REQUIRED_HEADINGS) {
    const re = new RegExp(`^## ${h}\\s*$`, "im");
    const m = re.exec(md.slice(cursor));
    if (!m) return false;
    positions.push(cursor + m.index);
    cursor += m.index + m[0].length;
  }
  // Each section must have non-empty body
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : md.length;
    const body = md.slice(start, end).split("\n").slice(1).join("\n").trim();
    if (!body) return false;
  }
  // Action items should be a bulleted list
  const actionBody = md.slice(positions[2]).split("\n").slice(1).join("\n");
  return /^\s*[-*]\s+\S/m.test(actionBody);
}

module.exports = { REQUIRED_HEADINGS, normalizeMarkdown, hasRequiredSections };