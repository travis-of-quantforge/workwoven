import {beforeEach,expect,it,vi} from "vitest";
const fake=vi.hoisted(()=>({signUp:vi.fn(),signInWithPassword:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({redirect:(url:string)=>{throw new Error(`REDIRECT:${url}`)},unstable_rethrow:vi.fn()}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn(),refresh:vi.fn()}));
vi.mock("next/headers",()=>({headers:vi.fn()}));
vi.mock("next/server",()=>({after:vi.fn()}));
vi.mock("../src/lib/supabase/server",()=>({database:async()=>({auth:fake}),authenticated:vi.fn()}));
import {login} from "../src/app/actions";
function form(){const f=new FormData();f.set("mode","signup");f.set("email","signup-fixture@example.test");f.set("password","FixturePassword123!");f.set("profileType","client");return f;}
beforeEach(()=>{fake.signUp.mockReset();fake.signInWithPassword.mockReset();});
it("shows existing-user error for Supabase's disguised duplicate instead of claiming verification mail was sent",async()=>{
 fake.signUp.mockResolvedValue({data:{user:{identities:[]}},error:null});
 await expect(login(form())).rejects.toThrow("A%20user%20with%20this%20email%20already%20exists");
 expect(fake.signUp).toHaveBeenCalledOnce();expect(fake.signInWithPassword).not.toHaveBeenCalled();
});
it("normalises explicit duplicate-signup errors",async()=>{
 for(const code of ["email_exists","user_already_exists"]){
 fake.signUp.mockResolvedValue({data:{user:null},error:{code,message:"Provider duplicate"}});
 await expect(login(form())).rejects.toThrow("mode=login&notice=A%20user%20with%20this%20email%20already%20exists");
 }
});
it("retains verification notice for a genuinely created user",async()=>{
 fake.signUp.mockResolvedValue({data:{user:{identities:[{provider:"email"}]}},error:null});
 await expect(login(form())).rejects.toThrow("Check+your+email+to+verify+your+account");
});
it("keeps provider delivery failures actionable rather than pretending success",async()=>{
 fake.signUp.mockResolvedValue({data:{user:null},error:{code:"email_address_not_authorized",message:"Email address not authorized"}});
 await expect(login(form())).rejects.toThrow("Email%20address%20not%20authorized");
});
it("does not classify ordinary sign-in as a duplicate signup",async()=>{
 fake.signInWithPassword.mockResolvedValue({data:{user:{identities:[]}},error:null});const f=form();f.set("mode","login");
 await expect(login(f)).rejects.toThrow("REDIRECT:/");expect(fake.signUp).not.toHaveBeenCalled();
});
