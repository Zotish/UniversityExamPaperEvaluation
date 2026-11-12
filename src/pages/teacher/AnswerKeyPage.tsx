import { useEffect, useRef, useState } from "react";
import { DocumentViewer } from "../../components/DocumentViewer";
import { Shell } from "../../components/Shell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
  PageHead,
  ProgressSteps,
} from "../../components/ui";
import { apiRequest, uploadWithProgress } from "../../lib/api";
import type { Examination, NavState, Question, QuestionType, Screen } from "../../types";

export function AnswerKeyPage({
  examId,
  go,
  notify,
}: {
  examId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [exams, setExams] = useState<Examination[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | undefined>(examId);
  const [exam, setExam] = useState<Examination | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [extractionNote, setExtractionNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"editor" | "preview">("editor");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadExam = async (idToLoad?: number) => {
    setLoading(true);
    setError(null);
    try {
      const listRes = await apiRequest<{ exams: Examination[] }>("/api/exams");
      setExams(listRes.exams);
      const targetId =
        idToLoad ||
        listRes.exams.find((e) => e.status === "Awaiting Answer Key")?.id ||
        listRes.exams[0]?.id;

      if (!targetId) {
        setExam(null);
        setLoading(false);
        return;
      }
      setSelectedExamId(targetId);
      const detail = await apiRequest<{ exam: Examination; questions: Question[] }>(
        `/api/exams/${targetId}`
      );
      setExam(detail.exam);
      setQuestions(
        detail.questions.length > 0
          ? detail.questions
          : [
              {
                question_number: 1,
                question_text: "Question 1",
                question_type: "Short Answer",
                max_marks: detail.exam.total_marks || 10,
                reference_answer: "",
                alternative_answers: [],
                numerical_tolerance: 0,
                topic: "General",
                page_number: 1,
                rubrics: [
                  {
                    criterion_name: "Core Concept Accuracy",
                    max_marks: detail.exam.total_marks || 10,
                  },
                ],
              },
            ]
      );
      setActiveIdx(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load answer key workspace.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExam(examId);
  }, [examId]);

  const handleFileUpload = async (file: File) => {
    if (!exam) return;
    setUploading(true);
    setUploadPct(0);
    setExtractionNote(null);
    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await uploadWithProgress<{
        document: { id: number; original_name: string; page_count: number };
        extraction: {
          success: boolean;
          message: string;
          pageCount: number;
          fullText: string;
          uncertain: boolean;
        };
        suggestedChunks: { questionNumber: number; text: string; pageNumber: number }[];
      }>(`/api/exams/${exam.id}/answer-key`, fd, setUploadPct);

      setExam({
        ...exam,
        answer_key_file_id: res.document.id,
        answer_key_file_name: res.document.original_name,
        answer_key_pages: res.document.page_count,
        answer_key_verified: 0,
      });
      setExtractionNote(res.extraction.message);

      if (res.suggestedChunks.length > 0) {
        setQuestions((prev) =>
          res.suggestedChunks.map((chunk, idx) => {
            const existing = prev[idx];
            const splitAns = chunk.text.split(/Answer:\s*/i);
            const qText = splitAns[0]?.trim() || existing?.question_text || `Question ${chunk.questionNumber}`;
            const refAns = splitAns[1]?.trim() || existing?.reference_answer || "";
            return {
              question_number: idx + 1,
              question_text: qText,
              question_type: existing?.question_type || "Short Answer",
              max_marks: existing?.max_marks || Math.round((exam.total_marks / res.suggestedChunks.length) * 10) / 10,
              reference_answer: refAns,
              alternative_answers: existing?.alternative_answers || [],
              numerical_tolerance: existing?.numerical_tolerance || 0,
              topic: existing?.topic || "General",
              page_number: chunk.pageNumber,
              rubrics: existing?.rubrics?.length
                ? existing.rubrics
                : [
                    {
                      criterion_name: "Core Concept Accuracy",
                      max_marks: existing?.max_marks || Math.round((exam.total_marks / res.suggestedChunks.length) * 10) / 10,
                    },
                  ],
            };
          })
        );
        notify(`Answer key uploaded and ${res.suggestedChunks.length} question(s) extracted`);
      } else {
        notify("Answer key uploaded — enter or verify questions manually");
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  };

  const updateQuestion = (idx: number, patch: Partial<Question>) => {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
    setValidationError(null);
  };

  const addQuestion = () => {
    const nextNum = questions.length + 1;
    setQuestions((prev) => [
      ...prev,
      {
        question_number: nextNum,
        question_text: `Question ${nextNum}`,
        question_type: "Short Answer",
        max_marks: 10,
        reference_answer: "",
        alternative_answers: [],
        numerical_tolerance: 0,
        topic: "General",
        page_number: 1,
        rubrics: [{ criterion_name: "Core Concept Accuracy", max_marks: 10 }],
      },
    ]);
    setActiveIdx(questions.length);
  };

  const removeQuestion = (idx: number) => {
    if (questions.length <= 1) {
      notify("An examination must have at least one question.", "error");
      return;
    }
    const next = questions
      .filter((_, i) => i !== idx)
      .map((q, i) => ({ ...q, question_number: i + 1 }));
    setQuestions(next);
    setActiveIdx(Math.max(0, Math.min(activeIdx, next.length - 1)));
  };

  const validateAll = (verify: boolean): string | null => {
    if (!exam) return "No examination selected.";
    let sumQ = 0;
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) return `Question ${i + 1}: Question text is required.`;
      if (!Number.isFinite(Number(q.max_marks)) || Number(q.max_marks) <= 0) {
        return `Question ${i + 1}: Maximum marks must be greater than 0.`;
      }
      const rubricSum = q.rubrics.reduce((s, r) => s + Number(r.max_marks || 0), 0);
      if (q.rubrics.length > 0 && Math.abs(rubricSum - Number(q.max_marks)) > 0.01) {
        return `Question ${i + 1}: Rubric criteria total (${rubricSum}) must equal question maximum marks (${q.max_marks}).`;
      }
      for (const r of q.rubrics) {
        if (!r.criterion_name.trim()) return `Question ${i + 1}: Criterion name cannot be empty.`;
      }
      if (verify && !q.reference_answer.trim()) {
        return `Question ${i + 1}: Official reference answer is required to verify.`;
      }
      sumQ += Number(q.max_marks);
    }
    if (verify && Math.abs(sumQ - exam.total_marks) > 0.01) {
      return `Sum of all question marks (${sumQ}) must equal examination total marks (${exam.total_marks}).`;
    }
    return null;
  };

  const handleSave = async (verify: boolean) => {
    if (!exam) return;
    const err = validateAll(verify);
    if (err) {
      setValidationError(err);
      notify(err, "error");
      return;
    }
    setSaving(true);
    setValidationError(null);
    try {
      const res = await apiRequest<{ exam: Examination; questions: Question[] }>(
        `/api/exams/${exam.id}/questions`,
        {
          method: "PUT",
          body: JSON.stringify({ verify, questions }),
        }
      );
      setExam({ ...exam, ...res.exam });
      setQuestions(res.questions);
      if (verify) {
        notify("Answer key & rubrics verified successfully");
        go("sheets", { examId: exam.id });
      } else {
        notify("Answer key draft saved");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save answer key.";
      setValidationError(msg);
      notify(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const currentQ = questions[activeIdx];
  const sumQuestionMarks = questions.reduce((s, q) => s + Number(q.max_marks || 0), 0);
  const currentRubricSum = currentQ
    ? currentQ.rubrics.reduce((s, r) => s + Number(r.max_marks || 0), 0)
    : 0;

  return (
    <Shell
      screen="key"
      go={go}
      title="Answer Key & Rubrics"
      breadcrumb={exam ? `${exam.course_code} / ${exam.title}` : "Answer Key Editor"}
    >
      <PageHead
        title="Answer Key & Marking Rubrics"
        subtitle={exam ? `${exam.course_code} · Total ${exam.total_marks} Marks` : undefined}
        action={
          exams.length > 0 && (
            <select
              value={selectedExamId || ""}
              onChange={(e) => loadExam(Number(e.target.value))}
              aria-label="Select examination"
              style={{ minWidth: 260 }}
            >
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.course_code} — {ex.title}
                </option>
              ))}
            </select>
          )
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => loadExam(selectedExamId)} />
      ) : !exam ? (
        <EmptyState
          icon="file"
          title="No examinations available"
          description="Create an examination first before configuring an answer key."
          action={
            <Button icon="plus" onClick={() => go("create")}>
              Create Examination
            </Button>
          }
        />
      ) : (
        <>
          <div className="card wizard">
            <ProgressSteps current={2} />
            <div className="upload-area">
              <div className="upload-head-row">
                <div>
                  <h3>Official Answer Key Document</h3>
                  <p>
                    Upload a PDF or scanned image (JPG, PNG). Selectable PDF text is extracted
                    automatically.
                  </p>
                </div>
                {exam.answer_key_verified ? (
                  <Badge tone="green">Verified Key</Badge>
                ) : (
                  <Badge tone="amber">Verification Required</Badge>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileUpload(f);
                  e.target.value = "";
                }}
              />

              <div
                className={`dropzone ${exam.answer_key_file_id ? "uploaded" : ""}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFileUpload(f);
                }}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                {uploading ? (
                  <>
                    <span className="upload-icon">
                      <Icon name="upload" size={24} />
                    </span>
                    <strong>Uploading &amp; running extraction… {uploadPct}%</strong>
                    <div className="progress" style={{ width: 260, marginTop: 12 }}>
                      <i style={{ width: `${uploadPct}%` }} />
                    </div>
                  </>
                ) : exam.answer_key_file_id ? (
                  <>
                    <span className="upload-ok">
                      <Icon name="check" />
                    </span>
                    <strong>{exam.answer_key_file_name || "Answer_Key.pdf"}</strong>
                    <p>{exam.answer_key_pages || 1} page(s) stored privately</p>
                    <span className="replace">Replace answer key document</span>
                  </>
                ) : (
                  <>
                    <span className="upload-icon">
                      <Icon name="upload" size={26} />
                    </span>
                    <strong>
                      Drop the answer key here, or <span>browse files</span>
                    </strong>
                    <p>PDF, JPG, JPEG or PNG · Maximum file size 20 MB</p>
                    <span className="browse">Select File</span>
                  </>
                )}
              </div>

              {extractionNote && (
                <div className="verify-banner" style={{ marginBottom: 0 }}>
                  <Icon name="alert" />
                  <div>
                    <strong>Document extraction report</strong>
                    <p>{extractionNote}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mobile-tab-bar">
            <button
              className={mobileTab === "editor" ? "active" : ""}
              onClick={() => setMobileTab("editor")}
            >
              Questions &amp; Rubrics ({questions.length})
            </button>
            <button
              className={mobileTab === "preview" ? "active" : ""}
              onClick={() => setMobileTab("preview")}
            >
              Document Preview
            </button>
          </div>

          <div className="split-review" style={{ marginTop: 18 }}>
            <div className={mobileTab === "preview" ? "mobile-show" : "mobile-hide-panel"}>
              <DocumentViewer
                fileId={exam.answer_key_file_id}
                fileName={exam.answer_key_file_name || "Answer Key Document"}
                totalPages={exam.answer_key_pages || 1}
                currentPage={currentQ?.page_number || 1}
                highlightLabel={`Question ${activeIdx + 1} mapped to page ${currentQ?.page_number || 1}`}
              />
            </div>

            <section
              className={`card extraction ${
                mobileTab === "editor" ? "mobile-show" : "mobile-hide-panel"
              }`}
            >
              <div className="panel-head">
                <div>
                  <h3>Questions &amp; Marking Rubrics</h3>
                  <p>
                    {questions.length} question(s) · Sum: {sumQuestionMarks} / {exam.total_marks}{" "}
                    marks
                  </p>
                </div>
                <Badge
                  tone={
                    Math.abs(sumQuestionMarks - exam.total_marks) < 0.01 ? "green" : "amber"
                  }
                >
                  {Math.abs(sumQuestionMarks - exam.total_marks) < 0.01
                    ? "Total Matches"
                    : "Total Mismatch"}
                </Badge>
              </div>

              <div className="question-tabs" style={{ flexWrap: "wrap" }}>
                {questions.map((q, idx) => (
                  <button
                    key={idx}
                    className={idx === activeIdx ? "active" : ""}
                    onClick={() => setActiveIdx(idx)}
                  >
                    Q{idx + 1}
                  </button>
                ))}
                <button
                  className="add-q-tab"
                  onClick={addQuestion}
                  title="Add question"
                  style={{ width: "auto", padding: "0 10px" }}
                >
                  + Add
                </button>
              </div>

              {validationError && (
                <div className="form-error-box" style={{ margin: "12px 18px 0" }}>
                  <Icon name="alert" size={16} />
                  <span>{validationError}</span>
                </div>
              )}

              {currentQ && (
                <>
                  <div className="q-header-actions">
                    <strong>Editing Question {activeIdx + 1}</strong>
                    <button
                      className="link text-red"
                      onClick={() => removeQuestion(activeIdx)}
                    >
                      <Icon name="trash" size={13} /> Delete Question
                    </button>
                  </div>

                  <label>
                    Question Prompt
                    <textarea
                      value={currentQ.question_text}
                      onChange={(e) =>
                        updateQuestion(activeIdx, { question_text: e.target.value })
                      }
                    />
                  </label>

                  <div className="compact-grid">
                    <label>
                      Question Type
                      <select
                        value={currentQ.question_type}
                        onChange={(e) =>
                          updateQuestion(activeIdx, {
                            question_type: e.target.value as QuestionType,
                          })
                        }
                      >
                        <option value="MCQ">MCQ</option>
                        <option value="True/False">True/False</option>
                        <option value="Numerical">Numerical</option>
                        <option value="Short Answer">Short Answer</option>
                        <option value="Descriptive">Descriptive</option>
                      </select>
                    </label>

                    <label>
                      Maximum Marks
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={currentQ.max_marks}
                        onChange={(e) =>
                          updateQuestion(activeIdx, {
                            max_marks: Number(e.target.value),
                          })
                        }
                      />
                    </label>

                    <label>
                      Topic / Concept Area
                      <input
                        value={currentQ.topic}
                        onChange={(e) => updateQuestion(activeIdx, { topic: e.target.value })}
                        placeholder="e.g., Stack and Queue"
                      />
                    </label>

                    <label>
                      Key Page Reference
                      <input
                        type="number"
                        min={1}
                        value={currentQ.page_number}
                        onChange={(e) =>
                          updateQuestion(activeIdx, { page_number: Number(e.target.value) || 1 })
                        }
                      />
                    </label>
                  </div>

                  {currentQ.question_type === "Numerical" && (
                    <label>
                      Allowed Numerical Tolerance (±)
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={currentQ.numerical_tolerance}
                        onChange={(e) =>
                          updateQuestion(activeIdx, {
                            numerical_tolerance: Number(e.target.value) || 0,
                          })
                        }
                      />
                    </label>
                  )}

                  <label>
                    Official Reference Answer
                    <textarea
                      value={currentQ.reference_answer}
                      onChange={(e) =>
                        updateQuestion(activeIdx, { reference_answer: e.target.value })
                      }
                      placeholder={
                        currentQ.question_type === "True/False"
                          ? "True or False"
                          : "Enter the verified reference answer…"
                      }
                    />
                  </label>

                  <label>
                    Accepted Alternative Answers (comma-separated)
                    <input
                      value={currentQ.alternative_answers.join(", ")}
                      onChange={(e) =>
                        updateQuestion(activeIdx, {
                          alternative_answers: e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="Optional equivalent answers or phrasings"
                    />
                  </label>

                  <div className="rubric-editor-head">
                    <label style={{ margin: 0 }}>Marking Rubric Criteria</label>
                    <small
                      className={
                        Math.abs(currentRubricSum - Number(currentQ.max_marks)) < 0.01
                          ? "text-green"
                          : "text-red"
                      }
                    >
                      Sum: {currentRubricSum} / {currentQ.max_marks} marks
                    </small>
                  </div>

                  <div className="criteria">
                    {currentQ.rubrics.map((r, rIdx) => (
                      <div key={rIdx}>
                        <span>{rIdx + 1}</span>
                        <input
                          value={r.criterion_name}
                          placeholder="Criterion description"
                          onChange={(e) => {
                            const updated = currentQ.rubrics.map((item, i) =>
                              i === rIdx ? { ...item, criterion_name: e.target.value } : item
                            );
                            updateQuestion(activeIdx, { rubrics: updated });
                          }}
                        />
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          value={r.max_marks}
                          onChange={(e) => {
                            const updated = currentQ.rubrics.map((item, i) =>
                              i === rIdx ? { ...item, max_marks: Number(e.target.value) } : item
                            );
                            updateQuestion(activeIdx, { rubrics: updated });
                          }}
                        />
                        <small>marks</small>
                        {currentQ.rubrics.length > 1 && (
                          <button
                            type="button"
                            className="remove-crit"
                            onClick={() => {
                              updateQuestion(activeIdx, {
                                rubrics: currentQ.rubrics.filter((_, i) => i !== rIdx),
                              });
                            }}
                            aria-label="Remove criterion"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        updateQuestion(activeIdx, {
                          rubrics: [
                            ...currentQ.rubrics,
                            { criterion_name: "Additional Criterion", max_marks: 0 },
                          ],
                        })
                      }
                    >
                      + Add criterion
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="sticky-actions">
            <Button
              kind="secondary"
              disabled={saving || exam.status === "Published"}
              onClick={() => handleSave(false)}
            >
              Save Draft
            </Button>
            <Button
              disabled={saving || exam.status === "Published"}
              onClick={() => handleSave(true)}
            >
              {saving ? "Verifying…" : "Verify Key & Continue to Sheets"} <span>→</span>
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}

