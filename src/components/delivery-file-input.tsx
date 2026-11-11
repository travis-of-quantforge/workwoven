"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads";

export function DeliveryFileInput({ id }: { id: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const form = input.current?.form;
    const reset = () => {
      input.current?.setCustomValidity("");
      setSelected(false);
      setError("");
    };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);
  return <div>
    <input ref={input} id={id} name="deliveryUpload" type="file" accept=".txt,.csv,.pdf,.png,.jpg,.jpeg"
      aria-describedby={error ? `${id}-error` : undefined}
      onChange={event => {
        const file = event.currentTarget.files?.[0];
        const reason = file && (file.size === 0 || file.size > MAX_UPLOAD_BYTES) ? "Choose a non-empty file up to 20 MB." : "";
        event.currentTarget.setCustomValidity(reason);
        setSelected(!!file);
        setError(reason);
      }} />
    {selected && <button type="button" className="mt-2 text-xs text-teal-900 underline" onClick={() => {
      if (input.current) { input.current.value = ""; input.current.setCustomValidity(""); }
      setSelected(false); setError("");
    }}>Remove selected file</button>}
    {error && <p id={`${id}-error`} role="alert" className="notice text-xs mt-2">{error}</p>}
  </div>;
}
