import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import { cleanupIntegrationRun } from "../../scripts/integration-fixtures.mjs";

test("password reset is session-gated, validates confirmation and changes the real password", async ({ page }) => {
  const run=randomUUID(), password=randomBytes(24).toString("base64url")+"aA1!", changed=randomBytes(24).toString("base64url")+"bB2!";
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SECRET_KEY!,options);
  const email=`workspace-e2e-${run}-reset@example.test`;
  fs.mkdirSync(".integration-runs",{recursive:true});fs.writeFileSync(`.integration-runs/${run}.json`,JSON.stringify({run}));
  try {
    await page.goto("/login");
    await page.getByRole("link",{name:"Forgot password?"}).click();
    await expect(page.getByRole("button",{name:"Send reset link"})).toBeVisible();
    await page.goto("/reset-password");
    await expect(page.getByRole("link",{name:"Request a new reset link"})).toBeVisible();
    await expect(page.getByRole("button",{name:"Reset password",exact:true})).toHaveCount(0);
    await page.goto("/auth/callback?code=invalid-test-code&next=/reset-password");
    await expect(page.locator("p[role=alert]")).toContainText("invalid or expired");
    const generated=await admin.auth.admin.generateLink({type:"signup",email,password,options:{data:{workspace_test_run:run,profile_type:"client"}}});
    expect(generated.error).toBeNull();
    const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,options);
    const verified=await db.auth.verifyOtp({type:"signup",token_hash:generated.data.properties!.hashed_token});
    expect(verified.error).toBeNull();
    const recovery=await admin.auth.admin.generateLink({type:"recovery",email});
    if(recovery.error || !recovery.data.properties)throw Error("Recovery fixture failed");
    const token=recovery.data.properties.hashed_token;
    // The email link opens in a new, signed-out browser and is not consumed on GET.
    await page.goto(`/reset-password?token_hash=${token}`);
    await page.reload();
    await page.getByLabel("New password",{exact:true}).fill(changed);
    await page.getByLabel("Confirm new password",{exact:true}).fill(password);
    await page.getByRole("button",{name:"Reset password",exact:true}).click();
    await expect(page.locator("p[role=alert]")).toContainText("Passwords do not match");
    await page.getByLabel("New password",{exact:true}).fill(changed);
    await page.getByLabel("Confirm new password",{exact:true}).fill(changed);
    await page.getByRole("button",{name:"Reset password",exact:true}).click();
    await expect(page).toHaveURL(/\/login\?notice=/);
    await expect(page.getByRole("status")).toContainText("password has been reset");
    expect((await db.auth.signInWithPassword({email,password})).error).not.toBeNull();
    expect((await db.auth.signInWithPassword({email,password:changed})).error).toBeNull();
    await page.goto(`/reset-password?token_hash=${token}`);
    await page.getByLabel("New password",{exact:true}).fill(password);
    await page.getByLabel("Confirm new password",{exact:true}).fill(password);
    await page.getByRole("button",{name:"Reset password",exact:true}).click();
    await expect(page.locator("p[role=alert]")).toContainText("invalid or expired");
    await page.goto("/reset-password");
    await expect(page.getByRole("link",{name:"Request a new reset link"})).toBeVisible();
  } finally { await cleanupIntegrationRun(run,admin); }
});
