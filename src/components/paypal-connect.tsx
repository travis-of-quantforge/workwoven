"use client";

import { useState } from "react";
import { openPayPalSellerConnection } from "@/app/actions";
import { Button } from "./ui/button";

export function PayPalConnect({ engagementId, connected, disabled }: {
  engagementId: string; connected: boolean; disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);

  async function connect() {
    setError("");
    setOpened(false);
    // Open during the click so popup blockers do not reject an async open.
    const popup = window.open("about:blank", "_blank", "popup,width=650,height=800");
    if (!popup) {
      setError("Allow popups for this site, then try connecting again.");
      return;
    }
    popup.opener = null;
    setPending(true);
    try {
      const form = new FormData();
      form.set("id", engagementId);
      const result = await openPayPalSellerConnection(form);
      if (result.error) throw new Error(result.error);
      if (popup.closed) throw new Error("The PayPal window was closed. Try connecting again.");
      popup.location.replace(result.url);
      setOpened(true);
    } catch (error) {
      popup.close();
      setError(error instanceof Error ? error.message : "Could not open PayPal. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <div>
    <Button type="button" variant="outline" disabled={disabled || pending} onClick={connect}>
      {pending ? "Opening PayPal…" : connected ? "Reconnect PayPal sandbox" : "Connect PayPal sandbox"}
    </Button>
    {error && <p role="alert" className="notice text-sm mt-3">{error}</p>}
    {opened && <p role="status" className="muted text-sm mt-3">Finish connecting in the PayPal window, then select Refresh connection here.</p>}
  </div>;
}
