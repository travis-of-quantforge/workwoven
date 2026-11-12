import {test,expect} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID,randomBytes} from "node:crypto";
import fs from "node:fs";
import {cleanupIntegrationRun} from "../../scripts/integration-fixtures.mjs";
test("sending scrolls discussion to bottom and cached checks show the actual result",async({browser})=>{
 const run=randomUUID(),password=randomBytes(24).toString("base64url")+"aA1!";
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
 const service=createClient(url,process.env.SUPABASE_SECRET_KEY!,options);
 fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
 const context=await browser.newContext();
 try{
  const email=`workspace-e2e-${run}-scroll@example.test`;
  const generated=await service.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:"client"}}});if(generated.error)throw generated.error;
  const db=createClient(url,key,options);const verified=await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties.hashed_token});expect(verified.error).toBeNull();const u=verified.data.user!.id;
  const created=await db.rpc("create_engagement",{p_title:`[E2E] Send scroll ${run}`,p_role:"client"});expect(created.error).toBeNull();const e=created.data;
  expect((await service.from("messages").insert(Array.from({length:30},(_,i)=>({engagement_id:e,author_id:u,visibility:"shared",kind:"human",channel:"discussion",body:`History ${i}: A long project message about the website requirements and the agreed delivery.\nKeep the earlier decisions available while reading.`,created_at:new Date(Date.now()-60000+i*1000).toISOString()})))).error).toBeNull();
  const page=await context.newPage();await page.goto("/login");await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL("http://127.0.0.1:3200/");await page.goto(`/workspace/${e}`);
  const chat=page.getByRole("region",{name:"Discussion messages",exact:true});await expect.poll(()=>chat.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
  await chat.evaluate(el=>{el.scrollTop=100;el.dispatchEvent(new Event("scroll"));});await page.reload();await expect.poll(()=>chat.evaluate(el=>el.scrollTop)).toBeCloseTo(100,0);
  expect((await service.from("messages").insert({engagement_id:e,author_id:u,visibility:"shared",kind:"agent",channel:"discussion",body:"An incoming agent message keeps the reading position."})).error).toBeNull();
  await expect(chat.getByText("An incoming agent message keeps the reading position.",{exact:true})).toHaveCount(1);await expect.poll(()=>chat.evaluate(el=>el.scrollTop)).toBeCloseTo(100,0);
  await page.getByRole("textbox",{name:"Message",exact:true}).fill("My own new message");await page.getByRole("textbox",{name:"Message",exact:true}).press("Control+Enter");await expect(chat.getByText("My own new message",{exact:true})).toBeVisible();await expect.poll(()=>chat.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
  const newest=await db.from("messages").select("id").eq("engagement_id",e).eq("body","My own new message").single();expect(newest.error).toBeNull();
  expect((await service.from("message_assessments").update({status:"checked",reason:"unchanged_context",result:{summary:"The available brief leaves responsibility for images unclear.",isRequest:true,issues:[]}}).eq("message_id",newest.data!.id)).error).toBeNull();await page.reload();
  const message=page.locator(`#message-${newest.data!.id}`);await message.locator("summary").filter({hasText:"Conversation check"}).click();await expect(message.getByText("The available brief leaves responsibility for images unclear.",{exact:true})).toBeVisible();await expect(message).not.toContainText("Automatic checks use shared AI tokens");await expect(message).not.toContainText("no request identified");
 }finally{await context.close();await cleanupIntegrationRun(run,service);}
});
