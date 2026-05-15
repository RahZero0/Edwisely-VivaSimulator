# Edwisely Viva Simulator

Adaptive AI viva/oral-exam simulator for engineering students. Students upload subject PDFs, generate RAG-grounded viva questions, answer through text or voice, receive evaluation feedback, and can practice individually or with a peer.

The app currently supports three modes:

- **Developer Mode**: inspect generated questions, expected answers, follow-ups, and debug the RAG flow.
- **Student Mode**: one-question-at-a-time viva flow with hidden expected answers, text/voice answers, read-aloud questions, evaluation, and session summary.
- **Peer Mode**: two students take turns while the AI acts as a moderator, evaluates answers, and includes optional peer feedback.

## Tech Stack

- **Frontend**: React, Vite, JavaScript, Redux Toolkit
- **Backend**: Python, FastAPI
- **RAG**: LlamaIndex with local persisted indexes
- **Default LLM**: Ollama
- **Optional LLM**: Groq
- **Default embeddings for current local setup**: Ollama embeddings
- **Optional embeddings**: OpenAI embeddings
- **Voice recording**: Browser `MediaRecorder`
- **Question read-aloud**: Browser `SpeechSynthesis`
- **Transcription**: Backend endpoint with local Whisper stub/optional local Whisper support
- **Camera coaching**: Local browser-only analyzer abstraction

## Repository Structure

```text
backend/
  main.py              FastAPI app, RAG, LLM calls, evaluation, transcription
  requirements.txt     Python dependencies
  .env.example         Backend environment variables
  uploads/             Uploaded PDF files
  storage/             Persisted LlamaIndex indexes, metadata, temp audio

frontend/
  index.html
  package.json
  vite.config.js
  src/
    App.jsx                         App shell, upload UI, mode switch, Developer Mode
    StudentViva.jsx                 Student Mode flow
    api.js                          Frontend API helpers
    store.js                        Redux state for sources/questions/shared config
    main.jsx                        React entrypoint
    lib/
      bodyLanguageAnalyzer.js       Local camera-coaching abstraction
    components/
      student/
        CameraCoachingPanel.jsx     Webcam preview and coaching badges
        CommunicationFeedback.jsx   Per-answer communication feedback
      peer/
        PeerViva.jsx                Peer Mode setup, turn flow, summary
```

## Feature Overview

### PDF Upload and Indexing

The backend accepts PDF uploads through `POST /upload-pdf`.

Flow:

1. The PDF is saved to `backend/uploads`.
2. LlamaIndex loads the PDF text.
3. A vector index is built with the configured embedding provider.
4. The index is persisted under `backend/storage/sources/{source_id}`.
5. Source metadata is stored in `backend/storage/sources.json`.

The frontend polls `GET /sources` and shows each source as `indexing`, `indexed`, or `failed`.

### RAG Question Generation

Question generation retrieves context from selected PDF indexes and asks the configured LLM to produce viva-style conceptual questions.

Developer Mode uses:

- `POST /generate-questions`
- Returns full metadata:
  - question
  - difficulty
  - expected answer
  - follow-up if good
  - follow-up if poor

Student Mode and Peer Mode use:

- `POST /generate-student-questions`
- Returns only safe question fields:
  - id
  - question
  - difficulty

Expected answers are stored in backend process memory for the active student session and are not sent to the frontend before submission.

### Answer Evaluation

The backend evaluates answers using the selected LLM.

Developer Mode:

- Uses `POST /evaluate-answer`
- Frontend already has expected answer metadata.

Student Mode and Peer Mode:

- Use `POST /evaluate-student-answer`
- Frontend sends only:
  - session id
  - question id
  - student answer
  - topic/source ids
- Backend retrieves the expected answer from in-memory session state.
- Expected answer is returned only after the student submits.

Evaluation output includes:

- score
- correctness
- depth
- clarity
- feedback
- missing points
- follow-up question
- expected answer after submission

## Modes

### Developer Mode

Developer Mode is for testing and debugging.

It shows:

- all generated questions
- expected answers
- follow-up prompts
- current selected source material
- answer/evaluation UI

This mode is intentionally more transparent and developer-facing.

### Student Mode

Student Mode is the main viva experience.

Setup:

- select topic/subject
- select difficulty
- select number of questions
- select source material/PDFs
- optionally enable Camera Coaching

During viva:

- student sees one question at a time
- expected answers are hidden before submission
- upcoming questions are hidden
- question can be read aloud
- question auto-read can be muted/unmuted
- answer can be typed or recorded by voice
- voice recordings are sent to backend transcription
- transcript appears in the answer box and can be edited
- after submission, score/feedback/missing points/expected answer/follow-up are shown

