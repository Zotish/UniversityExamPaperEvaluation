import { useEffect, useRef, useState } from "react";
import { Shell } from "../../components/Shell";
import { Badge, Button, ErrorBanner, Icon, PageHead, statusTone } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { apiRequest } from "../../lib/api";
import type { AiCapabilities, NavState, OcrCapabilities, Screen, Submission } from "../../types";

interface ProcessedItem {
  submissionId: number;
  studentName: string;
  studentIdNumber?: string;
  totalSuggested?: number;
  processingStatus?: string;
  extractionMessage?: string;
  status?: string;
}

export function ProcessingPage({
  examId,
  go,
  notify,
}: {
  examId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const { refreshNotifications } = useAuth();
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processed, setProcessed] = useState<ProcessedItem[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [ocrInfo, setOcrInfo] = useState<OcrCapabilities | null>(null);
  const [aiInfo, setAiInfo] = useState<AiCapabilities | null>(null);
  const startedRef = useRef(false);

  const runPipeline = async () => {
    if (!examId) {
      setRunning(false);
      setError("No examination selected for processing.");
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const subRes = await apiRequest<{ submissions: Submission[] }>(
        `/api/exams/${examId}/submissions`
      );
      setSubmissions(subRes.submissions);

      const res = await apiRequest<{
        status: string;
        ocr: OcrCapabilities;
        ai: AiCapabilities;
        processed: ProcessedItem[];
      }>(`/api/exams/${examId}/evaluate`, { method: "POST" });

      setProcessed(res.processed);
      setOcrInfo(res.ocr);
      setAiInfo(res.ai);
      await refreshNotifications();
      notify("Batch extraction & evaluation complete");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation pipeline failed.");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    runPipeline();
  }, [examId]);

  return (
    <Shell
      screen="processing"
      go={go}
      title="Evaluation Pipeline"
      breadcrumb="Examinations / Document Extraction & Evaluation"
    >
      <PageHead
        title={running ? "Processing Answer Sheets…" : error ? "Processing Blocked" : "Evaluation Complete"}
        subtitle={
          running
            ? "Extracting text and evaluating responses."
            : "All processed submissions are ready for teacher review."
        }
      />

      {error ? (
        <div className="card" style={{ padding: 24 }}>
          <ErrorBanner message={error} onRetry={runPipeline} />
          <div style={{ marginTop: 16 }}>
            <Button kind="secondary" onClick={() => go("sheets", { examId })}>
              ← Return to Student Sheets
            </Button>
          </div>
        </div>
      ) : (
        <div className="processing-grid">
          <section className="card progress-card">
            <div className="processing-icon">
              <Icon name={running ? "file" : "check"} size={28} />
              <i className={running ? "" : "done"} />
            </div>

            <Badge tone={running ? "blue" : "green"}>
              {running ? "RUNNING PIPELINE" : "PIPELINE COMPLETE"}
            </Badge>

            <h2>
              {running
                ? `Processing ${submissions.length || ""} answer sheet(s)…`
                : `${processed.length} answer sheet(s) processed`}
            </h2>

            <p>
              {running
                ? "Parsing document pages, extracting selectable text, and applying deterministic / rubric rules."
                : "Teacher verification is required before any grade is finalized or published."}
            </p>

            <div className="progress">
              <i style={{ width: running ? "65%" : "100%" }} />
            </div>

            <div className="process-steps">
              {[
                "Validate uploaded PDF / image documents",
                "Extract pages and text via OCR provider",
                "Match question numbers and answer boundaries",
                "Run deterministic & configured evaluation rules",
              ].map((stepLabel, idx) => (
                <div
                  className={!running || idx < 2 ? "complete" : idx === 2 ? "current" : ""}
                  key={stepLabel}
                >
                  <span>
                    {!running || idx < 2 ? <Icon name="check" size={14} /> : idx + 1}
                  </span>
                  <p>{stepLabel}</p>
                  {running && idx === 2 && <small>In progress</small>}
                </div>
              ))}
            </div>

            {ocrInfo && (
              <div className="capability-box">
                <strong>OCR Provider: {ocrInfo.providerName}</strong>
                <p>{ocrInfo.configurationNote}</p>
              </div>
            )}

            {aiInfo && (
              <div className="capability-box" style={{ marginTop: 10 }}>
                <strong>Evaluation Engine: {aiInfo.providerName}</strong>
                <p>{aiInfo.configurationNote}</p>
              </div>
            )}

            {!running && (
              <div style={{ marginTop: 22, display: "flex", gap: 10, justifyContent: "center" }}>
                <Button kind="secondary" onClick={() => go("sheets", { examId })}>
                  Back to Sheets
                </Button>
                <Button onClick={() => go("results", { examId })}>
                  Review Evaluations <span>→</span>
                </Button>
              </div>
            )}
          </section>

          <section className="card process-list">
            <div className="section-title">
              <div>
                <h3>Processing Queue</h3>
                <p>{processed.length || submissions.length} script(s)</p>
              </div>
            </div>

            {!running && processed.length > 0
              ? processed.map((p) => (
                  <div className="queue-row" key={p.submissionId}>
                    <span className="initial">
                      {(p.studentName || "ST")
                        .split(" ")
                        .map((x) => x[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <div>
                      <strong>{p.studentName}</strong>
                      <small>
                        {p.studentIdNumber || ""} ·{" "}
                        {p.extractionMessage || p.status || "Processed"}
                      </small>
                    </div>
                    <Badge tone={statusTone(p.processingStatus || p.status || "Completed")}>
                      {p.processingStatus || p.status || "Completed"}
                    </Badge>
                  </div>
                ))
              : submissions.map((s) => (
                  <div className="queue-row" key={s.id}>
                    <span className="initial">{s.avatar_initials || "ST"}</span>
                    <div>
                      <strong>{s.student_name || s.detected_student_name}</strong>
                      <small>{s.student_id_number || s.detected_student_id}</small>
                    </div>
                    <Badge tone="blue">Processing</Badge>
                  </div>
                ))}
          </section>
        </div>
      )}
    </Shell>
  );
}

