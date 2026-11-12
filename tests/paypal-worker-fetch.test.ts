import {expect,it} from "vitest";
import {SandboxPayPal} from "../src/lib/paypal-api";
it("calls native-style fetch without binding the PayPal client as its receiver",async()=>{
 let calls=0;
 const nativeStyleFetch:typeof fetch=async function(this:unknown,_input,init){
  expect(init?.redirect).toBe("manual");
  if(this!==globalThis)throw new TypeError("Illegal invocation");
  calls++;
  return Response.json(calls===1?{access_token:"synthetic-token"}:{links:[{rel:"action_url",href:"https://www.sandbox.paypal.com/bizsignup/fixture"}]});
 };
 const api=new SandboxPayPal({clientId:"fixture",secret:"fixture",partnerId:"ABCDEFGHIJKLM",attributionId:"fixture",appUrl:"https://example.test"},nativeStyleFetch);
 await expect(api.onboard("00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002")).resolves.toBe("https://www.sandbox.paypal.com/bizsignup/fixture");
 expect(calls).toBe(2);
});
it("identifies a genuinely pending onboarding response separately from runtime errors",async()=>{
 let calls=0;
 const api=new SandboxPayPal({clientId:"fixture",secret:"fixture",partnerId:"ABCDEFGHIJKLM",attributionId:"fixture",appUrl:"https://example.test"},async()=>Response.json(++calls===1?{access_token:"synthetic-token"}:{merchant_integrations:[]}));
 await expect(api.sellerStatus("00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({code:"SELLER_ONBOARDING_PENDING"});
});

it("rejects redirects without forwarding credentials to another location",async()=>{
 const calls:RequestInit[]=[];
 const api=new SandboxPayPal({clientId:"fixture",secret:"fixture",partnerId:"ABCDEFGHIJKLM",attributionId:"fixture",appUrl:"https://example.test"},async(_input,init)=>{
  calls.push(init!);
  return calls.length===1?Response.json({access_token:"synthetic-token"}):new Response(null,{status:302,headers:{location:"https://untrusted.example/"}});
 });
 await expect(api.onboard("00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002")).rejects.toMatchObject({code:"UNEXPECTED_REDIRECT"});
 expect(calls).toHaveLength(2);
 expect(calls.every(init=>init.redirect==="manual")).toBe(true);
});
