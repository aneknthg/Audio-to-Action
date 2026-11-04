import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { uploadAudio } from "./api.js";

const MAX_BYTES = 25 * 1024 * 1024;
const OK_EXT = [".mp3", ".wav"];

function validate(file) {
  const name = file.name.toLowerCase();
  if (!OK_EXT.some((ext) => name.endsWith(ext))) return "Please choose an .mp3 or .wav file.";
  if (file.size > MAX_BYTES) return "That file is over 25 MB, which is the transcription limit.";
  return null;
}

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default function App() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState("idle"); // idle | uploading | processing | done | error
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("summary"); // summary | markdown | transcript
  const [copied, setCopied] = useState(false);

  const busy = stage === "uploading" || stage === "processing";

  function pick(f) {
    if (!f) return;
    const problem = validate(f);
    setResult(null);
    setProgress(0);
    if (problem) {
      setFile(null);
      setError(problem);
      setStage("error");
      return;
    }
    setFile(f);
    setError(null);
    setStage("idle");
  }

  async function run() {
    if (!file || busy) return;
    setError(null);
    setResult(null);
    setProgress(0);
    setStage("uploading");
    try {
      const data = await uploadAudio(file, {
        onProgress: setProgress,
        onUploaded: () => setStage("processing"),
      });
      setResult(data);
      setTab(data.summary ? "summary" : "transcript");
      setStage("done");
    } catch (e) {
      setError(e.message);
      setStage("error");
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
    setProgress(0);
    setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy to the clipboard.");
    }
  }

  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  }

  const baseName = file ? file.name.replace(/\.[^.]+$/, "") : "meeting";

  return (
    <main className="app">
      <header>
        <h1>Meeting → Action Items</h1>
        <p className="sub">Upload a recording. Get a summary, key decisions, and who owns what.</p>
      </header>

      <section
        className={`dropzone ${dragging ? "drag" : ""} ${busy ? "disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) pick(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,.wav,audio/mpeg,audio/wav"
          hidden
          onChange={(e) => pick(e.target.files?.[0])}
        />
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span>{fmtSize(file.size)} · click or drop to choose a different file</span>
          </>
        ) : (
          <>
            <strong>Drop an audio file here</strong>
            <span>or click to browse · .mp3 or .wav · up to 25 MB</span>
          </>
        )}
      </section>

      <div className="actions">
        <button className="primary" onClick={run} disabled={!file || busy}>
          {busy ? "Working…" : "Generate notes"}
        </button>
        {(file || result || error) && !busy && (
          <button onClick={reset}>Start over</button>
        )}
      </div>

      {stage === "uploading" && (
        <div className="status">
          <div className="bar">
            <div style={{ width: `${progress}%` }} />
          </div>
          <span>Uploading… {progress}%</span>
        </div>
      )}
      {stage === "processing" && (
        <div className="status">
          <div className="bar indeterminate">
            <div />
          </div>
          <span>Transcribing and summarizing. Longer recordings can take a minute.</span>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {stage === "done" && result && (
        <section className="result">
          {result.summaryError && (
            <div className="error" role="alert">
              {result.summaryError} The transcript is still available below.
            </div>
          )}

          <div className="tabs" role="tablist">
            {result.summary && (
              <>
                <button role="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}>
                  Notes
                </button>
                <button role="tab" aria-selected={tab === "markdown"} onClick={() => setTab("markdown")}>
                  Markdown
                </button>
              </>
            )}
            <button role="tab" aria-selected={tab === "transcript"} onClick={() => setTab("transcript")}>
              Transcript
            </button>
          </div>

          <div className="panel">
            {tab === "summary" && result.summary && (
              <article className="markdown">
                <ReactMarkdown>{result.summary}</ReactMarkdown>
              </article>
            )}
            {tab === "markdown" && result.summary && <pre>{result.summary}</pre>}
            {tab === "transcript" && <p className="transcript">{result.transcript || "(empty)"}</p>}
          </div>

          <div className="actions">
            {tab !== "transcript" && result.summary && (
              <>
                <button onClick={() => copy(result.summary)}>{copied ? "Copied ✓" : "Copy markdown"}</button>
                <button onClick={() => download(result.summary, `${baseName}-notes.md`)}>Download .md</button>
              </>
            )}
            {tab === "transcript" && result.transcript && (
              <>
                <button onClick={() => copy(result.transcript)}>{copied ? "Copied ✓" : "Copy transcript"}</button>
                <button onClick={() => download(result.transcript, `${baseName}-transcript.txt`)}>
                  Download .txt
                </button>
              </>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
