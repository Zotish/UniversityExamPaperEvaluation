import { useEffect, useState } from "react";
import { downloadProtectedFile, fetchPrivateBlobUrl } from "../lib/api";
import { EmptyState, Icon } from "./ui";

export function DocumentViewer({
  fileId,
  fileName,
  totalPages = 1,
  currentPage = 1,
  onPageChange,
  highlightLabel,
  fallbackText,
}: {
  fileId: number | null | undefined;
  fileName?: string | null;
  totalPages?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  highlightLabel?: string;
  fallbackText?: string;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("application/pdf");
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(currentPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"document" | "text">("document");

  useEffect(() => {
    setPage(currentPage);
  }, [currentPage]);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    if (!fileId) {
      setBlobUrl(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchPrivateBlobUrl(fileId)
      .then((res) => {
        if (!active) {
          URL.revokeObjectURL(res.url);
          return;
        }
        createdUrl = res.url;
        setBlobUrl(res.url);
        setMimeType(res.mimeType);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Could not load document.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [fileId]);

  const setSafePage = (next: number) => {
    const clamped = Math.max(1, Math.min(Math.max(1, totalPages), next));
    setPage(clamped);
    onPageChange?.(clamped);
  };

  return (
    <section className="card script-panel">
      <div className="panel-head">
        <div>
          <h3>{fileName || "Document Preview"}</h3>
          <p>
            {fileId
              ? `${mimeType.includes("pdf") ? "PDF Document" : "Scanned Image"} · ${totalPages} page(s)`
              : "No file attached"}
          </p>
        </div>
        <div className="doc-controls">
          {fallbackText && (
            <button
              className={`mode-pill ${viewMode === "text" ? "active" : ""}`}
              onClick={() => setViewMode(viewMode === "document" ? "text" : "document")}
              title="Toggle between original document and extracted text view"
              style={{ width: "auto", padding: "0 8px", fontSize: 10 }}
            >
              {viewMode === "document" ? "Text" : "Doc"}
            </button>
          )}
          <button
            onClick={() => setZoom((z) => Math.max(60, z - 15))}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <span>{zoom}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(200, z + 15))}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <Icon name="zoom" size={14} />
          </button>
          {fileId && (
            <button
              onClick={() => downloadProtectedFile(`/api/files/${fileId}`, fileName || "document")}
              aria-label="Download document"
              title="Download original file"
            >
              <Icon name="download" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="page-control">
        <button
          onClick={() => setSafePage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          ←
        </button>
        <span>
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <button
          onClick={() => setSafePage(page + 1)}
          disabled={page >= Math.max(1, totalPages)}
          aria-label="Next page"
        >
          →
        </button>
      </div>

      <div className="document">
        {!fileId ? (
          <EmptyState
            icon="file"
            title="No document attached"
            description="Upload a PDF or image document to inspect it alongside evaluation details."
          />
        ) : loading ? (
          <div className="doc-loading">Loading protected document…</div>
        ) : error ? (
          <EmptyState icon="alert" title="Preview unavailable" description={error} />
        ) : viewMode === "text" && fallbackText ? (
          <div className="paper" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
            <pre className="doc-text-pre">{fallbackText}</pre>
          </div>
        ) : blobUrl && mimeType.startsWith("image/") ? (
          <div className="doc-image-wrap">
            <img
              src={blobUrl}
              alt={fileName || "Uploaded answer sheet"}
              style={{ width: `${zoom}%`, maxWidth: "none" }}
            />
          </div>
        ) : blobUrl ? (
          <iframe
            key={`${blobUrl}-${page}-${zoom}`}
            src={`${blobUrl}#page=${page}&zoom=${zoom}`}
            title={fileName || "PDF Document"}
            className="doc-pdf-frame"
          />
        ) : null}
      </div>

      {highlightLabel && (
        <div className="highlight-key">
          <span /> {highlightLabel}
        </div>
      )}
    </section>
  );
}

