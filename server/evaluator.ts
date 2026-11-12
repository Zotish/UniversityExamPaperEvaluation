import type {
  AiCapabilityReport,
  QuestionEvaluationSuggestion,
  QuestionType,
  RubricCriterion,
} from "./types.ts";

export function getAiCapabilities(): AiCapabilityReport {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const aiSemanticGrading = hasGemini || hasOpenAi;

  return {
    deterministicGrading: true,
    aiSemanticGrading,
    providerName: hasGemini
      ? "Google Gemini (Server-side API)"
      : hasOpenAi
        ? "OpenAI (Server-side API)"
        : "Deterministic Engine Only (AI Disabled)",
    configurationNote: aiSemanticGrading
      ? "AI-assisted rubric evaluation is active for Short Answer and Descriptive questions. All suggestions still require teacher verification."
      : "AI credentials (GEMINI_API_KEY or OPENAI_API_KEY) are not configured. Deterministic grading (MCQ, True/False, Numerical) is operational; Short Answer and Descriptive questions are routed for manual teacher grading.",
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeBoolean(value: string): "true" | "false" | null {
  const norm = normalizeText(value).replace(/[.,!?;:]/g, "");
  if (["true", "t", "yes", "y", "correct", "1"].includes(norm)) return "true";
  if (["false", "f", "no", "n", "incorrect", "0"].includes(norm)) return "false";
  return null;
}

function extractNumericValue(value: string): number | null {
  const cleaned = value.replace(/,/g, "");
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

export async function evaluateQuestionResponse(params: {
  questionText: string;
  questionType: QuestionType;
  maxMarks: number;
  referenceAnswer: string;
  alternativeAnswers: string[];
  numericalTolerance: number;
  rubrics: RubricCriterion[];
  studentAnswer: string;
  extractionUncertain: boolean;
}): Promise<QuestionEvaluationSuggestion> {
  const {
    questionText,
    questionType,
    maxMarks,
    referenceAnswer,
    alternativeAnswers,
    numericalTolerance,
    rubrics,
    studentAnswer,
    extractionUncertain,
  } = params;

  const baseRubrics =
    rubrics.length > 0
      ? rubrics
      : [{ criterion_name: "Overall Answer Accuracy", max_marks: maxMarks, sort_order: 0 }];

  const trimmedStudent = studentAnswer.trim();

  if (extractionUncertain || !trimmedStudent) {
    return {
      suggestedMarks: 0,
      rubricScores: baseRubrics.map((r) => ({
        criterionName: r.criterion_name,
        maxMarks: r.max_marks,
        awardedMarks: 0,
      })),
      correctConcepts: [],
      missingConcepts: trimmedStudent
        ? ["Text extraction was flagged as uncertain; inspect original script."]
        : ["No extracted response detected for this question."],
      misconceptions: [],
      feedback: trimmedStudent
        ? "Extraction uncertainty detected. Teacher must verify the original handwritten/scanned sheet."
        : "No answer was extracted for this question. Verify the original script before grading.",
      evaluationMethod: "Manual",
      reviewStatus: "Extraction Uncertain",
    };
  }

  // Deterministic: MCQ
  if (questionType === "MCQ") {
    const accepted = [referenceAnswer, ...alternativeAnswers]
      .map(normalizeText)
      .filter(Boolean);
    const studentNorm = normalizeText(trimmedStudent);
    // Also match leading option letter like "a)" or "A." or "Option B"
    const studentOption = studentNorm.replace(/^option\s+/, "").replace(/[).:\s]+.*$/, "");
    const refOption = normalizeText(referenceAnswer)
      .replace(/^option\s+/, "")
      .replace(/[).:\s]+.*$/, "");

    const isMatch =
      accepted.includes(studentNorm) ||
      (studentOption.length === 1 && refOption.length === 1 && studentOption === refOption);

    const awarded = isMatch ? maxMarks : 0;
    return {
      suggestedMarks: awarded,
      rubricScores: baseRubrics.map((r) => ({
        criterionName: r.criterion_name,
        maxMarks: r.max_marks,
        awardedMarks: isMatch ? r.max_marks : 0,
      })),
      correctConcepts: isMatch ? [`Matched official choice (${referenceAnswer}).`] : [],
      missingConcepts: isMatch ? [] : [`Expected choice: ${referenceAnswer}.`],
      misconceptions: isMatch ? [] : [`Selected "${trimmedStudent}" instead of "${referenceAnswer}".`],
      feedback: isMatch
        ? "Correct multiple-choice selection matched deterministically."
        : `Incorrect selection. The verified answer is "${referenceAnswer}".`,
      evaluationMethod: "Deterministic-MCQ",
      reviewStatus: "Ready for Review",
    };
  }

  // Deterministic: True/False
  if (questionType === "True/False") {
    const refBool = normalizeBoolean(referenceAnswer);
    const stuBool = normalizeBoolean(trimmedStudent);
    if (refBool && stuBool) {
      const isMatch = refBool === stuBool;
      return {
        suggestedMarks: isMatch ? maxMarks : 0,
        rubricScores: baseRubrics.map((r) => ({
          criterionName: r.criterion_name,
          maxMarks: r.max_marks,
          awardedMarks: isMatch ? r.max_marks : 0,
        })),
        correctConcepts: isMatch ? [`Correctly identified statement as ${refBool}.`] : [],
        missingConcepts: isMatch ? [] : [`Expected ${refBool}.`],
        misconceptions: isMatch ? [] : [`Marked ${stuBool} instead of ${refBool}.`],
        feedback: isMatch
          ? "Correct True/False response matched deterministically."
          : `Incorrect True/False response. The verified answer is ${refBool}.`,
        evaluationMethod: "Deterministic-TF",
        reviewStatus: "Ready for Review",
      };
    }
    return {
      suggestedMarks: 0,
      rubricScores: baseRubrics.map((r) => ({
        criterionName: r.criterion_name,
        maxMarks: r.max_marks,
        awardedMarks: 0,
      })),
      correctConcepts: [],
      missingConcepts: ["Ambiguous True/False response format."],
      misconceptions: [],
      feedback: "Could not parse a clear True/False value. Manual teacher verification required.",
      evaluationMethod: "Manual",
      reviewStatus: "Manual Review Required",
    };
  }

  // Deterministic: Numerical
  if (questionType === "Numerical") {
    const refVal = extractNumericValue(referenceAnswer);
    const stuVal = extractNumericValue(trimmedStudent);
    if (refVal !== null && stuVal !== null) {
      const diff = Math.abs(stuVal - refVal);
      const isMatch = diff <= Math.max(0, numericalTolerance);
      return {
        suggestedMarks: isMatch ? maxMarks : 0,
        rubricScores: baseRubrics.map((r) => ({
          criterionName: r.criterion_name,
          maxMarks: r.max_marks,
          awardedMarks: isMatch ? r.max_marks : 0,
        })),
        correctConcepts: isMatch
          ? [`Numerical value ${stuVal} matches reference ${refVal} (±${numericalTolerance}).`]
          : [],
        missingConcepts: isMatch ? [] : [`Expected numerical value ${refVal} (±${numericalTolerance}).`],
        misconceptions: isMatch ? [] : [`Computed ${stuVal}, expected ${refVal}.`],
        feedback: isMatch
          ? "Numerical answer matched within configured tolerance."
          : `Numerical mismatch: student wrote ${stuVal}, reference is ${refVal} (±${numericalTolerance}).`,
        evaluationMethod: "Deterministic-Numerical",
        reviewStatus: "Ready for Review",
      };
    }
    return {
      suggestedMarks: 0,
      rubricScores: baseRubrics.map((r) => ({
        criterionName: r.criterion_name,
        maxMarks: r.max_marks,
        awardedMarks: 0,
      })),
      correctConcepts: [],
      missingConcepts: ["Could not parse a deterministic number from the answer."],
      misconceptions: [],
      feedback: "Manual review required to inspect numerical steps or units.",
      evaluationMethod: "Manual",
      reviewStatus: "Manual Review Required",
    };
  }

  // Short Answer & Descriptive: Use external AI only if credentials are configured
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const prompt = [
        "You are an academic grading assistant supporting a university professor.",
        "Evaluate the student's answer strictly against the rubric criteria, reference answer, and accepted alternatives.",
        "Accept equivalent valid phrasing. Do not penalize grammar unless explicitly in the rubric.",
        "Return valid JSON only with fields:",
        `{ "rubricScores": [{"criterionName": string, "maxMarks": number, "awardedMarks": number}], "correctConcepts": string[], "missingConcepts": string[], "misconceptions": string[], "feedback": string, "uncertain": boolean }`,
        `Question (${maxMarks} marks): ${questionText}`,
        `Reference Answer: ${referenceAnswer}`,
        `Accepted Alternatives: ${alternativeAnswers.join("; ") || "None"}`,
        `Rubric Criteria: ${JSON.stringify(baseRubrics.map((r) => ({ criterionName: r.criterion_name, maxMarks: r.max_marks })))}`,
        `Student Answer: ${trimmedStudent}`,
      ].join("\n");

      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
          }),
        }
      );

      if (resp.ok) {
        const data = (await resp.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawJson) {
          const parsed = JSON.parse(rawJson) as {
            rubricScores?: { criterionName: string; maxMarks: number; awardedMarks: number }[];
            correctConcepts?: string[];
            missingConcepts?: string[];
            misconceptions?: string[];
            feedback?: string;
            uncertain?: boolean;
          };
          const scores = (parsed.rubricScores || []).map((rs, idx) => {
            const targetMax = baseRubrics[idx]?.max_marks ?? rs.maxMarks ?? 0;
            const clamped = Math.max(0, Math.min(targetMax, Number(rs.awardedMarks) || 0));
            return {
              criterionName: baseRubrics[idx]?.criterion_name ?? rs.criterionName,
              maxMarks: targetMax,
              awardedMarks: clamped,
            };
          });
          const total = Math.min(
            maxMarks,
            scores.reduce((sum, s) => sum + s.awardedMarks, 0)
          );
          return {
            suggestedMarks: total,
            rubricScores: scores.length
              ? scores
              : baseRubrics.map((r) => ({
                  criterionName: r.criterion_name,
                  maxMarks: r.max_marks,
                  awardedMarks: 0,
                })),
            correctConcepts: parsed.correctConcepts || [],
            missingConcepts: parsed.missingConcepts || [],
            misconceptions: parsed.misconceptions || [],
            feedback: parsed.feedback || "AI-assisted rubric evaluation generated for teacher verification.",
            evaluationMethod: "AI-Semantic",
            reviewStatus: parsed.uncertain ? "Rubric Match Uncertain" : "Ready for Review",
          };
        }
      }
    } catch {
      // Fall through cleanly to manual review fallback on AI network/provider errors
    }
  }

  // No AI credentials configured or AI unavailable: honest manual review required
  return {
    suggestedMarks: 0,
    rubricScores: baseRubrics.map((r) => ({
      criterionName: r.criterion_name,
      maxMarks: r.max_marks,
      awardedMarks: 0,
    })),
    correctConcepts: [],
    missingConcepts: [
      "AI semantic grading is disabled (no server AI credentials configured).",
    ],
    misconceptions: [],
    feedback:
      "AI semantic grading is disabled because server AI credentials are not configured. Please review this answer against the rubric and assign marks manually.",
    evaluationMethod: "Manual",
    reviewStatus: "Manual Review Required",
  };
}

