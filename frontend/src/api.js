async function request(path, options = {}) {
  const { timeoutMs = 300000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(path, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Request timed out. For local Ollama, try fewer questions or fewer selected PDFs.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.detail || data.message || "Request failed");
  }

  return data;
}

export function getSources() {
  return request("/sources");
}

export function uploadPdf(file) {
  const formData = new FormData();
  formData.append("file", file);

  return request("/upload-pdf", {
    method: "POST",
    body: formData,
  });
}

export function generateQuestions(payload) {
  return request("/generate-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 300000,
  });
}

export function generateStudentQuestions(payload) {
  return request("/generate-student-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 300000,
  });
}

export function evaluateAnswer(payload) {
  return request("/evaluate-answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function evaluateStudentAnswer(payload) {
  return request("/evaluate-student-answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function transcribeAudio(blob, filename = "answer.webm") {
  const formData = new FormData();
  formData.append("file", blob, filename);

  return request("/api/transcribe", {
    method: "POST",
    body: formData,
    timeoutMs: 300000,
  });
}
