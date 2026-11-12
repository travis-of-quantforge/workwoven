import {test,expect} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID,randomBytes} from "node:crypto";
import fs from "node:fs";
import {cleanupIntegrationRun} from "../../scripts/integration-fixtures.mjs";

test("retry failed conversation check and copy message ID",async({browser})=>{
 const run=randomUUID(),password=randomBytes(24).toString("base64url")+"aA1!";
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
 const service=createClient(url,process.env.SUPABASE_SECRET_KEY!,options);
 fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
 const context=await browser.newContext({permissions:["clipboard-read","clipboard-write"]});
 try{
  const email=`workspace-e2e-${run}-retry@example.test`;
  const generated=await service.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:"client"}}});
  if(generated.error)throw generated.error;
  const db=createClient(url,key,options);
  expect((await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties.hashed_token})).error).toBeNull();
  const created=await db.rpc("create_engagement",{p_title:`[E2E] Retry ${run}`,p_role:"client"});expect(created.error).toBeNull();
  const e=created.data;
  const msg=await db.rpc("post_discussion_message",{e,v:"shared",b:"Please review the website brief."});expect(msg.error).toBeNull();
  const job=await service.from("message_assessments").select("id").eq("message_id",msg.data).single();expect(job.error).toBeNull();
  expect((await service.rpc("fail_unclaimed_message_assessment",{j:job.data!.id,why:"ai_unavailable"})).error).toBeNull();
  const page=await context.newPage();await page.goto("/login");
  await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page).toHaveURL("http://127.0.0.1:3200/");await page.goto(`/workspace/${e}`);
  const message=page.locator(`#message-${msg.data}`);
  await message.getByRole("button",{name:"Copy message ID",exact:true}).click();
  await expect(message.getByRole("button",{name:"Copied",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(msg.data);
  await message.getByRole("button",{name:"Why copy a message ID?",exact:true}).hover();
  await expect(page.getByRole("tooltip")).toContainText("unique ID to your clipboard");
  await message.locator("summary").filter({hasText:"Conversation check"}).click();
  await message.getByRole("button",{name:"Retry check",exact:true}).click();
  await expect.poll(async()=>{const rows=await db.from("message_assessments").select("id").eq("retry_message_id",msg.data);return rows.data?.length;}).toBe(1);
  await expect.poll(async()=>{const rows=await db.from("message_assessments").select("status").eq("retry_message_id",msg.data).single();return rows.data?.status;}).toBe("skipped");
  expect((await db.from("message_assessments").select("status,reason").eq("id",job.data!.id).single()).data).toMatchObject({status:"skipped",reason:"ai_unavailable"});
  await page.reload();
  await message.locator("summary").filter({hasText:"Conversation check"}).click();
  await expect(message.locator("time").filter({hasText:"Last attempt"})).toContainText("UTC");

 }finally{await context.close();await cleanupIntegrationRun(run,service);}
});
