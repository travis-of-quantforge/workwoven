import {downloadFile} from "@/app/actions";
import {unstable_rethrow} from "next/navigation";
export const dynamic="force-dynamic";
// Reuse the existing authenticated, RLS-checked signed download. The redirect
// has Content-Disposition: attachment through Supabase's download parameter.
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;const form=new FormData();form.set("attachment",id);
 try{return await downloadFile(form);}catch(error){
  unstable_rethrow(error);
  return Response.json({error:"File unavailable. Sign in with an authorised account and retry."},{status:404,headers:{"Cache-Control":"private, no-store"}});
 }
}
