import {test,expect,type BrowserContext} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID,randomBytes} from "node:crypto";
import fs from "node:fs";
import {cleanupIntegrationRun} from "../../scripts/integration-fixtures.mjs";

test("agent chats upload readable files with isolated visibility and populate detailed milestone drafts",async({browser})=>{
 test.skip(process.env.TEST_MILESTONE_GENERATION!=="mock","Explicit mocked AI mode required");
 test.setTimeout(180000);
 const run=randomUUID(),password=randomBytes(24).toString("base64url")+"aA1!";
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,options);
 const contexts:BrowserContext[]=[];
 fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
 try{
 const email=`workspace-e2e-${run}-professional@example.test`;
 const generated=await service.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:"professional"}}});
 if(generated.error)throw generated.error;
 const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,options);
 const verified=await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties.hashed_token});
 if(verified.error)throw verified.error;
 const created=await db.rpc("create_engagement",{p_title:`[E2E] Agent uploads ${run}`,p_role:"professional"});
 expect(created.error).toBeNull();const e=created.data;
 const account=await service.from("agent_accounts").select("id").eq("engagement_id",e).eq("visibility","professional").single();
 expect((await service.rpc("admin_adjust_credits",{a:account.data!.id,actor:verified.data.user!.id,k:randomUUID(),delta:1000000000,why:"Synthetic file-chat fixture"})).error).toBeNull();
 const context=await browser.newContext();contexts.push(context);const page=await context.newPage();
 await page.goto("/login");await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL("http://127.0.0.1:3200/");
 let calls=0;
 await page.route("**/api/agents",async route=>{
  const input=route.request().postDataJSON();calls++;
  if(input.mode==="milestones"){
   await route.fulfill({json:{status:"succeeded",result:{answer:"Synthetic detailed milestone proposal",kind:"milestones",citations:[],questions:[],proposal:null,summary:null,milestones:[{description:"Build Home, Services and Contact. [Sources: attachment:synthetic v1]",acceptanceCriteria:"Required form fields are validated. A test enquiry reaches the confirmed inbox and shows a success message.",responsibilities:"Client supplies final logo, content, images and the recipient email."}]}}});return;
  }
  expect(input.attachmentMessageId).toMatch(/^[0-9a-f-]{36}$/);
  const files=await db.from("attachments").select("id,visibility,extraction_status,source_message_id").eq("source_message_id",input.attachmentMessageId);
  expect(files.error).toBeNull();expect(files.data).toHaveLength(2);
  expect(files.data!.every(file=>file.visibility===input.visibility && file.extraction_status==="ready")).toBe(true);
  const retrieved=await db.rpc("agent_chat_context",{e,v:input.visibility});expect(retrieved.error).toBeNull();expect(JSON.stringify(retrieved.data)).toContain(input.visibility==="shared"?"SHARED FILE CONTENT":"PRIVATE FILE CONTENT");
  if(input.visibility==="shared")expect(JSON.stringify(retrieved.data)).not.toContain("PRIVATE FILE CONTENT");
  const reply="Synthetic file-aware reply";
  expect((await service.from("messages").insert({engagement_id:e,author_id:verified.data.user!.id,visibility:input.visibility,kind:"agent",channel:"agent",body:reply})).error).toBeNull();
  await route.fulfill({contentType:"application/x-ndjson",body:JSON.stringify({type:"run",runId:randomUUID()})+"\n"+JSON.stringify({type:"result",status:"succeeded",result:{answer:reply,kind:"advice",citations:[],questions:[],proposal:null,summary:null}})+"\n"});
 });
 for(const visibility of ["professional","shared"]){
  await page.goto(`/workspace/${e}?tab=discussion&context=${visibility==="shared"?"project":"private"}`);
  await page.getByRole("button",{name:"Attach a file",exact:true}).click();
  await page.locator('input[type="file"]').setInputFiles([1,2].map(n=>({name:`${visibility}-${n}.txt`,mimeType:"text/plain",buffer:Buffer.from(`${visibility==="shared"?"SHARED":"PRIVATE"} FILE CONTENT ${n}`)})));
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await expect(page.getByText("Synthetic file-aware reply",{exact:true})).toBeVisible();
  await expect(page.locator('textarea[id^="agent-question-"]')).toHaveValue("");
  await expect(page.getByRole("link",{name:`Download attachment: ${visibility}-1.txt`,exact:true})).toBeVisible();
 }
 await page.getByRole("button",{name:"Propose milestones",exact:true}).click();
 const modal=page.getByRole("dialog",{name:"Propose milestones"});
 await modal.getByRole("button",{name:"Create milestones from discussion",exact:true}).click();
 await expect(modal.getByLabel("Description",{exact:true})).toHaveValue("Build Home, Services and Contact.");
 await expect(modal.getByLabel("Acceptance criteria",{exact:true})).toHaveValue(/test enquiry reaches the confirmed inbox/);
 await expect(modal.getByLabel("Client responsibilities (optional)")).toHaveValue(/final logo/);
 expect(calls).toBe(3);
 }finally{for(const context of contexts)await context.close();await cleanupIntegrationRun(run,service);}
});
