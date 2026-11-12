"use client";
import {useEffect,useRef} from "react";
import {ActionForm,ActionSubmitButton} from "@/components/action-form";

// Use the existing POST action, including its error UI; opening a link never
// changes membership during server rendering or link prefetch.
export function AcceptInvitation({token}:{token:string}) {
  const anchor=useRef<HTMLSpanElement>(null);
  const sent=useRef(false);
  useEffect(()=>{
    if(sent.current)return;
    sent.current=true;
    anchor.current?.closest("form")?.requestSubmit();
  },[]);
  return <ActionForm actionName="accept">
    <span ref={anchor}/><input type="hidden" name="token" value={token}/>
    <ActionSubmitButton pendingLabel="Joining engagement…">Join engagement</ActionSubmitButton>
  </ActionForm>;
}
