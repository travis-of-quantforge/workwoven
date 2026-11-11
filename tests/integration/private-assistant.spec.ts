import { test, expect, type BrowserContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("private assistant uses the central scrollable chat without exposing it to the counterpart", async ({ browser }) => {
  test.skip(process.env.TEST_MILESTONE_GENERATION !== "mock", "Explicit browser-mocked AI mode required");
  test.setTimeout(180000);
  const run = randomUUID(), password = randomBytes(24).toString("base64url") + "aA1!";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, process.env.SUPABASE_SECRET_KEY!, options);
  const contexts: BrowserContext[] = [];
  fs.mkdirSync(".integration-runs", { recursive: true });
  fs.writeFileSync(`.integration-runs/${run}.json`, JSON.stringify({ run }));
  try {
    async function actor(role: string) {
      const email = `workspace-e2e-${run}-${role}@example.test`;
      const generated = await service.auth.admin.generateLink({ type:"signup", email, password, options:{data:{workspace_test_run:run, profile_type:role}} });
      if (generated.error) throw Error("Fixture signup failed");
      const db = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, options);
      const verified = await db.auth.verifyOtp({type:"signup", token_hash:generated.data.properties.hashed_token});
      if (verified.error) throw Error("Fixture verification failed");
      const context = await browser.newContext(); contexts.push(context);
      const page = await context.newPage(); await page.goto("/login");
      await page.getByLabel("Email", {exact:true}).fill(email);
      await page.getByLabel("Password", {exact:true}).fill(password);
      await page.getByRole("button", {name:"Sign in",exact:true}).click();
      await expect(page).toHaveURL("http://127.0.0.1:3200/");
      return {db,page,email,user:verified.data.user!};
    }
    const pro = await actor("professional"), client = await actor("client");
    const created = await pro.db.rpc("create_engagement", {p_title:`[E2E] Private assistant ${run}`,p_role:"professional"});
    expect(created.error).toBeNull(); const e = created.data;
    const invite = await pro.db.rpc("create_invitation", {e,target_email:client.email});
    expect((await client.db.rpc("accept_invitation", {t:invite.data})).error).toBeNull();
    expect((await service.from("messages").insert(Array.from({length:25},(_,i)=>({engagement_id:e,author_id:pro.user.id,visibility:"professional",kind:"human",channel:"discussion",body:`Private historical note ${i}: delivery estimates and internal planning for the dashboard.\nThese notes must stay private and visible in this chat.`})))).error).toBeNull();
    await pro.page.goto(`/workspace/${e}?tab=discussion&context=private`);
    const chat = pro.page.getByRole("region", {name:"Private assistant messages",exact:true});
    await expect(chat).toBeVisible();
    await expect(pro.page.getByLabel("Help with",{exact:true})).toHaveCount(0);
    await expect(pro.page.getByLabel("Selected content",{exact:true})).toHaveCount(0);
    await expect(pro.page.getByRole("link",{name:"Your private assistant",exact:true}).locator("svg")).toHaveCount(0);
    await expect(pro.page.getByRole("button",{name:"Send",exact:true})).toBeDisabled();
    const account = await service.from("agent_accounts").select("id").eq("engagement_id",e).eq("visibility","professional").single();
    expect((await service.rpc("admin_adjust_credits",{a:account.data!.id,actor:pro.user.id,k:randomUUID(),delta:1000000000,why:"Synthetic private-chat browser fixture"})).error).toBeNull();
    await pro.page.reload();
    await expect.poll(()=>chat.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop)).toBeLessThan(3);
    await chat.evaluate(el=>{el.scrollTop=100;el.dispatchEvent(new Event("scroll"));});
    let calls = 0;
    await pro.page.route("**/api/agents", async route => {
      calls++;
      const request = route.request().postDataJSON();
      expect(request.engagementId).toBe(e); expect(request.visibility).toBe("professional"); expect(request.mode).toBe("advice");
      if(calls===1) { await route.fulfill({status:503,json:{error:"Synthetic retryable failure"}}); return; }
      const answer="PRIVATE synthetic assistant reply: clarify the CSV format before estimating.";
      expect((await service.from("messages").insert([
        {engagement_id:e,author_id:pro.user.id,visibility:"professional",kind:"human",channel:"agent",body:request.question},
        {engagement_id:e,author_id:pro.user.id,visibility:"professional",kind:"agent",channel:"agent",body:answer},
      ])).error).toBeNull();
      await route.fulfill({status:200,contentType:"application/x-ndjson",body:JSON.stringify({type:"result",status:"succeeded",result:{answer,kind:"advice",citations:[],questions:[],proposal:null,summary:null}})+"\n"});
    });
    const input=pro.page.getByRole("textbox",{name:"Message your private assistant",exact:true});
    await input.fill("PRIVATE synthetic question: help assess the dashboard estimate.");
    await pro.page.getByRole("button",{name:"Send",exact:true}).click();
    await expect(pro.page.getByRole("alert").filter({hasText:"Synthetic retryable failure"})).toBeVisible();
    await expect(input).not.toHaveValue("");
    await pro.page.getByRole("button",{name:"Send",exact:true}).click();
    await expect(chat.getByText(/^PRIVATE synthetic assistant reply:/)).toHaveCount(1);
    await expect(input).toHaveValue("");
    await expect.poll(()=>chat.evaluate(el=>el.scrollTop)).toBeCloseTo(100,0);
    await expect(chat.getByText(/^PRIVATE synthetic assistant reply:/)).toHaveCSS("color","rgb(30, 58, 138)");
    await client.page.goto(`/workspace/${e}?tab=discussion&context=private`);
    await expect(client.page.getByText(/PRIVATE synthetic|Private historical note/)).toHaveCount(0);
    expect((await client.db.from("messages").select("id").eq("engagement_id",e).eq("visibility","professional")).data).toHaveLength(0);
    const shared=await client.db.rpc("search_agent_evidence",{e,v:"shared",q:"PRIVATE synthetic"});
    expect(JSON.stringify(shared.data)).not.toContain("PRIVATE synthetic");
    await pro.page.screenshot({path:"test-results/private-chat-desktop.png",fullPage:true});
    await pro.page.setViewportSize({width:390,height:844});
    expect(await pro.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await pro.page.screenshot({path:"test-results/private-chat-mobile.png",fullPage:true});
    expect(calls).toBe(2);
  } finally { for(const context of contexts) await context.close(); await cleanupIntegrationRun(run,service); }
});
