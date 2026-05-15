import React, { useEffect, useMemo, useRef, useState } from "react";
import { evaluateAnswer, evaluateStudentAnswer, generateStudentQuestions, transcribeAudio } from "./api.js";

export default function StudentViva({
  topic,
  difficulty,
  count,
  sources,
  selectedSourceIds,
  selectedSourceNames,
  canGenerate,
  onTopicChange,
  onDifficultyChange,
  onCountChange,
  onToggleSource,
}) {
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answerMode, setAnswerMode] = useState("text");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState([]);
  const [currentEvaluation, setCurrentEvaluation] = useState(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [followupActive, setFollowupActive] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const currentQuestion = questions[currentIndex];
  const displayedQuestion = followupActive && currentEvaluation?.followup_question
    ? currentEvaluation.followup_question
    : currentQuestion?.question;

  const summary = useMemo(() => buildSummary(history), [history]);

  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  useEffect(() => {
    if (sessionStarted && currentQuestion && !isMuted) {
      speak(currentQuestion.question);
    }
  }, [currentIndex, sessionStarted]);

  async function startSession() {
    if (!topic.trim()) {
      setStatus("Enter a topic before starting the viva.");
      return;
    }
    if (!canGenerate) {
      setStatus("Select at least one indexed PDF source.");
      return;
    }

    stopSpeaking();
    setIsGenerating(true);
    setStatus("Preparing your viva...");
    setHistory([]);
    setCurrentEvaluation(null);
    setSessionCompleted(false);
    setFollowupActive(false);
    setAnswer("");

    try {
      const data = await generateStudentQuestions({
        topic: topic.trim(),
        difficulty,
        count: Number(count),
        source_ids: selectedSourceIds,
      });
      setSessionId(data.session_id);
      setQuestions(data.questions || []);
      setCurrentIndex(0);
      setSessionStarted(true);
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsGenerating(false);
    }
  }

  function speak(text) {
    if (!window.speechSynthesis) {
      setStatus("Text-to-speech is not available in this browser.");
      return;
    }
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus("Voice recording is not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        await transcribeRecording();
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setStatus("Recording...");
    } catch (error) {
      setStatus(`Microphone permission denied or unavailable: ${error.message}`);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  async function transcribeRecording() {
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    if (!blob.size) {
      setStatus("No audio was captured.");
      return;
    }

    setIsTranscribing(true);
    setStatus("Transcribing audio...");
    try {
      const data = await transcribeAudio(blob);
      setAnswer(data.transcript || "");
      setStatus(data.transcript ? "Transcript ready. You can edit it before submitting." : data.message || "No transcript returned.");
    } catch (error) {
      setStatus(`Transcription failed: ${error.message}`);
    } finally {
      setIsTranscribing(false);
    }
  }

  async function submitAnswer() {
    if (!answer.trim()) {
      setStatus("Type or record an answer before submitting.");
      return;
    }

    setIsEvaluating(true);
    setStatus("Examiner is evaluating your answer...");
    try {
      const evaluation = followupActive
        ? await evaluateAnswer({
            question: displayedQuestion,
            expected_answer: currentEvaluation.expected_answer,
            student_answer: answer.trim(),
            topic,
            source_ids: selectedSourceIds,
          })
        : await evaluateStudentAnswer({
            session_id: sessionId,
            question_id: currentQuestion.id,
            student_answer: answer.trim(),
            topic,
            source_ids: selectedSourceIds,
          });

      const record = {
        questionNumber: currentIndex + 1,
        question: displayedQuestion,
        answer: answer.trim(),
        evaluation,
        isFollowup: followupActive,
      };
      setCurrentEvaluation(evaluation);
      setHistory((items) => [...items, record]);
      setStatus("Evaluation complete.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsEvaluating(false);
    }
  }

  function answerFollowup() {
    setFollowupActive(true);
    setAnswer("");
    setStatus("Answer the follow-up question.");
    if (!isMuted && currentEvaluation?.followup_question) {
      speak(currentEvaluation.followup_question);
    }
  }

  function nextQuestion() {
    stopSpeaking();
    setAnswer("");
    setCurrentEvaluation(null);
    setFollowupActive(false);
    setStatus("");
    if (currentIndex + 1 >= questions.length) {
      setSessionCompleted(true);
      setSessionStarted(false);
      return;
    }
    setCurrentIndex((index) => index + 1);
  }

  function finishViva() {
    stopSpeaking();
    setSessionCompleted(true);
    setSessionStarted(false);
  }

  if (sessionCompleted) {
    return (
      <section className="studentRoom">
        <h2>Viva Summary</h2>
        <div className="summaryGrid">
          <SummaryCard label="Questions answered" value={summary.totalAnswered} />
          <SummaryCard label="Average score" value={`${summary.averageScore}/5`} />
          <SummaryCard label="Strong areas" value={summary.strongAreas.join(", ") || "Developing"} />
          <SummaryCard label="Weakness areas" value={summary.weakAreas.join(", ") || "None flagged"} />
          <SummaryCard label="Revision topics" value={summary.revisionTopics.join(", ") || topic || "Review source PDF"} />
        </div>
        <div className="panel transcriptPanel">
          <h3>Full transcript</h3>
          {history.map((item, index) => (
            <article className="historyItem" key={`${item.question}-${index}`}>
              <strong>{item.isFollowup ? "Follow-up" : `Question ${item.questionNumber}`}</strong>
              <p>{item.question}</p>
              <p><b>Answer:</b> {item.answer}</p>
              <p><b>Score:</b> {item.evaluation.score}/5</p>
              <p>{item.evaluation.feedback}</p>
            </article>
          ))}
        </div>
        <button onClick={startSession}>Start New Viva</button>
      </section>
    );
  }

  if (!sessionStarted) {
    return (
      <section className="studentRoom">
        <div className="examinerHeader">
          <div>
            <h2>Student Viva Mode</h2>
            <p>Questions are shown one at a time. Expected answers stay hidden until you submit.</p>
          </div>
          <button className="secondaryButton" onClick={() => setIsMuted((value) => !value)}>
            {isMuted ? "Unmute" : "Mute"}
          </button>
        </div>
        <div className="startPanel">
          <div className="setupGrid">
            <label>
              Subject / topic
              <input
                value={topic}
                onChange={(event) => onTopicChange(event.target.value)}
                placeholder="e.g. proofs, automata, op-amp feedback"
              />
            </label>
            <label>
              Difficulty
              <select value={difficulty} onChange={(event) => onDifficultyChange(event.target.value)}>
                <option value="easy">easy</option>
                <option value="medium">medium</option>
                <option value="hard">hard</option>
              </select>
            </label>
            <label>
              Questions
              <input
                type="number"
                min="1"
                max="20"
                value={count}
                onChange={(event) => onCountChange(event.target.value)}
              />
            </label>
          </div>

          <div className="studentMaterials">
            <h3>Select material</h3>
            {sources.length === 0 ? (
              <p className="muted">Upload and index a PDF before starting.</p>
            ) : (
              sources.map((source) => (
                <label className={`sourceItem ${source.status}`} key={source.source_id}>
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes(source.source_id)}
                    disabled={source.status !== "indexed"}
                    onChange={() => onToggleSource(source.source_id)}
                  />
                  <span>{source.filename}</span>
                  <small>{source.status}</small>
                </label>
              ))
            )}
          </div>

          <p><b>Selected material:</b> {selectedSourceNames || "none selected"}</p>
          <button disabled={isGenerating || !canGenerate} onClick={startSession}>
            {isGenerating ? "Preparing Viva..." : "Start Viva"}
          </button>
        </div>
        {status && <p className="status">{status}</p>}
      </section>
    );
  }

  return (
    <section className="studentRoom">
      <div className="examinerHeader">
        <div>
          <h2>Live Viva</h2>
          <p>Question {currentIndex + 1} of {questions.length}</p>
        </div>
        <div className="row">
          <button className="secondaryButton" onClick={() => setIsMuted((value) => !value)}>
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button className="secondaryButton" onClick={() => speak(displayedQuestion)}>
            {isSpeaking ? "Replay" : "Read Question Aloud"}
          </button>
          <button className="secondaryButton" onClick={stopSpeaking}>Stop Audio</button>
        </div>
      </div>

      <article className="questionStage">
        <span>{followupActive ? "Follow-up" : `Question ${currentIndex + 1}`}</span>
        <p>{displayedQuestion}</p>
      </article>

      <div className="answerModes">
        <button className={answerMode === "text" ? "" : "secondaryButton"} onClick={() => setAnswerMode("text")}>Text Answer</button>
        <button className={answerMode === "voice" ? "" : "secondaryButton"} onClick={() => setAnswerMode("voice")}>Voice Answer</button>
      </div>

      {answerMode === "voice" && (
        <div className="voiceControls">
          <button disabled={isRecording || isTranscribing} onClick={startRecording}>Start Recording</button>
          <button className="secondaryButton" disabled={!isRecording} onClick={stopRecording}>Stop Recording</button>
          {isTranscribing && <p className="muted">Transcribing...</p>}
        </div>
      )}

      <label>
        Your answer
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder="Type your answer, or record and edit the transcript here..."
        />
      </label>

      {!currentEvaluation ? (
        <button disabled={isEvaluating} onClick={submitAnswer}>
          {isEvaluating ? "Evaluating..." : "Submit Answer"}
        </button>
      ) : (
        <EvaluationResult evaluation={currentEvaluation} />
      )}

      {currentEvaluation && (
        <div className="studentActions">
          {currentEvaluation.followup_question && !followupActive && (
            <button className="secondaryButton" onClick={answerFollowup}>Answer Follow-up</button>
          )}
          <button onClick={nextQuestion}>
            {currentIndex + 1 >= questions.length ? "Finish Viva" : "Next Question"}
          </button>
          <button className="secondaryButton" onClick={finishViva}>Finish Viva</button>
        </div>
      )}

      {status && <p className="status">{status}</p>}
    </section>
  );
}

function EvaluationResult({ evaluation }) {
  return (
    <div className="evaluation">
      <div className="score">{evaluation.score}/5</div>
      <div className="rubric">
        <span>Correctness: {evaluation.correctness}/5</span>
        <span>Depth: {evaluation.depth}/5</span>
        <span>Clarity: {evaluation.clarity}/5</span>
      </div>
      <p>{evaluation.feedback}</p>
      <h3>Expected answer</h3>
      <p>{evaluation.expected_answer || "Expected answer is available after main-question evaluation."}</p>
      <h3>Missing points</h3>
      {evaluation.missing_points?.length ? (
        <ul>{evaluation.missing_points.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul>
      ) : (
        <p className="muted">No major missing points returned.</p>
      )}
      <h3>Follow-up question</h3>
      <p>{evaluation.followup_question || "No follow-up returned."}</p>
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="summaryCard">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildSummary(history) {
  const mainAnswers = history.filter((item) => !item.isFollowup);
  const scores = mainAnswers.map((item) => Number(item.evaluation.score || 0));
  const average = scores.length
    ? (scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(1)
    : "0.0";
  const weak = new Set();
  const strong = new Set();
  const revision = new Set();

  mainAnswers.forEach((item) => {
    if (Number(item.evaluation.score) >= 4) {
      strong.add(item.question.split(" ").slice(0, 5).join(" "));
    }
    if (Number(item.evaluation.score) < 3) {
      weak.add(item.question.split(" ").slice(0, 5).join(" "));
      item.evaluation.missing_points?.forEach((point) => revision.add(point));
    }
  });

  return {
    totalAnswered: mainAnswers.length,
    averageScore: average,
    weakAreas: [...weak].slice(0, 4),
    strongAreas: [...strong].slice(0, 4),
    revisionTopics: [...revision].slice(0, 5),
  };
}
