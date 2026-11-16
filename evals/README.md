# Evals

Two independent evals, because errors compound across stages and you want to know which stage is weak.

| Eval | Input | Metrics | Command |
|---|---|---|---|
| Summarization | text transcripts + labeled expected decisions / action items | format validity, action-item precision / recall / F1, owner accuracy, decision recall, made-up owners, latency | `npm run eval:summarize` |
| Transcription | audio + human-verified reference transcript | word error rate (WER), latency | `npm run eval:transcribe` |

Compare models by passing a comma-separated list:

```
npm run eval:summarize -- --models llama-3.3-70b-versatile,openai/gpt-oss-120b
npm run eval:transcribe -- --models whisper-large-v3-turbo,whisper-large-v3
```

Raw model outputs and per-case scores are saved to `evals/results/` (git-ignored).

## Adding cases

**Summarization:** add `evals/datasets/summarization/<name>.json`:

```json
{
  "transcript": "...raw text as Whisper would produce it...",
  "expected": {
    "decisions": ["short statement of each decision"],
    "action_items": [{ "owner": "Name as spoken in the transcript", "task": "what they must do" }]
  }
}
```

Use real (anonymized) transcripts where you can. Include hard cases: no action items, an action item with no clear owner, two people with the same first name, an owner mentioned only by role, decisions that get reversed later in the meeting, and cross-talk.

**Transcription:** copy `datasets/transcription/manifest.example.json` to `manifest.json` and add audio files next to it.

## How scoring works (and its limits)

Matching is deterministic: an expected item counts as found when at least half of its content words appear in a produced item **and** the owner matches. That is fast and free but can miss correct paraphrases. A common next step is an LLM-as-judge pass over `evals/results/*.json` for faithfulness and summary quality, which word overlap cannot measure. Spot-check a sample of outputs by hand either way.

Run the scoring unit tests with `npm test`.
