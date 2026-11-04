const OpenAI = require("openai");
const { normalizeMarkdown, hasRequiredSections } = require("./format");

const BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";
const SUMMARY_MODEL = process.env.SUMMARY_MODEL || "";

const SYSTEM_PROMPT = `You turn raw meeting transcripts into structured meeting notes.

The transcript is unformatted speech-to-text: no speaker labels, little punctuation, possible transcription errors. Read it carefully and respond with ONLY a markdown document in exactly this structure and nothing else (no preamble, no closing remarks, no code fences):
<structure>
## Meeting Summary
A concise paragraph (3-6 sentences) covering the purpose of the meeting, the main topics discussed, and the outcome.

## Key Decisions
- One bullet per decision that was actually made. Be specific.
- If no decisions were made, write a single bullet: "- No explicit decisions were made."

## Action Items
- **<Owner>:** <specific task> _(Due: <date or timeframe>)_
- One bullet per action item. Name the responsible person exactly as they are named in the transcript.
- Omit the "(Due: ...)" part when no deadline was mentioned.
- If it is unclear who is responsible, use **Unassigned** as the owner. Never invent names or deadlines.
- If there are no action items, write a single bullet: "- No action items were identified."
</structure>

Rules:
- Use only information present in the transcript. Do not add facts.
- Keep the three headings exactly as written above, in that order.
- Fix obvious transcription mistakes in names only when the correct spelling is clear from context.`;

let client;
function getClient() {
  if (!process.env.GROQ_API_KEY) {
    const err = new Error("GROQ_API_KEY is not set");
    err.code = "MISSING_API_KEY";
    throw err;
  }
  if (!client) client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: BASE_URL });
  return client;
}

async function callModel(transcript, extraReminder) {
  const completion = await getClient().chat.completions.create({
    model: SUMMARY_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT + (extraReminder ? `\n\n${extraReminder}` : "") },
      { role: "user", content: `Transcript:\n\n${transcript}` },
    ],
  });
  return normalizeMarkdown(completion.choices?.[0]?.message?.content);
}

/**
 * Pass the entire transcript to the LLM and return a markdown string with the
 * sections: Meeting Summary, Key Decisions, Action Items.
 * Retries once with a stricter reminder if the format comes back wrong.
 */
async function summarizeTranscript(transcript) {
  let md = await callModel(transcript);
  if (hasRequiredSections(md)) return md;

  md = await callModel(
    transcript,
    "Your previous answer did not follow the required format. Output ONLY the three sections " +
      "'## Meeting Summary', '## Key Decisions' and '## Action Items' (action items as a bulleted list)."
  );
  if (hasRequiredSections(md)) return md;

  const err = new Error("The model did not return the required markdown format");
  err.code = "BAD_FORMAT";
  throw err;
}

module.exports = { summarizeTranscript };