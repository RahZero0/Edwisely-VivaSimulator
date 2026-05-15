import json
import logging
import os
import re
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq as GroqClient
from pydantic import BaseModel, Field

from llama_index.core import (
    Settings,
    SimpleDirectoryReader,
    StorageContext,
    VectorStoreIndex,
    load_index_from_storage,
)
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.llms.groq import Groq as LlamaIndexGroq
from llama_index.llms.ollama import Ollama


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

UPLOAD_DIR = BASE_DIR / "uploads"
STORAGE_DIR = BASE_DIR / "storage"
SOURCES_DIR = STORAGE_DIR / "sources"
SOURCES_FILE = STORAGE_DIR / "sources.json"
TRANSCRIPTS_DIR = STORAGE_DIR / "transcripts"
MAX_CONTEXT_CHARS = int(os.getenv("MAX_CONTEXT_CHARS", "12000"))
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "4096"))
MAX_CONTEXT_CHUNKS = int(os.getenv("MAX_CONTEXT_CHUNKS", "8"))
ENABLE_WHISPER = os.getenv("ENABLE_WHISPER", "false").lower().strip() == "true"
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")

logger = logging.getLogger("viva")
logger.setLevel(logging.INFO)

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SOURCES_DIR.mkdir(parents=True, exist_ok=True)
TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

STUDENT_SESSIONS: dict[str, dict[str, Any]] = {}

app = FastAPI(title="Edwisely Viva Simulator API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def validate_startup_configuration() -> None:
    validate_provider_configuration()


class GenerateQuestionsRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    count: int = Field(5, ge=1, le=20)
    source_ids: list[str] | None = None


class EvaluateAnswerRequest(BaseModel):
    question: str = Field(..., min_length=1)
    expected_answer: str = Field(..., min_length=1)
    student_answer: str = Field(..., min_length=1)
    topic: str = Field(..., min_length=1)
    source_ids: list[str] | None = None


class GenerateStudentQuestionsRequest(GenerateQuestionsRequest):
    pass


class EvaluateStudentAnswerRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    question_id: int
    student_answer: str = Field(..., min_length=1)
    topic: str = Field(..., min_length=1)
    source_ids: list[str] | None = None


def read_sources() -> list[dict[str, Any]]:
    if not SOURCES_FILE.exists():
        return []
    try:
        return json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=500,
            detail="Source metadata is corrupted. Delete backend/storage/sources.json and re-upload PDFs.",
        )


def write_sources(sources: list[dict[str, Any]]) -> None:
    SOURCES_FILE.write_text(json.dumps(sources, indent=2), encoding="utf-8")


def update_source(source_id: str, updates: dict[str, Any]) -> None:
    sources = read_sources()
    for source in sources:
        if source["source_id"] == source_id:
            source.update(updates)
            write_sources(sources)
            return


def safe_filename(filename: str) -> str:
    cleaned = Path(filename).name.replace(" ", "_")
    return cleaned or "uploaded.pdf"


def validate_provider_configuration() -> None:
    llm_provider = os.getenv("LLM_PROVIDER", "ollama").lower().strip()
    if llm_provider == "groq" and not os.getenv("GROQ_API_KEY"):
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is required when LLM_PROVIDER=groq.")
    if llm_provider != "groq" and llm_provider != "ollama":
        raise HTTPException(status_code=500, detail="Unsupported LLM_PROVIDER. Use 'ollama' or 'groq'.")

    embedding_provider = os.getenv("EMBEDDING_PROVIDER", "openai").lower().strip()
    if embedding_provider == "openai":
        openai_api_key = os.getenv("OPENAI_API_KEY")
        if not openai_api_key:
            raise HTTPException(
                status_code=500,
                detail="OPENAI_API_KEY is required because EMBEDDING_PROVIDER=openai.",
            )
        return

    if embedding_provider == "ollama":
        return

    raise HTTPException(
        status_code=500,
        detail="Unsupported EMBEDDING_PROVIDER. Use 'openai' or 'ollama'.",
    )