End summary:

- total questions answered
- average score
- communication score if camera coaching was enabled
- camera attention percentage
- face visibility percentage
- strong areas
- weak areas
- suggested revision topics
- full Q&A transcript/history

### Peer Mode

Peer Mode is for two-student practice.

Setup:

- topic
- difficulty
- number of rounds
- Student A name
- Student B name
- source material/PDFs
- voice enabled toggle
- optional camera coaching toggle

Flow:

1. AI moderator prepares a question for Student A.
2. Student A answers using text or voice.
3. Student B may add optional peer feedback.
4. AI evaluates Student A.
5. Turn switches to Student B.
6. The cycle repeats for each round.
7. Final summary compares both students and provides a shared revision plan.

Peer Mode keeps expected answers hidden until after the current student submits. Peer feedback is included in the summary but does not override AI evaluation.

## Voice Features

### Question Read-Aloud

Question read-aloud uses the browser `SpeechSynthesis` API.

Important notes:

- Voice quality depends on the browser and OS voices installed.
- It may sound robotic on some systems.
- The app supports replay, mute/unmute, and stop audio.
- A future improvement would be adding a voice selector and rate/pitch controls.

### Voice Answer Recording

Voice answers use the browser `MediaRecorder` API.

Flow:

1. Student clicks **Start Recording**.
2. Browser asks for microphone permission.
3. Audio chunks are collected locally.
4. Student clicks **Stop Recording**.
5. Audio blob is sent to `POST /api/transcribe`.
6. Returned transcript is inserted into the answer box.
7. Student can edit transcript before submitting.

The app handles:

- microphone permission denied
- unsupported browser recording APIs
- transcription failure
- empty answer submission

## Transcription

The backend has a transcription endpoint:

```text
POST /api/transcribe
```

It accepts `multipart/form-data` with an audio file and returns:

```json
{
  "transcript": "..."
}
```

By default, transcription is a stub so the frontend flow can be tested without installing heavy packages.

To enable local Whisper:

```bash
cd backend
source .venv/bin/activate
uv pip install openai-whisper
```

Install `ffmpeg` if needed.

On macOS:

```bash
brew install ffmpeg
```

Set in `backend/.env`:

```env
ENABLE_WHISPER=true
WHISPER_MODEL=base
```

Then restart the backend.

## Camera Coaching

Camera Coaching is optional and runs locally in the browser.

It is **not** a cheating detector and must not be used as proctoring.

The app uses neutral communication-coaching language only:

- face visible
- facing camera
- posture okay
- posture could improve
- try to face the camera more while explaining

Privacy behavior:

- raw webcam frames are not uploaded to the backend
- webcam recordings are not saved
- only aggregate metrics are stored in frontend session memory

Tracked metrics:

- faceVisiblePercent
- cameraAttentionPercent
- postureScore
- movementStabilityScore
- lookedAwayEvents
- faceMissingEvents
- slouchingEvents
- totalTrackedSeconds

Current implementation:

- Uses `frontend/src/lib/bodyLanguageAnalyzer.js`
- Provides a lightweight local analyzer abstraction
- Does not install MediaPipe yet
- Can be replaced later with MediaPipe Tasks Vision behind the same abstraction

Known limitations:

- Eye contact is only an approximation based on face/camera orientation.
- Posture scoring depends on camera angle and lighting.
- This should not be used for high-stakes proctoring.

## Scoring

Backend evaluation returns a 0-5 score plus rubric fields:

- correctness
- depth
- clarity

Student Mode also records communication metrics when Camera Coaching is enabled.

Current v1 behavior:

- content/evaluation score remains the primary viva score
- communication score is shown separately
- final summary includes both academic and communication feedback

The intended product weighting is:

- 70% content score
- 20% clarity score
- 10% communication score

This weighting can be formalized in a later backend scoring endpoint.

## Backend Setup

The recommended Python dependency flow uses `uv`.

```bash
cd backend
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

The API runs at:

```text
http://localhost:8000
```

Health check:

```bash
curl http://localhost:8000/health
```

Expected:

```json
{"status":"ok"}
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at:

```text
http://localhost:5173
```

If the backend runs on a different port:

```bash
VITE_API_BASE_URL=http://localhost:8001 npm run dev
```

The current Vite config also proxies API paths to `http://localhost:8000`.

## Ollama Setup

The default local setup uses Ollama for generation/evaluation and Ollama embeddings for current local indexes.

Start Ollama:

```bash
ollama serve
```

Pull models:

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

Recommended local `.env`:

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT=300

EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

## Optional Groq Setup

Groq can be used for generation/evaluation, but the current default is Ollama because Groq free/on-demand limits can be restrictive with RAG prompts.

Create a Groq API key from the Groq console and set:

```env
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=llama-3.1-8b-instant
GROQ_MAX_TOKENS=4096
```

Model notes:

- `llama-3.1-8b-instant`: fastest/cheap demo model
- `llama-3.3-70b-versatile`: better quality model

If Groq returns token-per-minute errors, reduce:

- selected source count
- question count
- `MAX_CONTEXT_CHUNKS`
- `MAX_CONTEXT_CHARS`

## Optional OpenAI Embeddings

OpenAI embeddings are supported for indexing/retrieval:

```env
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
EMBEDDING_MODEL=text-embedding-3-small
```

Important:

- Existing indexes created with Ollama embeddings should continue using `EMBEDDING_PROVIDER=ollama`.
- If you switch embedding providers, re-upload/re-index PDFs.

## Environment Variables

Backend `.env` variables:

```env
# LLM provider: ollama or groq
LLM_PROVIDER=ollama

# Ollama LLM
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT=300

# Groq LLM
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant
GROQ_MAX_TOKENS=4096

# Embeddings: ollama or openai
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
OPENAI_API_KEY=
EMBEDDING_MODEL=text-embedding-3-small

# Retrieval/context limits
MAX_CONTEXT_CHARS=12000
MAX_CONTEXT_CHUNKS=8

# Transcription
ENABLE_WHISPER=false
WHISPER_MODEL=base
```

Frontend optional env:

```env
VITE_API_BASE_URL=http://localhost:8000
```

## API Endpoints

### Health

```text
GET /health
```

Returns:

```json
{"status":"ok"}
```

### Sources

```text
GET /sources
```

Returns indexed PDF sources and indexing status.

### Upload PDF

```text
POST /upload-pdf
```

Accepts a PDF file as multipart form data.

### Developer Question Generation

```text
POST /generate-questions
```

Request:

```json
{
  "topic": "proof by contradiction",
  "difficulty": "medium",
  "count": 3,
  "source_ids": ["..."]
}
```

Returns full metadata including expected answers.

### Student-Safe Question Generation

```text
POST /generate-student-questions
```

Returns:

```json
{
  "session_id": "...",
  "questions": [
    {
      "id": 1,
      "question": "...",
      "difficulty": "medium"
    }
  ]
}
```

Expected answers are not included.

### Developer Answer Evaluation

```text
POST /evaluate-answer
```

Requires the expected answer in the request.

### Student Answer Evaluation

```text
POST /evaluate-student-answer
```

Uses backend in-memory session metadata to find the expected answer.

### Transcription

```text
POST /api/transcribe
```

Accepts an audio file and returns a transcript.

## Local Data

Runtime data is stored locally:

```text
backend/uploads/             Uploaded PDFs
backend/storage/sources/     Persisted LlamaIndex indexes
backend/storage/sources.json Source metadata
backend/storage/transcripts/ Temporary uploaded audio files
```

These files are ignored by git except `.gitkeep` placeholders.

## Troubleshooting

### Vite proxy error: ECONNREFUSED /sources

The frontend is running but the backend is not reachable.

Start backend:

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

### Ollama connection errors

Start Ollama:

```bash
ollama serve
```

Check model availability:

```bash
ollama list
```

Pull missing models:

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

### No transcript returned

Whisper is disabled by default.

Enable:

```env
ENABLE_WHISPER=true
WHISPER_MODEL=base
```

Install:

```bash
uv pip install openai-whisper
```

### Robotic read-aloud voice

Question read-aloud uses browser/OS voices. Quality depends on installed voices. A future improvement is adding voice selection and rate/pitch controls.

### Bad PDF context or weak questions

Some PDFs are scanned, image-based, or extract text poorly. If retrieval returns unreadable text:

- use a text-based PDF
- select fewer sources
- re-upload the PDF
- add OCR in a future version

## Known Limitations

- No database persistence yet.
- Student sessions are stored in backend memory and reset when backend restarts.
- Peer Mode session state is stored in frontend memory.
- Voice transcription requires local Whisper setup for real transcripts.
- Browser TTS quality depends on installed voices.
- Camera Coaching is approximate and local-only.
- Camera Coaching is not proctoring and must not be used as cheating detection.
- The app is for practice and formative feedback, not formal grading.

## Verification Commands

Backend syntax check:

```bash
cd backend
.venv/bin/python -m py_compile main.py
```

Frontend build:

```bash
cd frontend
npm run build
```

