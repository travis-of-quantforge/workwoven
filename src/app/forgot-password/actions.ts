"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { z } from "zod";
import { database } from "@/lib/supabase/server";
import { adminDatabase } from "@/lib/supabase/admin";
import { escapeHtml, sendTransactionalEmail } from "@/lib/transactional-email";

export async function requestPasswordReset(form: FormData) {
  const email = z.email().max(254).safeParse(String(form.get("email") || "").trim().toLowerCase());
  if (!email.success) redirect("/forgot-password?notice=Enter+a+valid+email+address.");
  const appUrl=process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || !process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL)
    redirect("/forgot-password?notice=Password+reset+is+temporarily+unavailable.");
  const admin=adminDatabase();
  const requestHeaders=await headers();
  const ip=requestHeaders.get("cf-connecting-ip") || requestHeaders.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
  const claim=await admin.rpc("claim_password_reset",{email_hash:hash(email.data),ip_hash:hash(ip)});
  if(claim.error)redirect("/forgot-password?notice=Password+reset+is+temporarily+unavailable.");
  if(!claim.data)redirect("/forgot-password?notice=Too+many+requests.+Please+wait+before+trying+again.");
  // Generate, but do not consume, a Supabase one-time recovery token. Sending
  // our own link avoids the provider's unrelated signup redirect settings.
  const generated=await admin.auth.admin.generateLink({type:"recovery",email:email.data});
  if(generated.error){
    if(generated.error.code==="user_not_found")redirect("/forgot-password?sent=1");
    redirect("/forgot-password?notice=The+reset+email+could+not+be+requested.+Please+try+again+shortly.");
  }
  const token=generated.data.properties?.hashed_token;
  if(!token)redirect("/forgot-password?notice=Password+reset+is+temporarily+unavailable.");
  const link=new URL("/reset-password",appUrl);link.searchParams.set("token_hash",token);
  const sent=await sendTransactionalEmail(email.data,"Reset your Work Woven password",
    `<p>A password reset was requested for your Work Woven account.</p><p><a href="${escapeHtml(link.href)}">Reset your password</a></p><p>This is a one-time link and expires according to the account recovery time limit. If you did not request this, ignore this email. Your password has not changed.</p>`);
  if(sent!=="submitted")redirect("/forgot-password?notice=The+reset+email+could+not+be+sent.+Please+try+again+shortly.");
  redirect("/forgot-password?sent=1");
}

export async function resetPassword(form: FormData) {
  const tokenHash=String(form.get("tokenHash") || "");
  const validToken=/^[a-f0-9]{56,64}$/i.test(tokenHash);
  const tokenQuery=validToken?`&token_hash=${tokenHash}`:"";
  const password = z.string().min(8).max(128).safeParse(form.get("password"));
  if (!password.success) redirect("/reset-password?notice=Use+between+8+and+128+characters."+tokenQuery);
  if (password.data !== form.get("confirmPassword")) redirect("/reset-password?notice=Passwords+do+not+match."+tokenQuery);
  const db = await database();
  if(tokenHash){
    if(!validToken)redirect("/forgot-password?notice=Your+reset+link+is+invalid.+Request+a+new+link.");
    const verification=await db.auth.verifyOtp({type:"recovery",token_hash:tokenHash});
    if(verification.error)redirect("/forgot-password?notice=Your+reset+link+is+invalid+or+expired.+Request+a+new+link.");
  }
  const { data: { user }, error: sessionError } = await db.auth.getUser();
  if (sessionError || !user) redirect("/forgot-password?notice=Your+reset+session+has+expired.+Request+a+new+link.");
  const { error } = await db.auth.updateUser({ password: password.data });
  if (error) redirect("/reset-password?notice=" + encodeURIComponent(
    error.code === "same_password" ? "Choose a password different from your current password."
      : error.code === "weak_password" ? "Choose a stronger password and try again."
      : "Your password could not be changed. Please try again or request a new reset link."));
  await db.auth.signOut();
  redirect("/login?notice=Your+password+has+been+reset.+Sign+in+with+your+new+password.");
}
