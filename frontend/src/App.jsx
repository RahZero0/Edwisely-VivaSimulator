import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  evaluateAnswerThunk,
  fetchSources,
  generateQuestionsThunk,
  setCount,
  setDifficulty,
  setStudentAnswer,
  setTopic,
  startViva,
  toggleSource,
  uploadPdfThunk,
} from "./store.js";
import StudentViva from "./StudentViva.jsx";

export default function App() {
  const dispatch = useDispatch();
  const [file, setFile] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [mode, setMode] = useState("student");
  const {
    uploadStatus,
    uploadPhase,
    sources,
    selectedSourceIds,
    topic,
    difficulty,
    count,
    questions,
    questionStatus,
    questionPhase,
    questionStartedAt,
    activeQuestion,
    studentAnswer,
    evaluation,
    evaluationStatus,
    evaluationPhase,
  } = useSelector((state) => state.viva);

  const indexingSources = sources.filter((source) => source.status === "indexing");
  const hasIndexingSources = indexingSources.length > 0;

  const selectedSourceNames = useMemo(
    () =>
      sources
        .filter((source) => selectedSourceIds.includes(source.source_id))
        .map((source) => `${source.filename} (${source.status})`)
        .join(", "),
    [sources, selectedSourceIds],
  );

  useEffect(() => {
    dispatch(fetchSources());
  }, [dispatch]);

  useEffect(() => {
    if (!hasIndexingSources && uploadPhase !== "indexing") {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      dispatch(fetchSources());
    }, 2500);

    return () => window.clearInterval(intervalId);
  }, [dispatch, hasIndexingSources, uploadPhase]);

  useEffect(() => {
    if (questionPhase !== "loading" || !questionStartedAt) {
      setElapsedSeconds(0);
      return undefined;
    }

    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - questionStartedAt) / 1000));
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [questionPhase, questionStartedAt]);

  function handleUpload() {
    if (!file) {
      return;
    }
    dispatch(uploadPdfThunk(file));
    setFile(null);
  }

  function handleStartViva(question) {
    dispatch(startViva(question));
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  const canGenerate = selectedSourceIds.length > 0 && !selectedSourceIds.some((sourceId) => {
    const source = sources.find((item) => item.source_id === sourceId);
    return !source || source.status !== "indexed";
  });

  return (
    <main className="app">
      <style>{styles}</style>

      <header className="header">
        <div>
          <h1>Edwisely Viva Simulator</h1>
          <p>Upload PDFs, generate RAG-grounded viva questions, and evaluate typed answers.</p>
        </div>
        <div className="modeToggle">
          <button className={mode === "developer" ? "" : "secondaryButton"} onClick={() => setMode("developer")}>
            Developer Mode
          </button>
          <button className={mode === "student" ? "" : "secondaryButton"} onClick={() => setMode("student")}>
            Student Mode
          </button>
        </div>
      </header>

      {mode === "student" ? (
        <StudentViva
          topic={topic}
          difficulty={difficulty}
          count={count}
          sources={sources}
          selectedSourceIds={selectedSourceIds}
          selectedSourceNames={selectedSourceNames}
          canGenerate={canGenerate}
          onTopicChange={(value) => dispatch(setTopic(value))}
          onDifficultyChange={(value) => dispatch(setDifficulty(value))}
          onCountChange={(value) => dispatch(setCount(value))}
          onToggleSource={(sourceId) => dispatch(toggleSource(sourceId))}
        />
      ) : (
        <>
      <section className="panel">
        <div className="sectionTitle">
          <span>1</span>
          <h2>PDF Upload</h2>
        </div>
        <div className="row">
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <button disabled={!file || uploadPhase === "uploading"} onClick={handleUpload}>
            Upload PDF
          </button>
        </div>
        {(uploadPhase === "uploading" || hasIndexingSources) && (
          <div className="progress" aria-label="Indexing in progress">
            <span />
          </div>
        )}
        {uploadStatus && <p className={`status ${uploadPhase}`}>{uploadStatus}</p>}

        <div className="sources">
          <div className="sourceHeading">
            <h3>Indexed Sources</h3>
            {hasIndexingSources && <strong>{indexingSources.length} indexing</strong>}
          </div>
          {sources.length === 0 ? (
            <p className="muted">No PDFs indexed yet.</p>
          ) : (
            sources.map((source) => (
              <label className={`sourceItem ${source.status}`} key={source.source_id}>
                <input
                  type="checkbox"
                  checked={selectedSourceIds.includes(source.source_id)}
                  disabled={source.status !== "indexed"}
                  onChange={() => dispatch(toggleSource(source.source_id))}
                />
                <span>{source.filename}</span>
                <small>{source.status}</small>
                {source.error && <em>{source.error}</em>}
              </label>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="sectionTitle">
          <span>2</span>
          <h2>Question Generation</h2>
        </div>
        <div className="grid">
          <label>
            Topic
            <input
              value={topic}
              onChange={(event) => dispatch(setTopic(event.target.value))}
              placeholder="e.g. finite automata, op-amp feedback, quicksort"
            />
          </label>
          <label>
            Difficulty
            <select value={difficulty} onChange={(event) => dispatch(setDifficulty(event.target.value))}>
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
          </label>
          <label>
            Count
            <input
              type="number"
              min="1"
              max="20"
              value={count}
              onChange={(event) => dispatch(setCount(event.target.value))}
            />
          </label>
        </div>
        <p className="muted">
          Active source{selectedSourceIds.length === 1 ? "" : "s"}:{" "}
          {selectedSourceNames || "none selected"}
        </p>
        <button disabled={!canGenerate || questionPhase === "loading"} onClick={() => dispatch(generateQuestionsThunk())}>
          Generate Questions
        </button>
        {questionPhase === "loading" && (
          <div className="generationProgress">
            <div className="progress" aria-label="Question generation in progress">
              <span />
            </div>
            <p>
              {elapsedSeconds}s elapsed. Local Ollama generation can take 30 seconds to a few
              minutes, especially with large PDFs or multiple sources.
            </p>
          </div>
        )}
        {!canGenerate && selectedSourceIds.length > 0 && (
          <p className="hint">Wait until selected PDFs finish indexing before generating questions.</p>
        )}
        {questionStatus && <p className={`status ${questionPhase}`}>{questionStatus}</p>}

        <div className="cards">
          {questions.map((question) => (
            <article className="card" key={question.id}>
              <div className="cardTop">
                <strong>Q{question.id}</strong>
                <span>{question.difficulty}</span>
              </div>
              <p>{question.question}</p>
              <details>
                <summary>Expected answer</summary>
                <p>{question.expected_answer}</p>
              </details>
              <div className="followups">
                <p>
                  <strong>If good:</strong> {question.followup_if_good}
                </p>
                <p>
                  <strong>If struggling:</strong> {question.followup_if_poor}
                </p>
              </div>
              <button onClick={() => handleStartViva(question)}>Start Viva</button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="sectionTitle">
          <span>3</span>
          <h2>Viva Answer & Evaluation</h2>
        </div>

        {activeQuestion ? (
          <>
            <div className="activeQuestion">
              <strong>Selected question</strong>
              <p>{activeQuestion.question}</p>
            </div>
            <label>
              Student answer
              <textarea
                value={studentAnswer}
                onChange={(event) => dispatch(setStudentAnswer(event.target.value))}
                placeholder="Type the student's viva answer here..."
              />
            </label>
            <button disabled={evaluationPhase === "loading"} onClick={() => dispatch(evaluateAnswerThunk())}>
              Submit Answer
            </button>
          </>
        ) : (
          <p className="muted">Start a viva from one of the generated question cards.</p>
        )}

        {evaluationStatus && <p className={`status ${evaluationPhase}`}>{evaluationStatus}</p>}

        {evaluation && (
          <div className="evaluation">
            <div className="score">{evaluation.score}/5</div>
            <div className="rubric">
              <span>Correctness: {evaluation.correctness}/5</span>
              <span>Depth: {evaluation.depth}/5</span>
              <span>Clarity: {evaluation.clarity}/5</span>
            </div>
            <p>{evaluation.feedback}</p>
            <h3>Missing points</h3>
            {evaluation.missing_points.length === 0 ? (
              <p className="muted">No major missing points returned.</p>
            ) : (
              <ul>
                {evaluation.missing_points.map((point, index) => (
                  <li key={`${point}-${index}`}>{point}</li>
                ))}
              </ul>
            )}
            <h3>Follow-up question</h3>
            <p>{evaluation.followup_question}</p>
          </div>
        )}
      </section>
        </>
      )}
    </main>
  );
}

const styles = `
  :root {
    color: #18202a;
    background: #f4f6f8;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
  }

  button,
  input,
  select,
  textarea {
    font: inherit;
  }

  button {
    border: 0;
    border-radius: 6px;
    background: #176b87;
    color: white;
    cursor: pointer;
    font-weight: 700;
    padding: 0.72rem 1rem;
  }

  button:disabled {
    background: #94a3b8;
    cursor: not-allowed;
  }

  button:not(:disabled):hover {
    background: #11566d;
  }

  .secondaryButton {
    background: #e2e8f0;
    color: #1f2937;
  }

  .secondaryButton:not(:disabled):hover {
    background: #cbd5e1;
  }

  .modeToggle,
  .answerModes,
  .voiceControls,
  .studentActions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .app {
    width: min(1120px, calc(100% - 32px));
    margin: 0 auto;
    padding: 32px 0 56px;
  }

  .header {
    align-items: flex-start;
    border-bottom: 1px solid #d9e0e7;
    display: flex;
    gap: 16px;
    justify-content: space-between;
    margin-bottom: 24px;
    padding-bottom: 18px;
  }

  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }

  h1 {
    font-size: clamp(2rem, 4vw, 3.2rem);
    margin-bottom: 8px;
  }

  h2 {
    font-size: 1.25rem;
    margin: 0;
  }

  h3 {
    font-size: 1rem;
    margin-bottom: 10px;
  }

  .panel {
    background: white;
    border: 1px solid #dfe5eb;
    border-radius: 8px;
    margin-bottom: 18px;
    padding: 22px;
  }

  .studentRoom {
    background: #ffffff;
    border: 1px solid #dfe5eb;
    border-radius: 8px;
    padding: 24px;
  }

  .examinerHeader {
    align-items: flex-start;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    gap: 16px;
    justify-content: space-between;
    margin-bottom: 18px;
    padding-bottom: 16px;
  }

  .startPanel {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    display: grid;
    gap: 8px;
    padding: 18px;
  }

  .setupGrid {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(220px, 1fr) 160px 120px;
  }

  .studentMaterials {
    display: grid;
    gap: 8px;
    margin: 10px 0;
  }

  .studentMaterials h3 {
    margin-bottom: 0;
  }

  .questionStage {
    background: #102a43;
    border-radius: 8px;
    color: #ffffff;
    margin-bottom: 18px;
    padding: 24px;
  }

  .questionStage span {
    color: #a7d8f0;
    display: block;
    font-weight: 800;
    margin-bottom: 10px;
  }

  .questionStage p {
    font-size: clamp(1.35rem, 3vw, 2rem);
    line-height: 1.35;
    margin: 0;
  }

  .answerModes,
  .voiceControls,
  .studentActions {
    margin: 14px 0;
  }

  .summaryGrid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    margin-bottom: 18px;
  }

  .summaryCard {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
  }

  .summaryCard span {
    color: #64748b;
    display: block;
    font-size: 0.9rem;
    margin-bottom: 6px;
  }

  .summaryCard strong {
    color: #18202a;
    display: block;
  }

  .transcriptPanel {
    margin-top: 14px;
  }

  .historyItem {
    border-top: 1px solid #e2e8f0;
    padding: 14px 0;
  }

  .sectionTitle,
  .sourceHeading {
    align-items: center;
    display: flex;
    gap: 10px;
    justify-content: space-between;
    margin-bottom: 18px;
  }

  .sectionTitle {
    justify-content: flex-start;
  }

  .sourceHeading {
    margin-bottom: 6px;
  }

  .sourceHeading h3 {
    margin: 0;
  }

  .sourceHeading strong {
    color: #b45309;
    font-size: 0.9rem;
  }

  .sectionTitle span {
    align-items: center;
    background: #e8f3f5;
    border-radius: 999px;
    color: #176b87;
    display: inline-flex;
    font-weight: 800;
    height: 30px;
    justify-content: center;
    width: 30px;
  }

  .row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .grid {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(220px, 1fr) 180px 120px;
  }

  label {
    color: #334155;
    display: grid;
    font-weight: 700;
    gap: 8px;
  }

  input,
  select,
  textarea {
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    color: #18202a;
    padding: 0.7rem 0.78rem;
    width: 100%;
  }

  textarea {
    min-height: 160px;
    resize: vertical;
  }

  .progress {
    background: #e2e8f0;
    border-radius: 999px;
    height: 8px;
    margin-top: 14px;
    overflow: hidden;
  }

  .generationProgress {
    margin-top: 14px;
  }

  .generationProgress p {
    color: #64748b;
    margin: 8px 0 0;
  }

  .progress span {
    animation: loading 1.1s infinite ease-in-out;
    background: #176b87;
    border-radius: inherit;
    display: block;
    height: 100%;
    width: 38%;
  }

  @keyframes loading {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(270%);
    }
  }

  .status {
    background: #f1f7f9;
    border-left: 4px solid #176b87;
    margin: 14px 0 0;
    padding: 10px 12px;
  }

  .status.failed,
  .status.rejected {
    background: #fef2f2;
    border-color: #dc2626;
  }

  .hint,
  .muted {
    color: #64748b;
  }

  .hint {
    margin-top: 10px;
  }

  .sources {
    margin-top: 18px;
  }

  .sourceItem {
    align-items: center;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    display: grid;
    gap: 10px;
    grid-template-columns: auto 1fr auto;
    margin-top: 8px;
    padding: 10px 12px;
  }

  .sourceItem input {
    width: auto;
  }

  .sourceItem small {
    border-radius: 999px;
    color: #475569;
    background: #eef2f6;
    padding: 0.2rem 0.55rem;
  }

  .sourceItem.indexing {
    border-color: #f59e0b;
  }

  .sourceItem.indexed {
    border-color: #16a34a;
  }

  .sourceItem.failed {
    border-color: #dc2626;
  }

  .sourceItem.failed small {
    background: #fee2e2;
    color: #991b1b;
  }

  .sourceItem.indexing small {
    background: #fef3c7;
    color: #92400e;
  }

  .sourceItem.indexed small {
    background: #dcfce7;
    color: #166534;
  }

  .sourceItem em {
    color: #991b1b;
    font-size: 0.9rem;
    font-style: normal;
    grid-column: 2 / 4;
  }

  .cards {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    margin-top: 18px;
  }

  .card {
    border: 1px solid #dfe5eb;
    border-radius: 8px;
    display: grid;
    gap: 12px;
    padding: 16px;
  }

  .cardTop,
  .rubric {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: space-between;
  }

  .cardTop span,
  .rubric span {
    background: #eef2f6;
    border-radius: 999px;
    color: #475569;
    font-size: 0.88rem;
    padding: 0.28rem 0.55rem;
  }

  details {
    color: #475569;
  }

  summary {
    cursor: pointer;
    font-weight: 800;
  }

  .followups {
    color: #475569;
    font-size: 0.94rem;
  }

  .activeQuestion,
  .evaluation {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    margin-bottom: 14px;
    padding: 16px;
  }

  .score {
    color: #176b87;
    font-size: 2.5rem;
    font-weight: 900;
    margin-bottom: 10px;
  }

  @media (max-width: 760px) {
    .app {
      width: min(100% - 24px, 1120px);
      padding-top: 20px;
    }

    .grid {
      grid-template-columns: 1fr;
    }

    .setupGrid {
      grid-template-columns: 1fr;
    }

    .panel {
      padding: 16px;
    }

    .header,
    .examinerHeader {
      display: grid;
    }
  }
`;
