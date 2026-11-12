import {beforeEach,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const fake=vi.hoisted(()=>({single:vi.fn(),update:vi.fn(),save:vi.fn()}));
vi.mock("../src/lib/supabase/admin",()=>({adminDatabase:()=>({from:()=>({select:()=>({eq:()=>({single:fake.single})}),update:fake.update})})}));
import {refreshSeller} from "../src/lib/paypal-service";
import {SandboxPayPal,PayPalError} from "../src/lib/paypal-api";
beforeEach(()=>{
 vi.restoreAllMocks();fake.update.mockReset();fake.save.mockReset();fake.single.mockReset();
 fake.single.mockResolvedValue({data:{tracking_id:"tracking",merchant_id:"ABCDEFGHIJKLM",payments_enabled:true},error:null});
 fake.update.mockReturnValue({eq:fake.save});fake.save.mockResolvedValue({error:null});
});
const api=()=>new SandboxPayPal({clientId:"fixture",secret:"fixture",partnerId:"ABCDEFGHIJKLM",attributionId:"fixture",appUrl:"https://example.test"});
it("stores provider-confirmed capability after onboarding",async()=>{
 const status={merchantId:"ABCDEFGHIJKLM",payments:true,refunds:true};
 const provider=api();vi.spyOn(provider,"sellerStatus").mockResolvedValue(status);
 expect(await refreshSeller("professional",provider)).toEqual(status);
 expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({merchant_id:status.merchantId,payments_enabled:true,refunds_enabled:true,verified_at:expect.any(String)}));
});
it("does not erase a confirmed connection when the provider is temporarily unavailable",async()=>{
 const provider=api();vi.spyOn(provider,"sellerStatus").mockRejectedValue(new PayPalError(503,"SERVICE_UNAVAILABLE"));
 await expect(refreshSeller("professional",provider)).rejects.toThrow("SERVICE_UNAVAILABLE");
 expect(fake.update).not.toHaveBeenCalled();
});
it("still records an explicit provider-confirmed loss of capabilities",async()=>{
 const provider=api();vi.spyOn(provider,"sellerStatus").mockResolvedValue({merchantId:"ABCDEFGHIJKLM",payments:false,refunds:false});
 expect((await refreshSeller("professional",provider)).payments).toBe(false);
 expect(fake.update).toHaveBeenCalledWith(expect.objectContaining({payments_enabled:false,refunds_enabled:false}));
});
it("does not describe a runtime failure as incomplete seller onboarding",async()=>{
 const provider=api();vi.spyOn(provider,"sellerStatus").mockRejectedValue(new TypeError("Illegal invocation"));
 await expect(refreshSeller("professional",provider)).rejects.toThrow("could not be verified right now");
 expect(fake.update).not.toHaveBeenCalled();
});
