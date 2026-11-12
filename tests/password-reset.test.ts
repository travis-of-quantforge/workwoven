import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ resetPasswordForEmail: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(), exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(), generateLink: vi.fn(), rpc: vi.fn(), sendEmail: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ database: async () => ({ auth }) }));
vi.mock("@/lib/supabase/admin", () => ({ adminDatabase: () => ({rpc:auth.rpc,auth:{admin:{generateLink:auth.generateLink}}}) }));
vi.mock("@/lib/transactional-email", () => ({ escapeHtml:(s:string)=>s, sendTransactionalEmail:auth.sendEmail }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({origin:"https://workwoven.example"}) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); }, unstable_rethrow: () => {} }));
vi.mock("@/app/actions", () => ({ acceptInvite: vi.fn() }));
import { requestPasswordReset, resetPassword } from "@/app/forgot-password/actions";
import { GET } from "@/app/auth/callback/route";
const form = (values: Record<string,string>) => { const f=new FormData();Object.entries(values).forEach(([k,v])=>f.set(k,v));return f; };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL","https://workwoven.example");
  vi.stubEnv("BREVO_API_KEY","fixture-key");vi.stubEnv("BREVO_SENDER_EMAIL","sender@example.test");
  auth.rpc.mockResolvedValue({data:true,error:null});
  auth.generateLink.mockResolvedValue({data:{properties:{hashed_token:"a".repeat(64)}},error:null});
  auth.sendEmail.mockResolvedValue("submitted");auth.verifyOtp.mockResolvedValue({error:null});
  auth.getUser.mockResolvedValue({data:{user:{id:"fixture-user"}},error:null});
  auth.updateUser.mockResolvedValue({error:null});
  auth.signOut.mockResolvedValue({error:null});
  auth.exchangeCodeForSession.mockResolvedValue({error:null});
});
afterEach(()=>vi.unstubAllEnvs());
describe("password recovery", () => {
  it("sends a direct reset link through the approved sender without disclosing account existence", async () => {
    await expect(requestPasswordReset(form({email:"user@example.com"}))).rejects.toThrow("/forgot-password?sent=1");
    expect(auth.generateLink).toHaveBeenCalledWith({type:"recovery",email:"user@example.com"});
    expect(auth.sendEmail).toHaveBeenCalledWith("user@example.com",expect.any(String),expect.stringContaining("https://workwoven.example/reset-password?token_hash="));
    auth.sendEmail.mockClear();auth.generateLink.mockResolvedValue({error:{code:"user_not_found"}});
    await expect(requestPasswordReset(form({email:"missing@example.com"}))).rejects.toThrow("/forgot-password?sent=1");
    expect(auth.sendEmail).not.toHaveBeenCalled();
  });
  it("throttles before token generation and reports delivery failures",async()=>{
    auth.rpc.mockResolvedValue({data:false,error:null});
    await expect(requestPasswordReset(form({email:"user@example.com"}))).rejects.toThrow("Too+many+requests");
    expect(auth.generateLink).not.toHaveBeenCalled();
    auth.rpc.mockResolvedValue({data:true,error:null});auth.sendEmail.mockResolvedValue("failed");
    await expect(requestPasswordReset(form({email:"user@example.com"}))).rejects.toThrow("could+not+be+sent");
  });
  it("verifies recovery tokens only on a valid password submission and rejects expired tokens",async()=>{
    const token="a".repeat(64);
    await expect(resetPassword(form({password:"long-password",confirmPassword:"different",tokenHash:token}))).rejects.toThrow("do+not+match");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    auth.verifyOtp.mockResolvedValue({error:{code:"otp_expired"}});
    await expect(resetPassword(form({password:"long-password",confirmPassword:"long-password",tokenHash:token}))).rejects.toThrow("invalid+or+expired");
    expect(auth.verifyOtp).toHaveBeenCalledWith({type:"recovery",token_hash:token});
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("accepts Supabase SHA-224 recovery hashes as well as SHA-256 hashes",async()=>{
    const token="a".repeat(56);
    await expect(resetPassword(form({password:"long-password",confirmPassword:"long-password",tokenHash:token}))).rejects.toThrow("password+has+been+reset");
    expect(auth.verifyOtp).toHaveBeenCalledWith({type:"recovery",token_hash:token});
  });
  it("rejects invalid inputs before auth calls",async()=>{
    await expect(requestPasswordReset(form({email:"invalid"}))).rejects.toThrow("valid+email");
    await expect(resetPassword(form({password:"short",confirmPassword:"short"}))).rejects.toThrow("8+and+128");
    await expect(resetPassword(form({password:"long-password",confirmPassword:"different"}))).rejects.toThrow("do+not+match");
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("requires a server-verified session and never accepts a supplied identity",async()=>{
    auth.getUser.mockResolvedValue({data:{user:null},error:{message:"expired"}});
    await expect(resetPassword(form({password:"long-password",confirmPassword:"long-password",userId:"other"}))).rejects.toThrow("session+has+expired");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("updates the verified session password and signs out",async()=>{
    await expect(resetPassword(form({password:"long-password",confirmPassword:"long-password"}))).rejects.toThrow("/login?notice=Your+password+has+been+reset");
    expect(auth.updateUser).toHaveBeenCalledWith({password:"long-password"});
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
  it("keeps a failed update on the form",async()=>{
    auth.updateUser.mockResolvedValue({error:{code:"same_password"}});
    await expect(resetPassword(form({password:"long-password",confirmPassword:"long-password"}))).rejects.toThrow("different%20from");
    expect(auth.signOut).not.toHaveBeenCalled();
  });
  it("exchanges a recovery code before routing to the reset form",async()=>{
    const r=await GET(new Request("https://workwoven.example/auth/callback?code=fixture&next=/reset-password"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("fixture");
    expect(r.headers.get("location")).toBe("https://workwoven.example/reset-password");
  });
  it("passes the SDK flow ID so concurrent email requests use their own verifier",async()=>{
    await GET(new Request("https://workwoven.example/auth/callback?code=fixture&next=/reset-password&sb_flow_id=fixture-flow"));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("fixture",{flowId:"fixture-flow"});
  });
  it("rejects expired recovery links and never follows arbitrary next URLs",async()=>{
    auth.exchangeCodeForSession.mockResolvedValue({error:{message:"expired"}});
    expect((await GET(new Request("https://workwoven.example/auth/callback?code=bad&next=/reset-password"))).headers.get("location")).toContain("/forgot-password?notice=");
    auth.exchangeCodeForSession.mockResolvedValue({error:null});
    expect((await GET(new Request("https://workwoven.example/auth/callback?code=ok&next=https://evil.example"))).headers.get("location")).toBe("https://workwoven.example/");
  });
});
