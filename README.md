# Edwisely-VivaSimulator

Adaptive AI viva simulator for engineering students. Upload subject PDFs, generate RAG-grounded oral exam questions, answer in text mode, and receive scored feedback with targeted follow-ups. Built with React, FastAPI, LlamaIndex, Groq, and OpenAI embeddings.

## Phase 0 Features

- Upload and index one or more PDF sources.
- Select one or more indexed PDFs for question generation.
- Developer Mode: generate and inspect all viva questions, expected answers, and follow-ups.
- Student Mode: run an examiner-like viva one question at a time without revealing expected answers before submission.
- Submit a typed answer and receive score, feedback, missing points, and a targeted follow-up.
- Use browser text-to-speech to read questions aloud.
- Record voice answers in the browser and send audio to the backend transcription endpoint.

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

The API will run at `http://localhost:8000`.

### LLM Provider

The default Phase 0 setup uses Ollama for question generation and answer evaluation.

```env
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_TIMEOUT=300
```

Groq is still available as an optional provider. Create an API key from the Groq console, then add it to `backend/.env`.

Use `llama-3.1-8b-instant` for the fastest/cheap demo model. Use `llama-3.3-70b-versatile` when you want better answer quality.

```env
LLM_PROVIDER=groq
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=llama-3.1-8b-instant
GROQ_MAX_TOKENS=4096
MAX_CONTEXT_CHUNKS=8
```

Embeddings are still OpenAI by default for RAG indexing and retrieval:

```env
OPENAI_API_KEY=your_key_here
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_PROVIDER=openai
```

If you already created indexes with the previous local Ollama embedding setup, either re-upload PDFs with OpenAI embeddings or temporarily set:

```env
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The frontend will run at `http://localhost:5173`.

To point the frontend to a different backend URL:

```bash
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

## API Endpoints

- `GET /health` returns API status.
- `GET /sources` lists indexed PDF sources.
- `POST /upload-pdf` uploads and indexes a PDF.
- `POST /generate-questions` generates full RAG-grounded viva questions for Developer Mode.
- `POST /generate-student-questions` generates Student Mode questions without expected answers.
- `POST /evaluate-answer` scores a typed answer with explicit expected answer input.
- `POST /evaluate-student-answer` scores a Student Mode answer using backend in-memory session metadata.
- `POST /api/transcribe` accepts an audio file and returns `{ "transcript": "..." }`.

## Student Mode

Student Mode keeps generated expected answers hidden until after the student submits. The backend stores full question metadata in process memory for the active session and returns only `id`, `question`, and `difficulty` to the frontend.

Known v0 limitations:

- Student sessions are in memory only and reset when the backend restarts.
- Browser text-to-speech depends on `window.speechSynthesis` support.
- Browser voice recording depends on microphone permission and `MediaRecorder` support.

## Voice Transcription

The transcription endpoint is present by default. Without Whisper enabled it returns an empty transcript with a setup message, so the frontend flow can still be tested.

To enable local Whisper:

```bash
cd backend
source .venv/bin/activate
uv pip install openai-whisper
```

Then set:

```env
ENABLE_WHISPER=true
WHISPER_MODEL=base
```

Whisper may require `ffmpeg` to be installed on your machine. On macOS:

```bash
brew install ffmpeg
```

## Local Data

Uploaded PDFs are stored in `backend/uploads`. Persisted LlamaIndex source indexes, source metadata, and temporary audio uploads are stored in `backend/storage`. These runtime files are ignored by git except for `.gitkeep` placeholders.
