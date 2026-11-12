import {test,expect} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID,randomBytes} from "node:crypto";
import fs from "node:fs";
import {cleanupIntegrationRun} from "../../scripts/integration-fixtures.mjs";

test("multiple files share one discussion message, with or without text",async({browser})=>{
 const run=randomUUID(),password=randomBytes(24).toString("base64url")+"aA1!";
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
 const service=createClient(url,process.env.SUPABASE_SECRET_KEY!,options);
 fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
 const context=await browser.newContext();
 try{
  const email=`workspace-e2e-${run}-files@example.test`;
  const generated=await service.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:"client"}}});
  if(generated.error)throw generated.error;
  const db=createClient(url,key,options);
  expect((await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties.hashed_token})).error).toBeNull();
  const created=await db.rpc("create_engagement",{p_title:`[E2E] Multi files ${run}`,p_role:"client"});expect(created.error).toBeNull();
  const e=created.data;
  const page=await context.newPage();await page.goto("/login");
  await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page).toHaveURL("http://127.0.0.1:3200/");await page.goto(`/workspace/${e}`);
  const picker=page.locator("#message-file");
  const files=[{name:"one.txt",mimeType:"text/plain",buffer:Buffer.from("First file")},{name:"two.csv",mimeType:"text/csv",buffer:Buffer.from("a,b\n1,2")},{name:"remove.txt",mimeType:"text/plain",buffer:Buffer.from("Remove me")}];
  await picker.setInputFiles(files);
  await page.getByRole("button",{name:"Remove attachment remove.txt",exact:true}).click();
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"Saved."})).toBeVisible();
  let records=await db.from("attachments").select("name,source_message_id,upload_status").eq("engagement_id",e);
  expect(records.error).toBeNull();expect(records.data).toHaveLength(2);expect(new Set(records.data!.map(a=>a.source_message_id)).size).toBe(1);
  const message=await db.from("messages").select("body").eq("id",records.data![0].source_message_id).single();expect(message.data!.body).toContain("Attached files:");
  const beforeDownload=page.url();
  const received=page.waitForEvent("download");
  await page.getByRole("link",{name:"Download attachment: one.txt",exact:true}).click();
  const download=await received;expect(download.suggestedFilename()).toBe("one.txt");expect(await download.failure()).toBeNull();expect(page.url()).toBe(beforeDownload);

  await expect(page.getByRole("button",{name:"Remove attachment one.txt",exact:true})).toHaveCount(0);
  await picker.setInputFiles(files.slice(0,2));await page.getByLabel("Message",{exact:true}).fill("Both files with explanation");
  await page.getByRole("button",{name:"Send message",exact:true}).click();
  await expect(page.getByText("Both files with explanation",{exact:true})).toBeVisible();
  records=await db.from("attachments").select("name,source_message_id,upload_status").eq("engagement_id",e);
  expect(records.data).toHaveLength(4);expect(new Set(records.data!.map(a=>a.source_message_id)).size).toBe(2);
  expect(records.data!.every(a=>a.upload_status==="ready")).toBe(true);
  expect((await db.from("messages").select("id").eq("engagement_id",e).eq("kind","human")).data).toHaveLength(2);
  const ids=[...new Set(records.data!.map(a=>a.source_message_id))];
  expect((await service.from("message_assessments").update({status:"checked",result:{verdict:"no_issue",summary:"No concerns found.",isRequest:false,issues:[]}}).eq("message_id",ids[0])).error).toBeNull();
  expect((await service.from("message_assessments").update({status:"flagged",result:{verdict:"potential_conflict",summary:"A documented scope conflict needs review.",isRequest:true,issues:[{}]}}).eq("message_id",ids[1])).error).toBeNull();
  await page.reload();
  await expect(page.locator(`#message-${ids[0]} details`).filter({hasText:"Conversation check"})).toHaveClass(/bg-emerald-50/);
  await expect(page.locator(`#message-${ids[1]} details`).filter({hasText:"Conversation check"})).toHaveClass(/bg-red-50/);
  expect((await service.from("message_assessments").update({status:"checked",result:{verdict:"needs_clarification",summary:"Please clarify the wording.",isRequest:true,issues:[]}}).eq("message_id",ids[0])).error).toBeNull();
  await page.reload();
  await expect(page.locator(`#message-${ids[0]} details`).filter({hasText:"Conversation check"})).toHaveClass(/bg-amber-50/);

 }finally{await context.close();await cleanupIntegrationRun(run,service);}
});
