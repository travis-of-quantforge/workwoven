"use client";
import { useState } from "react";
import { ActionForm } from "./action-form";
import { Button } from "./ui/button";
export function ShareDraft({ id }: { id: string }) {
  const [preview, setPreview] = useState(false);
  const [body, setBody] = useState("");
  return (
    <div className="panel">
      <h2>Share selected content</h2>
      <p className="muted my-3 text-sm">
        Paste only the content you want both parties to see. Sharing creates a
        new copy, and does not approve an agreement.
      </p>
      {!preview ? (
        <>
          <label htmlFor="selected">Selected content</label>
          <textarea
            id="selected"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button
            className="mt-3"
            variant="outline"
            disabled={!body.trim()}
            onClick={() => setPreview(true)}
          >
            Preview shared copy
          </Button>
        </>
      ) : (
        <ActionForm actionName="share">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="body" value={body} />
          <input type="hidden" name="confirmed" value="yes" />
          <div className="notice whitespace-pre-wrap mb-4">{body}</div>
          <div className="flex gap-3">
            <Button>Confirm and share</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreview(false)}
            >
              Back
            </Button>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