def configure_llama_index() -> None:
    validate_provider_configuration()

    llm_provider = os.getenv("LLM_PROVIDER", "ollama").lower().strip()
    if llm_provider == "groq":
        Settings.llm = LlamaIndexGroq(
            model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
            api_key=os.getenv("GROQ_API_KEY"),
            temperature=0.2,
            max_tokens=GROQ_MAX_TOKENS,
        )
    else:
        Settings.llm = Ollama(
            model=os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            request_timeout=float(os.getenv("OLLAMA_TIMEOUT", "300")),
            temperature=0.1,
            json_mode=True,
        )

    embedding_provider = os.getenv("EMBEDDING_PROVIDER", "openai").lower().strip()
    if embedding_provider == "openai":
        Settings.embed_model = OpenAIEmbedding(
            model=os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
            api_key=os.getenv("OPENAI_API_KEY"),
        )
        return

    Settings.embed_model = OllamaEmbedding(
        model_name=os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text"),
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
    )


def selected_sources(source_ids: list[str] | None) -> list[dict[str, Any]]:
    sources = read_sources()
    if not sources:
        raise HTTPException(
            status_code=400,
            detail="No PDF has been uploaded and indexed yet. Upload a PDF first.",
        )

    if not source_ids:
        indexed_sources = [source for source in sources if source.get("status") == "indexed"]
        if not indexed_sources:
            raise HTTPException(
                status_code=400,
                detail="No PDF has finished indexing yet. Wait for indexing to complete or upload another PDF.",
            )
        return indexed_sources

    source_map = {source["source_id"]: source for source in sources}
    missing = [source_id for source_id in source_ids if source_id not in source_map]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown source_ids: {', '.join(missing)}",
        )

    selected = [source_map[source_id] for source_id in source_ids]
    not_ready = [source["filename"] for source in selected if source.get("status") != "indexed"]
    if not_ready:
        raise HTTPException(
            status_code=400,
            detail=f"Selected source(s) are not indexed yet: {', '.join(not_ready)}",
        )

    return selected


def load_source_index(source: dict[str, Any]):
    persist_dir = Path(source["storage_path"])
    if not persist_dir.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Index storage is missing for {source['filename']}. Re-upload the PDF.",
        )

    try:
        storage_context = StorageContext.from_defaults(persist_dir=str(persist_dir))
        return load_index_from_storage(storage_context)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load index for {source['filename']}: {exc}",
        ) from exc


def clean_retrieved_text(text: str) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_usable_context(text: str) -> bool:
    if len(text) < 80:
        return False

    printable_count = sum(char.isprintable() for char in text)
    alpha_count = sum(char.isalpha() for char in text)
    if printable_count / max(len(text), 1) < 0.9:
        return False
    if alpha_count / max(len(text), 1) < 0.25:
        return False

    return True


def retrieve_context(topic: str, sources: list[dict[str, Any]], top_k: int = 2) -> str:
    scored_parts: list[tuple[float, str]] = []
    dropped_chunks = 0

    for source in sources:
        index = load_source_index(source)
        try:
            nodes = index.as_retriever(similarity_top_k=top_k).retrieve(topic)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Retrieval failed for {source['filename']}: {exc}",
            ) from exc

        for node in nodes:
            text = clean_retrieved_text(node.get_content())
            if not is_usable_context(text):
                dropped_chunks += 1
                continue
            score = float(getattr(node, "score", 0.0) or 0.0)
            scored_parts.append((score, f"Source: {source['filename']}\n{text}"))

    if not scored_parts:
        raise HTTPException(
            status_code=400,
            detail=(
                "Retrieval returned no readable text from the selected PDF source(s). "
                "Try selecting fewer sources, using a text-based PDF, or re-uploading the PDF."
            ),
        )

    scored_parts.sort(key=lambda item: item[0], reverse=True)
    context_parts = [part for _, part in scored_parts[:MAX_CONTEXT_CHUNKS]]
    if dropped_chunks:
        logger.info("Dropped %s unreadable retrieved context chunk(s).", dropped_chunks)

    context = "\n\n---\n\n".join(context_parts)
    if len(context) > MAX_CONTEXT_CHARS:
        context = context[:MAX_CONTEXT_CHARS] + "\n\n[Context truncated for faster local generation.]"
    return context


def parse_json_response(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.lower().startswith("assistant:"):
        text = text.split(":", 1)[1].strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = extract_json_object(text)

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="The LLM JSON response must be an object.")
    return parsed


