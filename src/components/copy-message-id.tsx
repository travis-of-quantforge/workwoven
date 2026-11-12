"use client";
import {useState} from "react";
export function CopyMessageId({id}:{id:string}){
 const [status,setStatus]=useState("");
 return <span className="inline-flex items-center gap-1"><button type="button" className="muted text-xs underline" onClick={async()=>{
  try{await navigator.clipboard.writeText(id);setStatus("Copied");}catch{setStatus("Copy failed. Please try again.");}
 }} onBlur={()=>setStatus("")}>{status==="Copied"?"Copied":"Copy message ID"}</button><span role="status" className="text-xs">{status!=="Copied"?status:""}</span></span>;
}
