"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { openPayPalSellerConnection, checkPayPalSellerConnection } from "@/app/actions";
import { Button } from "./ui/button";

export function PayPalConnect({ engagementId, connected, disabled, verifyOnLoad=false }: {
  engagementId: string; connected: boolean; disabled: boolean; verifyOnLoad?:boolean;
}) {
  const router=useRouter();
  const [checking,setChecking]=useState(false);
  const [verified,setVerified]=useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);

  useEffect(()=>{
    if(disabled || connected || verified || (!opened && !verifyOnLoad))return;
    let disposed=false,running=false,attempts=0,lateFocusChecked=false;
    let timer:ReturnType<typeof setTimeout>;
    async function check(){
      if(disposed || running || attempts>=12)return;
      clearTimeout(timer);running=true;attempts++;setChecking(true);
      try {
        const form=new FormData();form.set("id",engagementId);
        const result=await checkPayPalSellerConnection(form);
        if(disposed)return;
        if(result.connected){setError("");setVerified(true);router.refresh();return;}
        if(result.error){setError(result.error);return;}
        if(attempts<12)timer=setTimeout(check,5000);
        else setError("PayPal has not confirmed this connection yet. Finish setup, then select Refresh connection.");
      }catch{
        if(!disposed)setError("Could not verify the PayPal connection. Select Refresh connection to try again.");
      }finally{running=false;if(!disposed)setChecking(false);}
    }
    void check();
    const focus=()=>{
      // Onboarding may take longer than the polling window. Check once more
      // when the person eventually returns, without starting another loop.
      if(attempts>=12){if(lateFocusChecked)return;lateFocusChecked=true;attempts=11;}
      void check();
    };window.addEventListener("focus",focus);
    return ()=>{disposed=true;clearTimeout(timer);window.removeEventListener("focus",focus);};
  },[engagementId,connected,verified,disabled,opened,verifyOnLoad,router]);

  async function connect() {
    setError("");
    setOpened(false);
    setVerified(false);
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
      {pending ? "Opening PayPal…" : (connected || verified) ? "Reconnect PayPal sandbox" : "Connect PayPal sandbox"}
    </Button>
    {error && <p role="alert" className="notice text-sm mt-3">{error}</p>}
    {(opened || checking || verified) && <p role="status" className="muted text-sm mt-3">{connected || verified?"PayPal sandbox connection verified.":checking?"Checking PayPal connection…":"Finish connecting in the PayPal window. We’ll check your connection automatically when you return."}</p>}
  </div>;
}