def extract_json_object(text: str) -> dict[str, Any]:
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []

    for index, char in enumerate(text):
        if char != "{":
            continue
        try:
            parsed, _ = decoder.raw_decode(text[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            candidates.append(parsed)

    for candidate in candidates:
        if "questions" in candidate or "score" in candidate:
            return candidate

    if candidates:
        return candidates[-1]

    logger.error("LLM returned non-JSON text: %s", text[:1000])
    raise HTTPException(
        status_code=502,
        detail="The LLM did not return valid JSON.",
    )


def llm_text(prompt: str, system_prompt: str) -> str:
    llm_provider = os.getenv("LLM_PROVIDER", "ollama").lower().strip()
    if llm_provider == "groq":
        response = GroqClient(api_key=os.getenv("GROQ_API_KEY")).chat.completions.create(
            model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
            temperature=0.1,
            max_completion_tokens=GROQ_MAX_TOKENS,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
        )
        choice = response.choices[0]
        raw_text = (choice.message.content or "").strip()
        if raw_text:
            return raw_text
        logger.error("Groq returned empty content. finish_reason=%s choice=%s", choice.finish_reason, choice)
        return ""

    ollama_prompt = f"{system_prompt}\n\n{prompt}"
    response = Settings.llm.complete(ollama_prompt)
    return getattr(response, "text", str(response)).strip()


def run_llm_json(prompt: str, required_key: str | None = None) -> dict[str, Any]:
    system_prompt = (
        "You are a JSON-only API for an engineering viva simulator. "
        "Return exactly one valid JSON object. Do not copy source text. "
        "Do not continue numbering, headings, or PDF content. Do not use markdown."
    )
    try:
        raw_text = llm_text(prompt, system_prompt)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LLM call failed: {exc}") from exc

    parsed = parse_json_response(raw_text)
    if required_key and required_key not in parsed:
        logger.warning("LLM JSON missing %s. Returned keys: %s", required_key, list(parsed.keys()))
        return retry_llm_json(prompt, parsed, required_key)
    return parsed


def retry_llm_json(original_prompt: str, bad_json: dict[str, Any], required_key: str) -> dict[str, Any]:
    correction_prompt = f"""
Your previous JSON did not include the required top-level key "{required_key}".
Return only corrected valid JSON. Do not include markdown or explanation.

Required top-level key: "{required_key}"
Previous JSON:
{json.dumps(bad_json)[:3000]}

Original task:
{original_prompt[:6000]}
""".strip()

    try:
        raw_text = llm_text(
            correction_prompt,
            "Return one corrected valid JSON object only. No markdown. No explanation.",
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"LLM retry failed: {exc}") from exc

    parsed = parse_json_response(raw_text)
    if required_key not in parsed:
        logger.error("LLM retry JSON still missing %s. Returned JSON: %s", required_key, parsed)
    return parsed


def coerce_questions_payload(result: dict[str, Any]) -> list[Any] | None:
    if isinstance(result.get("questions"), list):
        return result["questions"]

    for key in ("viva_questions", "question_list", "items"):
        if isinstance(result.get(key), list):
            return result[key]

    if all(key in result for key in ("question", "expected_answer")):
        return [result]

    return None


def normalize_question(question: dict[str, Any], index: int, difficulty: str) -> dict[str, Any] | None:
    if not isinstance(question, dict):
        return None

    normalized = {
        "id": index,
        "question": str(question.get("question", "")).strip(),
        "difficulty": str(question.get("difficulty") or difficulty),
        "expected_answer": str(question.get("expected_answer", "")).strip(),
        "followup_if_good": str(question.get("followup_if_good", "")).strip(),
        "followup_if_poor": str(question.get("followup_if_poor", "")).strip(),
    }
    if not normalized["question"] or not normalized["expected_answer"]:
        return None
    return normalized


def build_question_prompt(
    *,
    topic: str,
    difficulty: str,
    question_index: int,
    context: str,
    previous_questions: list[str],
) -> str:
    return f"""
PDF_CONTEXT_START
{context}
PDF_CONTEXT_END

You are a tough but fair engineering viva examiner. Use only the PDF context above.
Generate exactly one concise viva question for topic "{topic}" at {difficulty} difficulty.
Test conceptual understanding, not memorization.
Avoid repeating these previously generated questions:
{json.dumps(previous_questions)}

Return only valid compact JSON, no markdown, matching this exact shape:
{{
  "questions": [
    {{
      "id": {question_index},
      "question": "...",
      "difficulty": "{difficulty}",
      "expected_answer": "...",
      "followup_if_good": "...",
      "followup_if_poor": "..."
    }}
  ]
}}
""".strip()


def generate_single_question(
    *,
    topic: str,
    difficulty: str,
    question_index: int,
    context: str,
    previous_questions: list[str],
) -> dict[str, Any]:
    context_limits = [3000, 2000, 1200, 700]
    last_error: HTTPException | None = None

    for attempt, context_limit in enumerate(context_limits, start=1):
        prompt = build_question_prompt(
            topic=topic,
            difficulty=difficulty,
            question_index=question_index,
            context=context[:context_limit],
            previous_questions=previous_questions,
        )
        try:
            result = run_llm_json(prompt, required_key="questions")
            questions = coerce_questions_payload(result)
            if not questions:
                raise HTTPException(
                    status_code=502,
                    detail="The LLM response did not include a questions array.",
                )

            normalized = normalize_question(questions[0], question_index, difficulty)
            if not normalized:
                raise HTTPException(status_code=502, detail="The LLM returned an unusable question.")

            return normalized
        except HTTPException as exc:
            last_error = exc
            logger.warning(
                "Question %s generation attempt %s failed with context_limit=%s: %s",
                question_index,
                attempt,
                context_limit,
                exc.detail,
            )

    raise last_error or HTTPException(status_code=502, detail="The LLM did not return valid JSON.")


def generate_question_set(request: GenerateQuestionsRequest) -> tuple[str, list[dict[str, Any]]]:
    started_at = time.perf_counter()
    sources = selected_sources(request.source_ids)
    logger.info(
        "Generating questions topic=%r difficulty=%s count=%s sources=%s",
        request.topic,
        request.difficulty,
        request.count,
        [source["filename"] for source in sources],
    )
    context = retrieve_context(request.topic, sources)
    logger.info("Retrieved %s context chars in %.2fs", len(context), time.perf_counter() - started_at)

    normalized_questions: list[dict[str, Any]] = []
    previous_questions: list[str] = []

    for question_index in range(1, request.count + 1):
        normalized = generate_single_question(
            topic=request.topic,
            difficulty=request.difficulty,
            question_index=question_index,
            context=context,
            previous_questions=previous_questions,
        )
        normalized_questions.append(normalized)
        previous_questions.append(normalized["question"])

    session_id = str(uuid.uuid4())
    STUDENT_SESSIONS[session_id] = {
        "topic": request.topic,
        "difficulty": request.difficulty,
        "source_ids": request.source_ids or [],
        "questions": normalized_questions,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    logger.info("LLM question generation finished in %.2fs", time.perf_counter() - started_at)
    return session_id, normalized_questions


def public_question(question: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": question["id"],
        "question": question["question"],
        "difficulty": question["difficulty"],
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/sources")
def get_sources() -> dict[str, list[dict[str, Any]]]:
    return {"sources": read_sources()}


@app.post("/upload-pdf")
def upload_pdf(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    source_id = str(uuid.uuid4())
    filename = safe_filename(file.filename)
    saved_filename = f"{source_id}_{filename}"
    upload_path = UPLOAD_DIR / saved_filename
    source_storage_dir = SOURCES_DIR / source_id

    try:
        with upload_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        if upload_path.exists():
            upload_path.unlink()
        raise HTTPException(status_code=500, detail=f"Failed to save PDF: {exc}") from exc

    source = {
        "source_id": source_id,
        "filename": filename,
        "uploaded_filename": saved_filename,
        "upload_path": str(upload_path),
        "storage_path": str(source_storage_dir),
        "status": "indexing",
        "error": None,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "indexed_at": None,
    }

    sources = read_sources()
    sources.append(source)
    write_sources(sources)
    background_tasks.add_task(index_pdf_source, source)

    return {
        "status": "indexing",
        "message": "PDF uploaded. Indexing has started.",
        "source": source,
        "filename": filename,
    }


def index_pdf_source(source: dict[str, Any]) -> None:
    source_id = source["source_id"]
    upload_path = Path(source["upload_path"])
    source_storage_dir = Path(source["storage_path"])

    try:
        configure_llama_index()
        documents = SimpleDirectoryReader(input_files=[str(upload_path)]).load_data()
        if not documents:
            raise ValueError("No text could be extracted from the PDF.")

        for document in documents:
            document.metadata["source_id"] = source_id
            document.metadata["filename"] = source["filename"]

        index = VectorStoreIndex.from_documents(documents)
        index.storage_context.persist(persist_dir=str(source_storage_dir))
        update_source(
            source_id,
            {
                "status": "indexed",
                "error": None,
                "indexed_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception as exc:
        if source_storage_dir.exists():
            shutil.rmtree(source_storage_dir)
        update_source(
            source_id,
            {
                "status": "failed",
                "error": str(exc),
                "indexed_at": datetime.now(timezone.utc).isoformat(),
            },
        )


@app.post("/generate-questions")
def generate_questions(request: GenerateQuestionsRequest) -> dict[str, Any]:
    configure_llama_index()
    session_id, questions = generate_question_set(request)
    return {"session_id": session_id, "questions": questions}


@app.post("/generate-student-questions")
def generate_student_questions(request: GenerateStudentQuestionsRequest) -> dict[str, Any]:
    configure_llama_index()
    session_id, questions = generate_question_set(request)
    return {"session_id": session_id, "questions": [public_question(question) for question in questions]}


@app.post("/evaluate-answer")
def evaluate_answer(request: EvaluateAnswerRequest) -> dict[str, Any]:
    configure_llama_index()

    context = "No additional PDF context was selected."
    if request.source_ids:
        sources = selected_sources(request.source_ids)
        context = retrieve_context(request.topic, sources, top_k=3)

    prompt = f"""
You are a strict but fair viva examiner. Evaluate the student answer against the expected answer and retrieved context.
Score from 0 to 5. Return only valid compact JSON, no markdown, matching this shape:
{{
  "score": 0,
  "correctness": 0,
  "depth": 0,
  "clarity": 0,
  "feedback": "...",
  "missing_points": ["..."],
  "followup_question": "..."
}}

Topic: {request.topic}
Question: {request.question}
Expected answer: {request.expected_answer}
Student answer: {request.student_answer}

RETRIEVED_CONTEXT_START
{context}
RETRIEVED_CONTEXT_END
""".strip()

    result = run_llm_json(prompt)
    missing_points = result.get("missing_points", [])
    if not isinstance(missing_points, list):
        missing_points = [str(missing_points)]

    def numeric_score(key: str) -> float:
        try:
            value = float(result.get(key, 0))
        except (TypeError, ValueError):
            value = 0
        return max(0, min(5, value))

    return {
        "score": numeric_score("score"),
        "correctness": numeric_score("correctness"),
        "depth": numeric_score("depth"),
        "clarity": numeric_score("clarity"),
        "feedback": str(result.get("feedback", "")).strip(),
        "missing_points": [str(point).strip() for point in missing_points if str(point).strip()],
        "followup_question": str(result.get("followup_question", "")).strip(),
    }


@app.post("/evaluate-student-answer")
def evaluate_student_answer(request: EvaluateStudentAnswerRequest) -> dict[str, Any]:
    session = STUDENT_SESSIONS.get(request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Student viva session was not found. Generate questions again.")

    question = next(
        (item for item in session["questions"] if int(item["id"]) == int(request.question_id)),
        None,
    )
    if not question:
        raise HTTPException(status_code=404, detail="Question was not found in this viva session.")

    evaluation = evaluate_answer(
        EvaluateAnswerRequest(
            question=question["question"],
            expected_answer=question["expected_answer"],
            student_answer=request.student_answer,
            topic=request.topic,
            source_ids=request.source_ids,
        )
    )
    evaluation["expected_answer"] = question["expected_answer"]
    evaluation["generator_followup_if_good"] = question.get("followup_if_good", "")
    evaluation["generator_followup_if_poor"] = question.get("followup_if_poor", "")
    return evaluation


@app.post("/api/transcribe")
def transcribe_audio(file: UploadFile = File(...)) -> dict[str, str]:
    suffix = Path(file.filename or "answer.webm").suffix or ".webm"
    audio_path = TRANSCRIPTS_DIR / f"{uuid.uuid4()}{suffix}"
    try:
        with audio_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save audio file: {exc}") from exc

    if not ENABLE_WHISPER:
        return {
            "transcript": "",
            "message": "Transcription stub active. Set ENABLE_WHISPER=true and install openai-whisper to enable local transcription.",
        }

    try:
        import whisper

        model = whisper.load_model(WHISPER_MODEL)
        result = model.transcribe(str(audio_path))
        transcript = str(result.get("text", "")).strip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc

    return {"transcript": transcript}
