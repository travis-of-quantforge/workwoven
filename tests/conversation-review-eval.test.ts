import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { cleanupIntegrationRun } from "../scripts/integration-fixtures.mjs";
import { northstarDesign, northstarBrief } from "./fixtures/northstar-brief";
vi.mock("server-only",()=>({}));
import { processQueuedAssessment } from "../src/lib/ai/scope-monitor";
import { conversationReviewSchema } from "../src/lib/ai/conversation-checks";

// Opt-in only: real provider calls use normal reservations/metering/settlement,
// exclusively with labelled, disposable fixture users, files and engagements.
it.skipIf(process.env.RUN_CONVERSATION_REVIEW_EVAL!=="1")("live labelled review: cross-file CTA ambiguity then explicit client clarification",async()=>{
 const run=randomUUID(),password=randomUUID()+"aA1!",email=`workspace-e2e-${run}-review@example.test`;
 const opts={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,opts);
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,opts);
 mkdirSync(".integration-runs",{recursive:true});writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
 try {
  const user=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{workspace_test_run:run,profile_type:"client"}});
  if(user.error)throw Error("Evaluation user setup failed");
  expect((await db.auth.signInWithPassword({email,password})).error).toBeNull();
  const created=await db.rpc("create_engagement",{p_title:`[E2E] Brief review eval ${run}`});expect(created.error).toBeNull();const e=created.data;
  expect((await db.rpc("post_discussion_message",{e,v:"shared",b:"I would like the website described in the two documents I am supplying. Can you build this?"})).error).toBeNull();
  const paths:string[]=[];
  for(const [name,content] of [["design.txt",northstarDesign],["brief.txt",northstarBrief]]){
   const bytes=Buffer.from(content);
   const reg=await db.rpc("register_attachment",{e,v:"shared",n:name,mime:"text/plain",bytes:bytes.length});expect(reg.error).toBeNull();paths.push(reg.data);
   expect((await db.storage.from("engagement-files").upload(reg.data,bytes,{contentType:"text/plain"})).error).toBeNull();
  }
  const sent=await db.rpc("confirm_attachments_with_message",{paths,b:"Please see the attached website brief and design notes.",parent:null,mentions:[]});expect(sent.error).toBeNull();
  for(let i=0;i<paths.length;i++){
   const content=i===0?northstarDesign:northstarBrief;
   expect((await admin.rpc("store_attachment_text",{p:paths[i],actor:user.data.user!.id,body:content,hash:createHash("sha256").update(content).digest("hex"),is_complete:true})).error).toBeNull();
  }
  const files=await db.from("attachments").select("id").in("object_path",paths);expect(files.error).toBeNull();
  async function assess(label:string){
   await processQueuedAssessment(e);
   const result=await db.from("message_assessments").select("id,status,reason,result,charge_nano,operation_id,review_snapshot").eq("engagement_id",e).order("created_at",{ascending:false}).limit(1).single();
   expect(result.error).toBeNull();
   expect(["checked","flagged"],`${label}: ${result.data?.status}/${result.data?.reason}`).toContain(result.data?.status);
   const review=conversationReviewSchema.parse(result.data!.result.review);
   const sourceRefs=result.data!.review_snapshot.sources.map((s:{ref:string})=>s.ref);
   for(const f of files.data || [])expect(sourceRefs).toContain(`attachment:${f.id}`);
   expect(result.data?.operation_id).toBeTruthy();
   console.log(JSON.stringify({label,status:result.data!.status,chargeNano:result.data!.charge_nano,summary:review.summary,findings:review.findings.map(f=>({categories:f.categories,actionable:f.actionable,status:f.status,explanation:f.explanation,nextStep:f.nextStep,sourceKinds:f.references.map(r=>r.ref.split(":")[0])}))}));
   return review;
  }
  const initial=await assess("initial ambiguous client documents");
  const ambiguity=initial.findings.filter(f=>f.actionable && f.categories.includes("ambiguity"));
  expect(ambiguity).toHaveLength(1);
  const refs=new Set(ambiguity[0].references.map(r=>r.ref));
  for(const file of files.data || [])expect(refs).toContain(`attachment:${file.id}`);
  expect(ambiguity[0].explanation+ambiguity[0].nextStep).toMatch(/button|consultation|contact/i);
  expect(initial.findings.some(f=>f.actionable && f.categories.includes("unanswered_question"))).toBe(false);
  expect((await db.rpc("post_discussion_message",{e,v:"shared",b:"To clarify: the 'Book a consultation' button should link to our Contact page only. There is no appointment scheduler, booking calendar or booking workflow in this release."})).error).toBeNull();
  const clarified=await assess("explicit client clarification, still no professional response");
  expect(clarified.findings.some(f=>f.actionable)).toBe(false);
  expect(clarified.findings.some(f=>f.status==="resolved" && f.categories.includes("ambiguity"))).toBe(true);
 }finally{await cleanupIntegrationRun(run,admin);}
},240000);
