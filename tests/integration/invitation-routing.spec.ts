import {test,expect} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID,randomBytes} from "node:crypto";
import fs from "node:fs";
import {cleanupIntegrationRun} from "../../scripts/integration-fixtures.mjs";

test("existing invitees sign in or join directly; profile fields follow account context",async({browser})=>{
 const run=randomUUID(),password=randomBytes(24).toString("base64url")+"aA1!";
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
 const service=createClient(url,process.env.SUPABASE_SECRET_KEY!,options);
 fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
 const context=await browser.newContext();
 async function fixture(role:string){
  const email=`workspace-e2e-${run}-${role}@example.test`;
  const generated=await service.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:role}}});
  if(generated.error)throw generated.error;
  const db=createClient(url,key,options);
  const verified=await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties.hashed_token});
  expect(verified.error).toBeNull();return {email,db,id:verified.data.user!.id};
 }
 try{
  const client=await fixture("client"),pro=await fixture("professional");
  async function invitation(title:string){
   const e=await client.db.rpc("create_engagement",{p_title:`[E2E] ${title} ${run}`,p_role:"client"});expect(e.error).toBeNull();
   const invite=await client.db.rpc("create_invitation",{e:e.data,target_email:pro.email});expect(invite.error).toBeNull();return {id:e.data,token:invite.data};
  }
  const first=await invitation("Invitation routing");const page=await context.newPage();
  await page.goto(`/invite/${first.token}`);
  await expect(page).toHaveURL(new RegExp(`mode=login&invitation=${first.token}`));
  await expect(page.getByRole("heading",{name:"Welcome back"})).toBeVisible();
  await expect(page.getByLabel("Confirm password")).toHaveCount(0);
  await page.goto(`/login?mode=signup&invitation=${first.token}`);
  await expect(page).toHaveURL(new RegExp(`mode=login&invitation=${first.token}`));
  await page.getByLabel("Password",{exact:true}).fill(password);
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await expect(page).toHaveURL(`http://127.0.0.1:3200/workspace/${first.id}`);
  const second=await invitation("Signed in invitation");
  await page.goto(`/invite/${second.token}`);
  await expect(page).toHaveURL(`http://127.0.0.1:3200/workspace/${second.id}`);
  await page.goto("/profile");
  await expect(page.getByLabel("Professional hourly rate (USD)")).toBeVisible();
  await page.getByLabel("Display name").fill("Routing Professional");
  await page.getByLabel("Public description").fill("Professional details retained");
  await page.getByLabel("Skills and services",{exact:false}).fill("Testing");
  await page.getByRole("button",{name:"Save profile",exact:true}).click();
  await expect(page.getByText("Saved.",{exact:true})).toBeVisible();
  const signed=await pro.db.auth.signInWithPassword({email:pro.email,password});expect(signed.error).toBeNull();
  expect((await pro.db.rpc("set_active_role",{next_role:"client"})).error).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading",{name:"Account context: Client"})).toBeVisible();
  await expect(page.getByLabel("Professional hourly rate (USD)")).toHaveCount(0);
  await expect(page.getByLabel("Public description")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByLabel("Display name").fill("Routing Participant");
  await page.getByRole("button",{name:"Save profile",exact:true}).click();
  await expect(page.getByText("Saved.",{exact:true})).toBeVisible();
  const anon=createClient(url,key,options);const publicProfile=await anon.rpc("public_profile",{p:pro.id});expect(publicProfile.error).toBeNull();
  expect(publicProfile.data.bio).toBe("Professional details retained");expect(publicProfile.data.displayName).toBe("Routing Participant");
 }finally{await context.close();await cleanupIntegrationRun(run,service);}
});
