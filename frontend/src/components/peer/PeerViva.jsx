import React, { useMemo, useState } from "react";
import { evaluateStudentAnswer, generateStudentQuestions, transcribeAudio } from "../../api.js";

const initialStudents = [
  { id: "A", name: "Student A", answers: [], scores: [], weaknesses: [], strengths: [] },
  { id: "B", name: "Student B", answers: [], scores: [], weaknesses: [], strengths: [] },
];

export default function PeerViva({ sources, selectedSourceIds, selectedSourceNames, canGenerate, onToggleSource }) {
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [rounds, setRounds] = useState(2);
  const [students, setStudents] = useState(initialStudents);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [answerMode, setAnswerMode] = useState("text");
  const [cameraCoaching, setCameraCoaching] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [currentStudentId, setCurrentStudentId] = useState("A");
  const [sessionId, setSessionId] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [answer, setAnswer] = useState("");
  const [peerFeedback, setPeerFeedback] = useState({ good: "", missing: "", improvement: "" });
  const [currentEvaluation, setCurrentEvaluation] = useState(null);
  const [turnHistory, setTurnHistory] = useState([]);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [chunks, setChunks] = useState([]);

  const currentStudent = students.find((student) => student.id === currentStudentId);
  const otherStudent = students.find((student) => student.id !== currentStudentId);
  const summaries = useMemo(() => students.map((student) => summarizeStudent(student)), [students]);

  async function startPeerViva() {
    if (!topic.trim()) {
      setStatus("Enter a topic before starting Peer Mode.");
      return;
    }
    if (!canGenerate) {
      setStatus("Select at least one indexed material.");
      return;
    }

    setSessionStarted(true);
    setSessionCompleted(false);
    setCurrentRound(1);
    setCurrentStudentId("A");
    setTurnHistory([]);
    setCurrentEvaluation(null);
    await loadTurnQuestion(1, "A", []);
  }

  async function loadTurnQuestion(round, studentId, history) {
    setIsLoading(true);
    setAnswer("");
    setPeerFeedback({ good: "", missing: "", improvement: "" });
    setCurrentEvaluation(null);
    setStatus(`AI moderator is preparing Round ${round} for Student ${studentId}...`);
    try {
      const usedQuestions = history.map((item) => item.question?.question).filter(Boolean);
      const data = await generateStudentQuestions({
        topic: `${topic.trim()}. Avoid these exact previous questions: ${usedQuestions.join(" | ")}`,
        difficulty,
        count: 1,
        source_ids: selectedSourceIds,
      });
      setSessionId(data.session_id);
      setCurrentQuestion(data.questions?.[0] || null);
      setStatus(`AI Moderator: ${studentName(studentId)} will answer this turn.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function submitTurnAnswer() {
    if (!answer.trim()) {
      setStatus("Enter or record an answer before evaluation.");
      return;
    }
    if (!currentQuestion) return;

    setIsLoading(true);
    setStatus("AI moderator is evaluating the answer...");
    try {
      const evaluation = await evaluateStudentAnswer({
        session_id: sessionId,
        question_id: currentQuestion.id,
        student_answer: answer.trim(),
        topic,
        source_ids: selectedSourceIds,
      });
      const turn = {
        round: currentRound,
        studentId: currentStudentId,
        studentName: currentStudent.name,
        question: currentQuestion,
        answer: answer.trim(),
        peerFeedback,
        evaluation,
      };
      setCurrentEvaluation(evaluation);
      setTurnHistory((items) => [...items, turn]);
      setStudents((items) =>
        items.map((student) =>
          student.id === currentStudentId
            ? {
                ...student,
                answers: [...student.answers, turn],
                scores: [...student.scores, Number(evaluation.score || 0)],
                weaknesses: [...student.weaknesses, ...(evaluation.missing_points || [])],
                strengths: Number(evaluation.score || 0) >= 4 ? [...student.strengths, currentQuestion.question] : student.strengths,
              }
            : student,
        ),
      );
      setStatus("Evaluation complete. Peer feedback can be added before moving on.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function nextTurn() {
    const nextStudentId = currentStudentId === "A" ? "B" : "A";
    const nextRound = currentStudentId === "A" ? currentRound : currentRound + 1;
    const nextHistory = turnHistory;
    if (nextRound > Number(rounds)) {
      setSessionCompleted(true);
      setSessionStarted(false);
      return;
    }
    setCurrentStudentId(nextStudentId);
    setCurrentRound(nextRound);
    await loadTurnQuestion(nextRound, nextStudentId, nextHistory);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const localChunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) localChunks.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setChunks(localChunks);
        const blob = new Blob(localChunks, { type: "audio/webm" });
        const data = await transcribeAudio(blob);
        setAnswer(data.transcript || "");
        setStatus(data.transcript ? "Transcript ready." : data.message || "No transcript returned.");
      };
      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (error) {
      setStatus(`Microphone unavailable: ${error.message}`);
    }
  }

  function stopRecording() {
    if (mediaRecorder?.state !== "inactive") mediaRecorder.stop();
    setIsRecording(false);
  }

  function studentName(id) {
    return students.find((student) => student.id === id)?.name || `Student ${id}`;
  }

  if (sessionCompleted) {
    return <PeerSummary summaries={summaries} turnHistory={turnHistory} topic={topic} />;
  }

  if (!sessionStarted) {
    return (
      <section className="studentRoom">
        <div className="examinerHeader">
          <div>
            <h2>Peer Mode</h2>
            <p>Two students take turns while the AI moderator asks and evaluates questions.</p>
          </div>
        </div>
        <div className="startPanel">
          <div className="setupGrid">
            <label>Topic<input value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
            <label>Difficulty<select value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="easy">easy</option><option value="medium">medium</option><option value="hard">hard</option></select></label>
            <label>Rounds<input type="number" min="1" max="10" value={rounds} onChange={(event) => setRounds(event.target.value)} /></label>
          </div>
          <div className="setupGrid">
            <label>Student A<input value={students[0].name} onChange={(event) => setStudents(([a, b]) => [{ ...a, name: event.target.value }, b])} /></label>
            <label>Student B<input value={students[1].name} onChange={(event) => setStudents(([a, b]) => [a, { ...b, name: event.target.value }])} /></label>
          </div>
          <div className="answerModes">
            <label className="inlineToggle"><input type="checkbox" checked={voiceEnabled} onChange={(event) => setVoiceEnabled(event.target.checked)} /> Voice enabled</label>
            <label className="inlineToggle"><input type="checkbox" checked={cameraCoaching} onChange={(event) => setCameraCoaching(event.target.checked)} /> Camera coaching optional</label>
          </div>
          <div className="studentMaterials">
            <h3>Select material</h3>
            {sources.map((source) => (
              <label className={`sourceItem ${source.status}`} key={source.source_id}>
                <input type="checkbox" checked={selectedSourceIds.includes(source.source_id)} disabled={source.status !== "indexed"} onChange={() => onToggleSource(source.source_id)} />
                <span>{source.filename}</span>
                <small>{source.status}</small>
              </label>
            ))}
          </div>
          <p><b>Selected material:</b> {selectedSourceNames || "none selected"}</p>
          <button disabled={isLoading || !canGenerate} onClick={startPeerViva}>Start Peer Viva</button>
        </div>
        {status && <p className="status">{status}</p>}
      </section>
    );
  }

  return (
    <section className="studentRoom">
      <div className="peerScoreboard">
        {students.map((student) => (
          <div className={`summaryCard ${student.id === currentStudentId ? "activePeer" : ""}`} key={student.id}>
            <span>{student.name}</span>
            <strong>{average(student.scores)}/5</strong>
            <small>{student.answers.length} answered</small>
          </div>
        ))}
      </div>

      <article className="questionStage">
        <span>AI Moderator · Round {currentRound} · {currentStudent.name}'s turn</span>
        <p>{currentQuestion?.question || "Preparing question..."}</p>
      </article>

      <label>
        {currentStudent.name}'s answer
        <textarea value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type the answer here..." />
      </label>

      <div className="answerModes">
        <button className={answerMode === "text" ? "" : "secondaryButton"} onClick={() => setAnswerMode("text")}>
          Text Answer
        </button>
        <button
          className={answerMode === "voice" ? "" : "secondaryButton"}
          disabled={!voiceEnabled}
          onClick={() => setAnswerMode("voice")}
        >
          Voice Answer
        </button>
      </div>

      {voiceEnabled && answerMode === "voice" && (
        <div className="voiceControls">
          <button disabled={isRecording} onClick={startRecording}>Start Recording</button>
          <button className="secondaryButton" disabled={!isRecording} onClick={stopRecording}>Stop Recording</button>
        </div>
      )}

      <div className="peerFeedbackBox">
        <h3>{otherStudent.name}'s optional peer feedback</h3>
        <label>What was good?<input value={peerFeedback.good} onChange={(event) => setPeerFeedback({ ...peerFeedback, good: event.target.value })} /></label>
        <label>What was missing?<input value={peerFeedback.missing} onChange={(event) => setPeerFeedback({ ...peerFeedback, missing: event.target.value })} /></label>
        <label>One suggested improvement<input value={peerFeedback.improvement} onChange={(event) => setPeerFeedback({ ...peerFeedback, improvement: event.target.value })} /></label>
      </div>

      {!currentEvaluation ? (
        <button disabled={isLoading} onClick={submitTurnAnswer}>{isLoading ? "Evaluating..." : "Evaluate Turn"}</button>
      ) : (
        <div className="evaluation">
          <div className="score">{currentEvaluation.score}/5</div>
          <p>{currentEvaluation.feedback}</p>
          <h3>Expected answer</h3>
          <p>{currentEvaluation.expected_answer}</p>
          <h3>Follow-up</h3>
          <p>{currentEvaluation.followup_question || "No follow-up returned."}</p>
          <button onClick={nextTurn}>Next Turn</button>
        </div>
      )}
      {status && <p className="status">{status}</p>}
    </section>
  );
}

function PeerSummary({ summaries, turnHistory, topic }) {
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ topic, summaries, turnHistory }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "peer-viva-summary.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="studentRoom">
      <h2>Peer Viva Summary</h2>
      <div className="summaryGrid">
        {summaries.map((summary) => (
          <div className="summaryCard" key={summary.id}>
            <span>{summary.name}</span>
            <strong>{summary.averageScore}/5</strong>
            <p>{summary.answers} answers</p>
            <p><b>Weaknesses:</b> {summary.weaknesses.join(", ") || "None flagged"}</p>
          </div>
        ))}
      </div>
      <div className="panel transcriptPanel">
        <h3>Shared revision plan</h3>
        <p>{[...new Set(summaries.flatMap((summary) => summary.weaknesses))].slice(0, 6).join(", ") || "Review the selected material and repeat the viva."}</p>
        {turnHistory.map((turn, index) => (
          <article className="historyItem" key={`${turn.studentId}-${index}`}>
            <strong>Round {turn.round}: {turn.studentName}</strong>
            <p>{turn.question.question}</p>
            <p><b>Answer:</b> {turn.answer}</p>
            <p><b>Score:</b> {turn.evaluation.score}/5</p>
            <p><b>Peer feedback:</b> {[turn.peerFeedback.good, turn.peerFeedback.missing, turn.peerFeedback.improvement].filter(Boolean).join(" | ") || "None"}</p>
          </article>
        ))}
      </div>
      <button onClick={exportJson}>Export JSON</button>
    </section>
  );
}

function summarizeStudent(student) {
  return {
    id: student.id,
    name: student.name,
    answers: student.answers.length,
    averageScore: average(student.scores),
    weaknesses: [...new Set(student.weaknesses)].slice(0, 5),
    strengths: student.strengths.slice(0, 3),
  };
}

function average(scores) {
  if (!scores.length) return "0.0";
  return (scores.reduce((total, score) => total + Number(score || 0), 0) / scores.length).toFixed(1);
}
