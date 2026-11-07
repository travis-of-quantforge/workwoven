"use client";
import { useEffect, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

export function MessageAttachmentPicker() {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const clear = () => setName("");
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, []);
  return (
    <div className="flex min-w-0 items-center gap-2 border-y border-slate-200 py-2 my-3">
      <button
        type="button"
        className="inline-flex items-center rounded-md border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700"
        aria-label="Attach a file"
        title="Attach a file"
        onClick={() => input.current?.click()}
      >
        <Paperclip size={16} aria-hidden="true" />
      </button>
      <input
        ref={input}
        id="message-file"
        type="file"
        name="file"
        accept=".txt,.csv,.pdf,.png,.jpg,.jpeg"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => setName(event.target.files?.[0]?.name || "")}
      />
      {name && (
        <>
          <span className="min-w-0 truncate text-xs" title={name}>{name}</span>
          <button
            type="button"
            className="rounded p-1 text-slate-600 hover:bg-slate-100"
            aria-label="Remove attachment"
            onClick={() => {
              if (input.current) input.current.value = "";
              setName("");
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}
