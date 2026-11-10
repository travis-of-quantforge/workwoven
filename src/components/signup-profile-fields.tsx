"use client";
import { useState } from "react";

export function SignupProfileFields({ invitedRole }: { invitedRole?: string }) {
  const [role, setRole] = useState(invitedRole || "client");
  return (
    <>
      {!invitedRole && (
        <div>
          <label htmlFor="profile-type">Start as</label>
          <select
            id="profile-type"
            name="profileType"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            required
          >
            <option value="client">Client</option>
            <option value="professional">Freelancer / professional</option>
          </select>
        </div>
      )}
      {role === "professional" && (
        <div>
          <label htmlFor="hourly-rate">Hourly rate (USD)</label>
          <input
            id="hourly-rate"
            name="hourlyRate"
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
          />
          <p className="muted text-xs mt-2">Optional. You can set this later in Profile.</p>
        </div>
      )}
    </>
  );
}
