"use client";
import { useState } from "react";
import { contractTemplates } from "@/lib/contracts";
export function ContractCreation() {
  const [body, setBody] = useState<string>(contractTemplates[0].body);
  return (
    <details className="text-left rounded-lg border border-slate-200 p-4">
      <summary className="cursor-pointer font-medium">
        Contract · editable starting template
      </summary>
      <label htmlFor="contract-template" className="mt-4">
        Starting contract
      </label>
      <select
        id="contract-template"
        name="contractTemplate"
        defaultValue="general"
        onChange={(event) =>
          setBody(
            contractTemplates.find((t) => t.id === event.target.value)?.body ||
              "",
          )
        }
      >
        {contractTemplates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <label htmlFor="contract-body" className="mt-4">
        Contract draft
      </label>
      <textarea
        id="contract-body"
        name="contractBody"
        rows={12}
        minLength={20}
        maxLength={20000}
        required
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <p className="muted text-xs mt-3">
        Review and adapt the template. Creating the engagement saves a draft;
        both parties approve the contract later.
      </p>
    </details>
  );
}
