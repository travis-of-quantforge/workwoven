import {createHash} from "node:crypto";
import {conversationReviewSchema, type ConversationReview} from "./ai/conversation-checks";
type Check={status:string;reason?:string|null;result?:{verdict?:string;issues?:unknown[];review?:unknown}|null};
function needsReview(f:ConversationReview["findings"][number]) {
 return ["open","awaiting_clarification"].includes(f.status) && (f.actionable || !!(f.existingId && f.reminderReason) || f.categories.some(category=>category!=="unanswered_question"));
}
export function assessmentPresentation(check:Check){
 const tones={
  green:{label:"No concerns found",className:"border-emerald-300 bg-emerald-50"},
  yellow:{label:"Review needed",className:"border-amber-300 bg-amber-50"},
  red:{label:"Needs attention",className:"border-red-300 bg-red-50"},
  neutral:{label:"Check pending",className:"border-slate-200 bg-slate-50"},
 };
 if(["queued","running"].includes(check.status))return tones.neutral;
 if(["failed","skipped","stale"].includes(check.status))return tones.yellow;
 const review=conversationReviewSchema.safeParse(check.result?.review);
 if(review.success){
  // actionable controls whether to publish another intervention, not whether
  // the underlying issue is resolved. Keep existing concerns visible without
  // turning a freshly tracked ordinary question into a warning.
  const active=review.data.findings.filter(needsReview);
  if(active.some(f=>f.reminderReason==="blocker" || f.reminderReason==="imminent_decision" || (f.status==="open" && f.references.length>=2 && f.categories.some(c=>c==="scope" || c==="conflict"))))return tones.red;
  if(active.length || review.data.coverage!=="complete")return tones.yellow;
  return tones.green;
 }
 if(check.result?.verdict==="potential_conflict")return check.result.issues?.length?tones.red:tones.yellow;
 if(check.result?.verdict==="needs_clarification")return tones.yellow;
 if(check.status==="checked" && check.result?.verdict==="no_issue")return tones.green;
 // Older successful reviews did not always retain a result. Absence of an
 // explanation must not be shown as proof that everything is fine.
 return tones.yellow;
}

export type CurrentFinding = {
 id:string;issue_key:string;status:string;updated_at:string;
};
export function findingKey(finding:ConversationReview["findings"][number]) {
 return createHash("md5").update(`${finding.references[0].ref}:${finding.subject}`).digest("hex");
}
// Project current lifecycle onto a historical assessment for display only.
// Missing records never imply resolution; the original receipt is immutable.
export function currentAssessmentState(check:Check,findings:CurrentFinding[]) {
 const parsed=conversationReviewSchema.safeParse(check.result?.review);
 if(!parsed.success || !["checked","flagged"].includes(check.status))
  return {check,cleared:false,label:null,updatedAt:null};
 const matches=parsed.data.findings.map(finding=>findings.find(row=>row.id===finding.existingId || row.issue_key===findingKey(finding)));
 const raised=parsed.data.findings.map((finding,index)=>({finding,row:matches[index]})).filter(({finding})=>needsReview(finding));
 const cleared=raised.length>0 && raised.every(({row})=>row && ["resolved","dismissed"].includes(row.status));
 const projected={...parsed.data,findings:parsed.data.findings.map((finding,index)=>{
  const row=matches[index];
  return row?{...finding,status:row.status}:finding;
 })};
 const changed=matches.filter((row,index)=>row && row.status!==parsed.data.findings[index].status);
 const updatedAt=changed.map(row=>row!.updated_at).sort().at(-1) || null;
 const label=cleared ? (parsed.data.coverage!=="complete"?"Concerns cleared; review incomplete":raised.every(({row})=>row?.status==="resolved")?"Concerns resolved":"No active concerns") : null;
 return {check:{...check,result:{...check.result,review:projected}},cleared,label,updatedAt};
}
