import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("assessment details and controls stay on their source; historical duplicate posts are hidden",async({page})=>{
 const run=randomUUID(),password=randomUUID()+"aA1!",email=`workspace-e2e-${run}-assessment@example.test`;
 const opts={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,opts);
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,opts);
 fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
 try{
  const generated=await admin.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:"client"}}});if(generated.error || !generated.data.properties)throw Error("Fixture generation failed");
  const auth=await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties.hashed_token});expect(auth.error).toBeNull();const user=auth.data.user!;
  const project=await db.rpc("create_engagement",{p_title:`[E2E] Assessment placement ${run}`});expect(project.error).toBeNull();const e=project.data;
  const text="Please clarify what Book a consultation should do.";
  const source=await db.rpc("post_discussion_message",{e,v:"shared",b:text});expect(source.error).toBeNull();
  const job=await admin.from("message_assessments").select("id").eq("message_id",source.data).single();expect(job.error).toBeNull();
  const finding={existingId:null,actionable:true,subject:"Button destination",reopenReason:null,categories:["ambiguity"],explanation:"The button destination is ambiguous.",nextStep:"Should it link to Contact only?",references:[{ref:`message:${source.data}`,version:"1",quote:"Book a consultation"}],status:"awaiting_clarification",reminderReason:null,questionRef:null,respondent:"client",resolutionReferences:[]};
  const record=await admin.from("conversation_findings").insert({engagement_id:e,issue_key:createHash("md5").update(`${finding.references[0].ref}:${finding.subject}`).digest("hex"),categories:finding.categories,explanation:finding.explanation,next_step:finding.nextStep,evidence:finding.references,resolution_evidence:[],status:finding.status,assessment_id:job.data!.id}).select("id").single();expect(record.error).toBeNull();
  const old=await admin.from("messages").insert({engagement_id:e,author_id:user.id,visibility:"shared",kind:"agent",body:"Legacy duplicated assessment post"}).select("id").single();expect(old.error).toBeNull();
  expect((await admin.from("message_assessments").update({status:"flagged",notice_message_id:old.data!.id,finished_at:new Date().toISOString(),result:{summary:"Clarify the button.",isRequest:true,issues:[],review:{summary:"Clarify the button.",coverage:"complete",findings:[finding]}}}).eq("id",job.data!.id)).error).toBeNull();
  expect((await admin.from("messages").insert({engagement_id:e,author_id:user.id,visibility:"shared",kind:"agent",channel:"agent",body:"Ordinary project-agent reply is retained."})).error).toBeNull();
  await page.goto("/login");await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL("http://127.0.0.1:3200/");
  await page.goto(`/workspace/${e}`);
  await expect(page.getByText("Legacy duplicated assessment post",{exact:true})).toHaveCount(0);
  const original=page.locator(`article#message-${source.data}`);
  await original.locator("summary").filter({hasText:"Review needed"}).click();
  await expect(original.getByText(finding.explanation,{exact:true})).toBeVisible();
  await expect(original.getByRole("button",{name:"Mark resolved",exact:true})).toBeVisible();
  // A later automatic review updates the lifecycle row, not the old receipt.
  const clarification=await db.rpc("post_discussion_message",{e,v:"shared",b:"Confirmed: the button links only to Contact. No booking flow."});expect(clarification.error).toBeNull();
  const later=await admin.from("message_assessments").select("id").eq("message_id",clarification.data).single();expect(later.error).toBeNull();
  expect((await admin.from("conversation_findings").update({status:"resolved",assessment_id:later.data!.id,resolution_evidence:[{ref:`message:${clarification.data}`,version:"1",quote:"links only to Contact"}],marked_by:null,updated_at:new Date().toISOString()}).eq("id",record.data!.id)).error).toBeNull();
  await expect(original.locator("details").first()).toHaveClass(/bg-emerald-50/);
  await expect(original.locator("summary").first()).toContainText("Concerns resolved");
  await expect(original.getByText("Original assessment",{exact:true})).toBeVisible();
  const retained=await admin.from("message_assessments").select("status,result").eq("id",job.data!.id).single();
  expect(retained.data!.status).toBe("flagged");expect(retained.data!.result.summary).toBe("Clarify the button.");
  // A materially reopened lifecycle must show a warning again, then allow the
  // existing participant resolution action without changing any commitments.
  expect((await admin.from("conversation_findings").update({status:"awaiting_clarification",updated_at:new Date().toISOString()}).eq("id",record.data!.id)).error).toBeNull();
  await expect(original.locator("details").first()).toHaveClass(/bg-amber-50/);
  await original.getByRole("button",{name:"Mark resolved",exact:true}).click();
  await expect(original.getByText("resolved",{exact:true})).toBeVisible();
  await expect(original.locator("summary").first()).toContainText("Concerns resolved");
  await page.goto(`/workspace/${e}?tab=discussion&context=project`);
  await expect(page.getByText("Ordinary project-agent reply is retained.",{exact:true})).toBeVisible();
  await page.goto(`/workspace/${e}?tab=discussion&message=${old.data!.id}`);
  await expect(page).toHaveURL(new RegExp(`message=${source.data}`));
 }finally{await cleanupIntegrationRun(run,admin);}
});
