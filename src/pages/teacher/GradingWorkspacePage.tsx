import { useEffect, useState } from "react";
import { DocumentViewer } from "../../components/DocumentViewer";
import { Shell } from "../../components/Shell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
  Modal,
  statusTone,
} from "../../components/ui";
import { apiRequest } from "../../lib/api";
import type { AuditEntry, NavState, QuestionEvaluation, Screen, Submission } from "../../types";

export function GradingWorkspacePage({
  examId,
  submissionId,
  initialQuestionNumber,
  go,
  notify,
}: {
  examId?: number;
  submissionId?: number;
  initialQuestionNumber?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [submissionsList, setSubmissionsList] = useState<Submission[]>([]);
  const [activeSubId, setActiveSubId] = useState<number | undefined>(submissionId);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [evaluations, setEvaluations] = useState<QuestionEvaluation[]>([]);
  const [auditTrail, setAuditTrail] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qIdx, setQIdx] = useState(0);
  const [editingText, setEditingText] = useState(false);

  // Draft fields for currently active question
  const [draftAnswer, setDraftAnswer] = useState("");
  const [draftRubrics, setDraftRubrics] = useState<
    { criterionName: string; maxMarks: number; awardedMarks: number }[]
  >([]);
  const [draftScore, setDraftScore] = useState("0");
  const [draftFeedback, setDraftFeedback] = useState("");
  const [draftFlagged, setDraftFlagged] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Published exam audited correction modal
  const [correctionModal, setCorrectionModal] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [overallFeedback, setOverallFeedback] = useState("");

  const syncDraftFromQuestion = (ev: QuestionEvaluation | undefined) => {
    if (!ev) return;
    setDraftAnswer(ev.extracted_answer || "");
    setDraftRubrics(ev.rubric_scores.map((r) => ({ ...r })));
    const initialScore = ev.approved_marks ?? ev.suggested_marks ?? 0;
    setDraftScore(String(initialScore));
    setDraftFeedback(ev.teacher_feedback || ev.ai_feedback || "");
    setDraftFlagged(Boolean(ev.flagged));
    setEditingText(false);
    setDirty(false);
  };

  const loadSubmission = async (subIdToLoad?: number) => {
    setLoading(true);
    setError(null);
    try {
      let targetSubId = subIdToLoad;

      if (!targetSubId) {
        const examsRes = await apiRequest<{ exams: { id: number }[] }>("/api/exams");
        const targetExamId = examId || examsRes.exams[0]?.id;
        if (targetExamId) {
          const sRes = await apiRequest<{ submissions: Submission[] }>(
            `/api/exams/${targetExamId}/submissions`
          );
          setSubmissionsList(sRes.submissions);
          targetSubId =
            sRes.submissions.find((s) => s.review_status !== "Teacher Approved")?.id ||
            sRes.submissions[0]?.id;
        }
      }

      if (!targetSubId) {
        setSubmission(null);
        setLoading(false);
        return;
      }

      setActiveSubId(targetSubId);
      const detail = await apiRequest<{
        submission: Submission;
        evaluations: QuestionEvaluation[];
        auditTrail: AuditEntry[];
      }>(`/api/submissions/${targetSubId}`);

      setSubmission(detail.submission);
      setEvaluations(detail.evaluations);
      setAuditTrail(detail.auditTrail || []);
      setOverallFeedback(detail.submission.teacher_overall_feedback || "");

      // Fetch sibling submissions for fast student switching
      const siblingRes = await apiRequest<{ submissions: Submission[] }>(
        `/api/exams/${detail.submission.exam_id}/submissions`
      );
      setSubmissionsList(siblingRes.submissions);

      const startIdx = initialQuestionNumber
        ? Math.max(
            0,
            detail.evaluations.findIndex((e) => e.question_number === initialQuestionNumber)
          )
        : 0;
      setQIdx(startIdx);
      syncDraftFromQuestion(detail.evaluations[startIdx]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load grading workspace.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubmission(submissionId);
  }, [submissionId, examId]);

  const currentEv = evaluations[qIdx];

  const handleSaveQuestion = async (opts?: {
    flagOverride?: boolean;
    advance?: boolean;
    reason?: string;
  }): Promise<boolean> => {
    if (!submission || !currentEv) return false;
    const numericScore = Number(draftScore);
    if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > currentEv.max_marks) {
      notify(`Score must be between 0 and ${currentEv.max_marks}.`, "error");
      return false;
    }

    if (submission.exam_status === "Published" && !opts?.reason?.trim()) {
      setCorrectionModal(true);
      return false;
    }

    setSaving(true);
    try {
      const flaggedValue = opts?.flagOverride !== undefined ? opts.flagOverride : draftFlagged;
      const res = await apiRequest<{
        totalApproved: number;
        submissionReviewStatus: string;
      }>(`/api/submissions/${submission.id}/questions/${currentEv.question_id}`, {
        method: "PUT",
        body: JSON.stringify({
          extractedAnswer: draftAnswer,
          approvedMarks: numericScore,
          rubricScores: draftRubrics,
          teacherFeedback: draftFeedback,
          correctConcepts: currentEv.correct_concepts,
          missingConcepts: currentEv.missing_concepts,
          flagged: flaggedValue,
          markReviewed: !flaggedValue,
          correctionReason: opts?.reason,
        }),
      });

      const updatedEvals = evaluations.map((ev, i) =>
        i === qIdx
          ? {
              ...ev,
              extracted_answer: draftAnswer,
              approved_marks: numericScore,
              rubric_scores: draftRubrics,
              teacher_feedback: draftFeedback,
              flagged: flaggedValue,
              review_status: flaggedValue ? "Manual Review Required" : "Teacher Approved",
            }
          : ev
      );

      setEvaluations(updatedEvals);
      setSubmission({
        ...submission,
        total_approved_marks: res.totalApproved,
        review_status: res.submissionReviewStatus,
      });
      setDraftFlagged(flaggedValue);
      setDirty(false);
      setCorrectionModal(false);
      setCorrectionReason("");

      notify(
        flaggedValue
          ? `Q${currentEv.question_number} flagged for review`
          : `Q${currentEv.question_number} saved (${numericScore}/${currentEv.max_marks})`
      );

      if (opts?.advance && qIdx < updatedEvals.length - 1) {
        const nextIdx = qIdx + 1;
        setQIdx(nextIdx);
        syncDraftFromQuestion(updatedEvals[nextIdx]);
      }
      return true;
    } catch (err) {
      notify(err instanceof Error ? err.message : "Failed to save question evaluation.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const switchQuestion = async (nextIdx: number) => {
    if (nextIdx === qIdx || nextIdx < 0 || nextIdx >= evaluations.length) return;
    if (dirty) {
      const confirmSwitch = window.confirm(
        "You have unsaved changes for this question. Save before switching?"
      );
      if (confirmSwitch) {
        const ok = await handleSaveQuestion();
        if (!ok) return;
      }
    }
    setQIdx(nextIdx);
    syncDraftFromQuestion(evaluations[nextIdx]);
  };

  const handleApproveSubmission = async () => {
    if (!submission) return;
    if (dirty) {
      const ok = await handleSaveQuestion();
      if (!ok) return;
    }
    setSaving(true);
    try {
      const res = await apiRequest<{ totalApproved: number; examStatus: string }>(
        `/api/submissions/${submission.id}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ teacherOverallFeedback: overallFeedback }),
        }
      );
      notify(
        `Student evaluation approved (${res.totalApproved}/${submission.exam_total_marks})`
      );
      await loadSubmission(submission.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Approval failed.", "error");
    } finally {
      setSaving(false);
    }
  };

  // Keyboard shortcuts: Ctrl/Cmd+S to save, Alt+ArrowLeft / Alt+ArrowRight to navigate questions
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveQuestion();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        switchQuestion(qIdx + 1);
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        switchQuestion(qIdx - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const currentTotalScore = evaluations.reduce(
    (sum, ev, idx) =>
      sum + (idx === qIdx ? Number(draftScore) || 0 : Number(ev.approved_marks ?? ev.suggested_marks ?? 0)),
    0
  );

  return (
    <Shell
      screen="review"
      go={go}
      title="Grading Workspace"
      breadcrumb={
        submission ? `${submission.course_code} / ${submission.exam_title}` : "Answer Review"
      }
    >
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => loadSubmission(activeSubId)} />
      ) : !submission ? (
        <EmptyState
          icon="clipboard"
          title="No submission selected"
          description="Select a student submission from Evaluations to open the grading workspace."
          action={
            <Button onClick={() => go("evaluations")}>Go to Evaluations</Button>
          }
        />
      ) : (
        <>
          <div className="review-top">
            <div>
              <button
                className="back-link"
                onClick={() => go("evaluations", { examId: submission.exam_id })}
              >
                ← Back to evaluations
              </button>
              <h1>Grading Workspace</h1>
              <p>
                {submission.student_name} · {submission.student_id_number} ·{" "}
                {submission.exam_title}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {submissionsList.length > 1 && (
                <select
                  value={submission.id}
                  onChange={(e) => loadSubmission(Number(e.target.value))}
                  aria-label="Switch student submission"
                >
                  {submissionsList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.student_name || s.detected_student_name} (
                      {s.student_id_number || s.detected_student_id}) — {s.review_status}
                    </option>
                  ))}
                </select>
              )}
              {dirty && <Badge tone="amber">Unsaved changes</Badge>}
              <Badge tone={statusTone(submission.review_status)}>
                {submission.review_status}
              </Badge>
              <Button
                kind="secondary"
                disabled={saving}
                onClick={() => handleSaveQuestion()}
              >
                Save Progress (Ctrl+S)
              </Button>
            </div>
          </div>

          <div className="review-workspace">
            <DocumentViewer
              fileId={submission.document_id}
              fileName={submission.file_name || "Student Answer Sheet"}
              totalPages={submission.page_count || 1}
              currentPage={currentEv?.page_reference || 1}
              highlightLabel={
                currentEv
                  ? `Question ${currentEv.question_number} · Page ${currentEv.page_reference}`
                  : undefined
              }
              fallbackText={evaluations
                .map((e) => `Q${e.question_number}: ${e.extracted_answer || "(No extracted text)"}`)
                .join("\n\n")}
            />

            <section className="card grading-panel">
              <div className="student-strip">
                <span className="initial">{submission.avatar_initials || "ST"}</span>
                <div>
                  <strong>{submission.student_name}</strong>
                  <small>
                    {submission.student_id_number} · Running Total: {currentTotalScore} /{" "}
                    {submission.exam_total_marks}
                  </small>
                </div>
                {currentEv && (
                  <Badge tone={statusTone(currentEv.review_status)}>
                    {currentEv.review_status}
                  </Badge>
                )}
              </div>

              <div className="question-tabs wide">
                {evaluations.map((ev, i) => (
                  <button
                    key={ev.question_id}
                    className={i === qIdx ? "active" : ""}
                    onClick={() => switchQuestion(i)}
                  >
                    Q{ev.question_number}
                    <small>
                      {ev.approved_marks ?? ev.suggested_marks ?? 0}/{ev.max_marks}
                    </small>
                  </button>
                ))}
              </div>

              {currentEv && (
                <>
                  {(currentEv.extraction_status === "Uncertain" ||
                    currentEv.extraction_status === "Missing" ||
                    currentEv.review_status === "Manual Review Required" ||
                    currentEv.review_status === "Rubric Match Uncertain") && (
                    <div className="uncertain">
                      <Icon name="alert" />
                      <div>
                        <strong>
                          {currentEv.review_status} ({currentEv.evaluation_method})
                        </strong>
                        <p>
                          {currentEv.ai_feedback ||
                            "Please inspect the original script on the left and confirm the score."}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grading-scroll">
                    <div className="q-meta-bar">
                      <span>
                        Question {currentEv.question_number} · {currentEv.question_type} ·{" "}
                        {currentEv.topic}
                      </span>
                      <strong>Max: {currentEv.max_marks} marks</strong>
                    </div>

                    <p className="question-text">{currentEv.question_text}</p>

                    <h4>Reference Answer</h4>
                    <p>{currentEv.reference_answer || "No reference answer entered."}</p>

                    <div className="label-row">
                      <h4>Extracted Student Answer</h4>
                      <button type="button" onClick={() => setEditingText(!editingText)}>
                        {editingText ? "Done editing" : "Edit transcription"}
                      </button>
                    </div>
                    {editingText ? (
                      <textarea
                        className="transcription-edit"
                        value={draftAnswer}
                        onChange={(e) => {
                          setDraftAnswer(e.target.value);
                          setDirty(true);
                        }}
                      />
                    ) : (
                      <div className="student-answer">
                        {draftAnswer || (
                          <em style={{ color: "#94a3b8" }}>
                            No extracted text. Click “Edit transcription” to enter manually after
                            reading the sheet.
                          </em>
                        )}
                      </div>
                    )}

                    {(currentEv.correct_concepts.length > 0 ||
                      currentEv.missing_concepts.length > 0) && (
                      <>
                        <h4>Detected Concepts</h4>
                        <div className="feedback-grid">
                          <div className="positive">
                            <strong>
                              <Icon name="check" size={14} /> Correct concepts
                            </strong>
                            <p>
                              {currentEv.correct_concepts.join(" · ") ||
                                "None automatically detected."}
                            </p>
                          </div>
                          <div className="improve">
                            <strong>
                              <Icon name="alert" size={14} /> Missing / review notes
                            </strong>
                            <p>
                              {currentEv.missing_concepts.join(" · ") ||
                                "No missing concepts noted."}
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="rubric">
                      <h4>Marking Rubric</h4>
                      <div className="rubric-row head">
                        <span>Criterion</span>
                        <span>Maximum</span>
                        <span>Awarded</span>
                      </div>
                      {draftRubrics.map((r, rIdx) => (
                        <div className="rubric-row" key={rIdx}>
                          <strong>{r.criterionName}</strong>
                          <span>{r.maxMarks}</span>
                          <span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max={r.maxMarks}
                              value={r.awardedMarks}
                              onChange={(e) => {
                                const val = Math.max(
                                  0,
                                  Math.min(r.maxMarks, Number(e.target.value) || 0)
                                );
                                const nextRubrics = draftRubrics.map((item, idx) =>
                                  idx === rIdx ? { ...item, awardedMarks: val } : item
                                );
                                setDraftRubrics(nextRubrics);
                                const newSum = nextRubrics.reduce(
                                  (s, x) => s + Number(x.awardedMarks || 0),
                                  0
                                );
                                setDraftScore(String(Math.min(currentEv.max_marks, newSum)));
                                setDirty(true);
                              }}
                            />
                          </span>
                        </div>
                      ))}
                      <div className="rubric-row total">
                        <strong>Total</strong>
                        <strong>{currentEv.max_marks}</strong>
                        <strong>{draftScore}</strong>
                      </div>
                    </div>

                    <div className="score-box">
                      <div>
                        <span>Suggested score ({currentEv.evaluation_method})</span>
                        <strong>
                          {currentEv.suggested_marks ?? 0} / {currentEv.max_marks}
                        </strong>
                        <small>Suggestion only — never auto-published</small>
                      </div>
                      <div>
                        <label>Teacher approved score</label>
                        <span className="score-input">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max={currentEv.max_marks}
                            value={draftScore}
                            onChange={(e) => {
                              setDraftScore(e.target.value);
                              setDirty(true);
                            }}
                          />
                          <b>/ {currentEv.max_marks}</b>
                        </span>
                        <small>Authoritative teacher mark</small>
                      </div>
                    </div>

                    <h4>Teacher Feedback (Visible to Student After Publication)</h4>
                    <textarea
                      style={{ width: "100%" }}
                      value={draftFeedback}
                      onChange={(e) => {
                        setDraftFeedback(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="Write constructive feedback for the student…"
                    />
                  </div>

                  <div className="grading-actions">
                    <Button
                      kind="secondary"
                      disabled={qIdx === 0}
                      onClick={() => switchQuestion(qIdx - 1)}
                    >
                      ← Prev
                    </Button>
                    <Button
                      kind="secondary"
                      onClick={() => {
                        setDraftScore(String(currentEv.suggested_marks ?? 0));
                        setDirty(true);
                      }}
                    >
                      Accept Suggested ({currentEv.suggested_marks ?? 0})
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() => handleSaveQuestion({ advance: qIdx < evaluations.length - 1 })}
                    >
                      {qIdx < evaluations.length - 1 ? "Save & Next Question →" : "Save Marks"}
                    </Button>
                    <button
                      type="button"
                      className="mark-review"
                      onClick={() => handleSaveQuestion({ flagOverride: !draftFlagged })}
                    >
                      <Icon name="flag" size={13} />{" "}
                      {draftFlagged ? "Clear Flag" : "Flag Question"}
                    </button>
                  </div>
                </>
              )}
            </section>
          </div>

          <section className="card approval-panel" style={{ marginTop: 18 }}>
            <div>
              <h3>Final Student Approval</h3>
              <p>
                Overall feedback &amp; approval for{" "}
                <strong>{submission.student_name}</strong> (Total:{" "}
                <strong>
                  {currentTotalScore} / {submission.exam_total_marks}
                </strong>
                )
              </p>
              <input
                value={overallFeedback}
                onChange={(e) => setOverallFeedback(e.target.value)}
                placeholder="Overall comment for the student's result card (optional)…"
                style={{ width: "100%", marginTop: 10 }}
              />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Button disabled={saving} onClick={handleApproveSubmission}>
                Approve Student Evaluation
              </Button>
              {submission.review_status === "Teacher Approved" && (
                <Button
                  kind="secondary"
                  onClick={() => go("publish", { examId: submission.exam_id })}
                >
                  Go to Publish →
                </Button>
              )}
            </div>
          </section>

          {auditTrail.length > 0 && (
            <section className="card section-card" style={{ marginTop: 18 }}>
              <div className="section-title">
                <div>
                  <h3>Grade Audit History</h3>
                  <p>Recorded score updates and approvals for this script</p>
                </div>
              </div>
              <div className="activity-list">
                {auditTrail.slice(0, 6).map((a) => (
                  <div className="activity-row" key={a.id}>
                    <span className="activity-dot" />
                    <div>
                      <strong>{a.action}</strong>
                      <small>
                        {a.actor_name} · {new Date(a.created_at + "Z").toLocaleString()} ·{" "}
                        {a.details_json}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Modal
        open={correctionModal}
        onClose={() => setCorrectionModal(false)}
        title="Audited Post-Publication Correction"
      >
        <p style={{ fontSize: 13, color: "#475569", marginBottom: 12 }}>
          This examination is already <strong>Published</strong>. Any mark change is logged in the
          academic audit trail and notifies the student.
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600 }}>
          Reason for correction
          <textarea
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            placeholder="e.g., Recheck approved; rubric criterion 2 awarded."
          />
        </label>
        <div className="modal-footer">
          <Button kind="secondary" onClick={() => setCorrectionModal(false)}>
            Cancel
          </Button>
          <Button
            disabled={!correctionReason.trim() || saving}
            onClick={() => handleSaveQuestion({ reason: correctionReason })}
          >
            Confirm Audited Update
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}

