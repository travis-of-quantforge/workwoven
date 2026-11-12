import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("ended workspaces retain navigation and history while all forms are locked", async ({ page }) => {
  const run=randomUUID(),password=randomBytes(24).toString("base64url")+"aA1!";
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,options);
  const email=`workspace-e2e-${run}-lock@example.test`;
  fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
  try {
    const generated=await admin.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:"client"}}});
    if(generated.error || !generated.data.properties)throw Error("Fixture generation failed");
    const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,options);
    expect((await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties.hashed_token})).error).toBeNull();
    const walletBefore=await db.from("account_token_wallets").select("available_nano").single();expect(walletBefore.error).toBeNull();
    const created=await db.rpc("create_engagement",{p_title:`[E2E] Closed workspace ${run}`});expect(created.error).toBeNull();
    const e=created.data;
    expect((await db.rpc("send_message",{e,v:"shared",b:"Keep this earlier conversation visible."})).error).toBeNull();
    await page.goto("/login");await page.getByLabel("Email",{exact:true}).fill(email);await page.getByLabel("Password",{exact:true}).fill(password);
    await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL("http://127.0.0.1:3200/");
    await page.goto(`/workspace/${e}`);
    await expect(page.getByRole("button",{name:"Send message",exact:true})).toBeEnabled();
    await page.getByLabel("Message",{exact:true}).fill("Sent with the primary button.");
    await page.getByRole("button",{name:"Send message",exact:true}).click();
    await expect(page.getByText("Sent with the primary button.",{exact:true})).toBeVisible();
    await page.getByLabel("Message",{exact:true}).fill("Sent with Ctrl+Enter too.");
    await page.getByLabel("Message",{exact:true}).press("Control+Enter");
    await expect(page.getByText("Sent with Ctrl+Enter too.",{exact:true})).toBeVisible();
    expect((await db.rpc("close_engagement",{e,target:"cancelled",expected:null,reason:"End this isolated fixture."})).error).toBeNull();
    const walletAfter=await db.from("account_token_wallets").select("available_nano").single();expect(walletAfter.error).toBeNull();
    expect(walletAfter.data!.available_nano).toBe(walletBefore.data!.available_nano);
    const source=await db.from("agent_accounts").select("available_nano").eq("engagement_id",e).eq("visibility","shared").single();expect(source.data!.available_nano).toBe(0);
    await page.reload();
    await expect(page.getByText("This engagement has ended and is read-only.",{exact:false})).toBeVisible();
    await expect(page.getByText("Keep this earlier conversation visible.",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Send message",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Send message",exact:true})).toBeDisabled();
    await expect(page.getByText("End engagement",{exact:true})).toHaveCount(0);
    expect((await db.rpc("send_message",{e,v:"shared",b:"Stale browser submission"})).error?.message).toContain("read-only");
    for(const query of ["tab=discussion&context=private","tab=discussion&context=project","tab=milestones","tab=contract","tab=files","tab=calendar","tab=concerns","tab=payments","tab=credits"]){
      await page.goto(`/workspace/${e}?${query}`);
      await expect(page.getByText("This engagement has ended and is read-only.",{exact:false})).toBeVisible();
      await expect(page.locator("fieldset[disabled]").first()).toBeAttached();
      const usableForms=await page.locator("fieldset[disabled]").first().locator("form").evaluateAll(forms=>forms.filter(f=>getComputedStyle(f).display!=="none" && !f.closest("fieldset[disabled]")).length);
      expect(usableForms).toBe(0);
    }
  } finally { await cleanupIntegrationRun(run,admin); }
});
