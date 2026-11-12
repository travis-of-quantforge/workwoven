"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

export function MessageAttachmentPicker({agentChat=false,disabled=false,onFilesChange,onFilesSelected}:{agentChat?:boolean;disabled?:boolean;onFilesChange?:(count:number)=>void;onFilesSelected?:()=>void}={}) {
  const inputId=useId();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error,setError]=useState("");
  useEffect(() => {
    const form = input.current?.form;
    if (!form) return;
    const clear = () => {setFiles([]);setError("");onFilesChange?.(0);};
    form.addEventListener("reset", clear);
    return () => form.removeEventListener("reset", clear);
  }, [onFilesChange]);
  useEffect(()=>{
    const body=input.current?.form?.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    if(body)body.required=files.length===0;
  },[files]);
  function select(next:File[]){
    if(next.length>10 || next.reduce((sum,file)=>sum+file.size,0)>20971520){
      setError("Attach up to 10 files totalling 20 MB or less.");
      const retained=new DataTransfer();for(const file of files)retained.items.add(file);
      if(input.current)input.current.files=retained.files;
      return;
    }
    const transfer=new DataTransfer();for(const file of next)transfer.items.add(file);
    if(input.current)input.current.files=transfer.files;
    setFiles(next);setError("");onFilesChange?.(next.length);onFilesSelected?.();
  }
  return <div className="border-y border-slate-200 py-2 my-3">
    <div className="flex flex-wrap min-w-0 items-center gap-2">
      <button type="button" disabled={disabled} className="inline-flex items-center rounded-md border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700" aria-label="Attach a file" title="Attach files" onClick={()=>input.current?.click()}><Paperclip size={16} aria-hidden="true"/></button>
      <input ref={input} id={agentChat?inputId:"message-file"} disabled={disabled} type="file" name="file" multiple accept={agentChat?".txt,.csv":".txt,.csv,.pdf,.png,.jpg,.jpeg"} className="sr-only" tabIndex={-1} onChange={event=>select(Array.from(event.target.files || []))}/>
      {files.map((file,i)=><span key={`${file.name}-${i}`} className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs"><span className="truncate" title={file.name}>{file.name}</span><button type="button" disabled={disabled} className="rounded p-1 text-slate-600 hover:bg-slate-100" aria-label={`Remove attachment ${file.name}`} onClick={()=>select(files.filter((_,j)=>i!==j))}><X size={14} aria-hidden="true"/></button></span>)}
    </div>
    {error && <p role="alert" className="notice text-xs mt-2">{error}</p>}
  </div>;
}
