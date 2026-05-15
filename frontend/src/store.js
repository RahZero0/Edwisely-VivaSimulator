import { configureStore, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { evaluateAnswer, generateQuestions, getSources, uploadPdf } from "./api.js";

const initialState = {
  uploadStatus: "",
  uploadPhase: "idle",
  sources: [],
  selectedSourceIds: [],
  topic: "",
  difficulty: "medium",
  count: 5,
  questions: [],
  questionStatus: "",
  questionPhase: "idle",
  questionStartedAt: null,
  activeQuestion: null,
  studentAnswer: "",
  evaluation: null,
  evaluationStatus: "",
  evaluationPhase: "idle",
};

export const fetchSources = createAsyncThunk("viva/fetchSources", async () => {
  const data = await getSources();
  return data.sources || [];
});

export const uploadPdfThunk = createAsyncThunk("viva/uploadPdf", async (file) => {
  return uploadPdf(file);
});

export const generateQuestionsThunk = createAsyncThunk(
  "viva/generateQuestions",
  async (_, { getState, rejectWithValue }) => {
    const state = getState().viva;
    if (!state.topic.trim()) {
      return rejectWithValue("Enter a topic.");
    }
    if (state.selectedSourceIds.length === 0) {
      return rejectWithValue("Select at least one indexed PDF source.");
    }

    return generateQuestions({
      topic: state.topic.trim(),
      difficulty: state.difficulty,
      count: Number(state.count),
      source_ids: state.selectedSourceIds,
    });
  },
);

export const evaluateAnswerThunk = createAsyncThunk(
  "viva/evaluateAnswer",
  async (_, { getState, rejectWithValue }) => {
    const state = getState().viva;
    if (!state.activeQuestion) {
      return rejectWithValue("Select a question first.");
    }
    if (!state.studentAnswer.trim()) {
      return rejectWithValue("Type your answer before submitting.");
    }

    return evaluateAnswer({
      question: state.activeQuestion.question,
      expected_answer: state.activeQuestion.expected_answer,
      student_answer: state.studentAnswer.trim(),
      topic: state.topic.trim(),
      source_ids: state.selectedSourceIds,
    });
  },
);

const vivaSlice = createSlice({
  name: "viva",
  initialState,
  reducers: {
    setTopic(state, action) {
      state.topic = action.payload;
    },
    setDifficulty(state, action) {
      state.difficulty = action.payload;
    },
    setCount(state, action) {
      state.count = action.payload;
    },
    setStudentAnswer(state, action) {
      state.studentAnswer = action.payload;
    },
    toggleSource(state, action) {
      const sourceId = action.payload;
      state.selectedSourceIds = state.selectedSourceIds.includes(sourceId)
        ? state.selectedSourceIds.filter((id) => id !== sourceId)
        : [...state.selectedSourceIds, sourceId];
    },
    startViva(state, action) {
      state.activeQuestion = action.payload;
      state.studentAnswer = "";
      state.evaluation = null;
      state.evaluationStatus = "";
      state.evaluationPhase = "idle";
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSources.fulfilled, (state, action) => {
        state.sources = action.payload;
        const validIds = new Set(action.payload.map((source) => source.source_id));
        state.selectedSourceIds = state.selectedSourceIds.filter((id) => validIds.has(id));
        const indexingCount = action.payload.filter((source) => source.status === "indexing").length;
        const failedCount = action.payload.filter((source) => source.status === "failed").length;
        if (state.uploadPhase === "indexing" && indexingCount === 0) {
          state.uploadPhase = failedCount > 0 ? "failed" : "succeeded";
          state.uploadStatus =
            failedCount > 0
              ? "Indexing failed for one or more PDFs. Check the source error message."
              : "Indexing complete. Select an indexed source and generate questions.";
        }
      })
      .addCase(fetchSources.rejected, (state, action) => {
        state.uploadStatus = action.error.message || "Failed to load indexed sources.";
      })
      .addCase(uploadPdfThunk.pending, (state) => {
        state.uploadPhase = "uploading";
        state.uploadStatus = "Uploading PDF and starting indexing...";
      })
      .addCase(uploadPdfThunk.fulfilled, (state, action) => {
        const source = action.payload.source;
        state.uploadPhase = "indexing";
        state.uploadStatus = `${source.filename} uploaded. Indexing is running in the background.`;
        state.sources = upsertSource(state.sources, source);
        if (!state.selectedSourceIds.includes(source.source_id)) {
          state.selectedSourceIds.push(source.source_id);
        }
      })
      .addCase(uploadPdfThunk.rejected, (state, action) => {
        state.uploadPhase = "failed";
        state.uploadStatus = action.error.message || "Upload failed.";
      })
      .addCase(generateQuestionsThunk.pending, (state) => {
        state.questionPhase = "loading";
        state.questionStatus = "Generating viva questions...";
        state.questionStartedAt = Date.now();
        state.questions = [];
        state.activeQuestion = null;
        state.evaluation = null;
      })
      .addCase(generateQuestionsThunk.fulfilled, (state, action) => {
        state.questionPhase = "succeeded";
        state.questionStartedAt = null;
        state.questions = action.payload.questions || [];
        state.questionStatus = `Generated ${state.questions.length} question(s).`;
      })
      .addCase(generateQuestionsThunk.rejected, (state, action) => {
        state.questionPhase = "failed";
        state.questionStartedAt = null;
        state.questionStatus = action.payload || action.error.message || "Failed to generate questions.";
      })
      .addCase(evaluateAnswerThunk.pending, (state) => {
        state.evaluationPhase = "loading";
        state.evaluationStatus = "Evaluating answer...";
        state.evaluation = null;
      })
      .addCase(evaluateAnswerThunk.fulfilled, (state, action) => {
        state.evaluationPhase = "succeeded";
        state.evaluation = action.payload;
        state.evaluationStatus = "Evaluation complete.";
      })
      .addCase(evaluateAnswerThunk.rejected, (state, action) => {
        state.evaluationPhase = "failed";
        state.evaluationStatus = action.payload || action.error.message || "Failed to evaluate answer.";
      });
  },
});

function upsertSource(sources, nextSource) {
  const exists = sources.some((source) => source.source_id === nextSource.source_id);
  if (!exists) {
    return [nextSource, ...sources];
  }
  return sources.map((source) => (source.source_id === nextSource.source_id ? nextSource : source));
}

export const { setTopic, setDifficulty, setCount, setStudentAnswer, toggleSource, startViva } =
  vivaSlice.actions;

export const store = configureStore({
  reducer: {
    viva: vivaSlice.reducer,
  },
});
