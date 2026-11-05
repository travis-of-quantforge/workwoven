"use client";
import { useState } from "react";
import Link from "next/link";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
type FileRow = {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  extraction_status: string;
  upload_status: string;
  source_message_id: string | null;
  preview: string | null;
};
export function FileList({
  files,
  id,
  visibility,
  submissions,
}: {
  files: FileRow[];
  id: string;
  visibility: string;
  submissions: { attachment_id: string; submission_id: string }[];
}) {
  const [query, setQuery] = useState(""),
    [type, setType] = useState("all");
  const shown = files.filter(
    (f) =>
      f.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (type === "all" ||
        (type === "text"
          ? f.mime_type.startsWith("text/")
          : type === "image"
            ? f.mime_type.startsWith("image/")
            : f.mime_type === "application/pdf")),
  );
  return (
    <div className="panel">
      <h2>{visibility === "shared" ? "Shared files" : "Your private files"}</h2>
      <p className="muted my-4">
        This context contains only authorised files. Downloads expire after 60
        seconds. Sharing an attachment does not submit formal delivery.
      </p>
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label htmlFor="file-search">Search file names</label>
          <input
            id="file-search"
            value={query}
            maxLength={200}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
          />
        </div>
        <div>
          <label htmlFor="file-type">File type</label>
          <select
            id="file-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="all">All types</option>
            <option value="text">Text and CSV</option>
            <option value="image">Images</option>
            <option value="pdf">PDF</option>
          </select>
        </div>
      </div>
      <p className="muted text-xs mb-4">
        {shown.length} of {files.length} files in this context (up to 1,000
        loaded).
      </p>
      {!files.length && <p>No files in this context.</p>}
      {files.length > 0 && !shown.length && (
        <p>No files match these filters.</p>
      )}
      {shown.map((f) => (
        <article
          key={f.id}
          id={`file-${f.id}`}
          className="border-t border-slate-100 py-4"
        >
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div className="min-w-0">
              <h3 className="break-words">{f.name}</h3>
              <p className="muted text-xs mt-2">
                {Math.ceil(f.size_bytes / 1024)} KB · {f.mime_type} ·
                extraction: {f.extraction_status}
              </p>
            </div>
            <ActionForm actionName="download">
              <input type="hidden" name="attachment" value={f.id} />
              <Button variant="outline" disabled={f.upload_status !== "ready"}>
                {f.upload_status === "ready"
                  ? "Download"
                  : "Upload not confirmed"}
              </Button>
            </ActionForm>
          </div>
          {f.source_message_id ? (
            <Link
              className="underline text-xs block mt-3"
              href={`/workspace/${id}?tab=discussion${visibility === "shared" ? "" : "&context=private"}&message=${f.source_message_id}#message-${f.source_message_id}`}
            >
              Source discussion message
            </Link>
          ) : (
            <p className="muted text-xs mt-3">
              Earlier upload · no source message was recorded.
            </p>
          )}
          {submissions
            .filter((s) => s.attachment_id === f.id)
            .map((s) => (
              <Link
                key={s.submission_id}
                className="underline text-xs block mt-3"
                href={`/workspace/${id}?tab=milestones#submission-${s.submission_id}`}
              >
                Formal delivery submission
              </Link>
            ))}
          {f.preview !== null && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-teal-800">
                Extracted text preview
              </summary>
              <pre className="text-xs whitespace-pre-wrap break-words bg-slate-50 rounded-lg p-4 mt-3">
                {f.preview}
              </pre>
              <p className="muted text-xs mt-2">
                Preview shows at most 2,000 characters.{" "}
                {f.extraction_status === "partial"
                  ? "Extraction is incomplete; the full file was not analysed."
                  : "Download to inspect the full file."}
              </p>
            </details>
          )}
          {f.extraction_status === "unsupported" && (
            <p className="muted text-xs mt-3">
              Agent analysis is not supported for this file type. The assistant
              cannot claim to have read it.
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
