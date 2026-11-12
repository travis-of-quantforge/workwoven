import {expect,it} from "vitest";
import {assessmentPresentation} from "../src/lib/assessment-presentation";
it("shows green only for an actual successful quiet result",()=>{
 expect(assessmentPresentation({status:"checked",result:{verdict:"no_issue"}}).className).toContain("emerald");
 expect(assessmentPresentation({status:"checked",result:null}).className).toContain("amber");
});
it("distinguishes clarification from grounded attention",()=>{
 expect(assessmentPresentation({status:"checked",result:{verdict:"needs_clarification"}}).className).toContain("amber");
 expect(assessmentPresentation({status:"flagged",result:{verdict:"potential_conflict",issues:[{}]}}).className).toContain("red");
});
it("does not paint failed, incomplete or pending checks green",()=>{
 for(const status of ["failed","skipped","stale","queued","running"])expect(assessmentPresentation({status,result:{verdict:"no_issue"}}).className).not.toContain("emerald");
 const review={summary:"Quiet",coverage:"incomplete",findings:[]};
 expect(assessmentPresentation({status:"checked",result:{review}}).className).toContain("amber");
});
it("uses actionable evidence and lifecycle for modern review colours",()=>{
 const finding={existingId:null,actionable:true,subject:"Dates conflict",reopenReason:null,categories:["conflict"],explanation:"Two active dates differ.",nextStep:"Which date applies?",references:[{ref:"message:one",version:"1",quote:"Friday"},{ref:"contract:two",version:"1",quote:"Monday"}],status:"open",reminderReason:null,questionRef:null,respondent:"both",resolutionReferences:[]};
 const result={review:{summary:"Dates need attention",coverage:"complete",findings:[finding]}};
 expect(assessmentPresentation({status:"flagged",result}).className).toContain("red");
 finding.status="awaiting_clarification";
 expect(assessmentPresentation({status:"flagged",result}).className).toContain("amber");
 finding.actionable=false;finding.status="resolved";
 expect(assessmentPresentation({status:"checked",result}).className).toContain("emerald");
});
it("keeps an already-raised unresolved ambiguity yellow on cached reviews",()=>{
 const finding={existingId:"00000000-0000-4000-8000-000000000001",actionable:false,subject:"Button destination",reopenReason:null,categories:["ambiguity"],explanation:"The primary button destination remains unclear.",nextStep:"Confirm its destination.",references:[{ref:"message:one",version:"1",quote:"Book a consultation"}],status:"awaiting_clarification",reminderReason:null,questionRef:null,respondent:"both",resolutionReferences:[]};
 const check={status:"checked",reason:"unchanged_context",result:{review:{summary:"The destination remains unclear.",coverage:"complete",findings:[finding]}}};
 expect(assessmentPresentation(check).className).toContain("amber");
 expect(assessmentPresentation(check).label).toBe("Review needed");
 finding.status="resolved";
 expect(assessmentPresentation(check).className).toContain("emerald");
});
it("does not alert on a fresh non-actionable unanswered question",()=>{
 const finding={existingId:null,actionable:false,subject:"Images",reopenReason:null,categories:["unanswered_question"],explanation:"Who supplies images?",nextStep:"Allow the client to respond.",references:[{ref:"message:one",version:"1",quote:"Who supplies images?"}],status:"open",reminderReason:null,questionRef:"message:one",respondent:"client",resolutionReferences:[]};
 expect(assessmentPresentation({status:"checked",result:{review:{summary:"A new question awaits an ordinary response.",coverage:"complete",findings:[finding]}}}).className).toContain("emerald");
});
it("keeps an ordinary pending response quiet on subsequent assessments without hiding real concerns",()=>{
 const finding={existingId:"00000000-0000-4000-8000-000000000001",actionable:false,subject:"Initial feasibility reply",reopenReason:null,categories:["unanswered_question"],explanation:"The client supplied a brief and an ordinary first professional reply is pending.",nextStep:"Allow the professional to respond.",references:[{ref:"message:one",version:"1",quote:"Can you build this?"}],status:"awaiting_clarification",reminderReason:null as string|null,questionRef:"message:one",respondent:"professional",resolutionReferences:[]};
 const check={status:"checked",result:{review:{summary:"Brief received; awaiting the professional's response.",coverage:"complete",findings:[finding]}}};
 expect(assessmentPresentation(check).className).toContain("emerald");
 finding.reminderReason="skipped";
 expect(assessmentPresentation(check).className).toContain("amber");
});

it("updates earlier flags from current finding lifecycle without rewriting receipts",async()=>{
 const {currentAssessmentState,findingKey}=await import("../src/lib/assessment-presentation");
 const finding={existingId:null,actionable:true,subject:"Button destination",reopenReason:null,categories:["ambiguity"] as ["ambiguity"],explanation:"Destination unclear",nextStep:"Contact only?",references:[{ref:"message:one",version:"1",quote:"Book a consultation"}],status:"awaiting_clarification" as const,reminderReason:null,questionRef:null,respondent:"client" as const,resolutionReferences:[]};
 const check={status:"flagged",result:{summary:"Clarify the button.",review:{summary:"Clarify the button.",coverage:"complete",findings:[finding]}}};
 const row={id:"00000000-0000-4000-8000-000000000001",issue_key:findingKey(finding),status:"resolved",updated_at:"2026-11-12T18:00:00Z"};
 const state=currentAssessmentState(check,[row]);
 expect(state.cleared).toBe(true);expect(state.label).toBe("Concerns resolved");
 expect(assessmentPresentation(state.check).className).toContain("emerald");
 expect(state.updatedAt).toBe(row.updated_at);
 expect(check.result.review.findings[0].status).toBe("awaiting_clarification");
 expect(check.status).toBe("flagged");
 check.result.review.coverage="incomplete";
 expect(currentAssessmentState(check,[row]).label).toContain("review incomplete");
 expect(assessmentPresentation(currentAssessmentState(check,[row]).check).className).toContain("amber");
 check.result.review.coverage="complete";
 row.status="dismissed";
 expect(currentAssessmentState(check,[row]).label).toBe("No active concerns");
 row.status="open";
 expect(assessmentPresentation(currentAssessmentState(check,[row]).check).className).toContain("amber");
 expect(currentAssessmentState(check,[]).cleared).toBe(false);
 expect(currentAssessmentState(check,[{...row,issue_key:"unrelated",status:"resolved"}]).cleared).toBe(false);
});
it("does not clear a whole assessment when another concern is unresolved",async()=>{
 const {currentAssessmentState,findingKey}=await import("../src/lib/assessment-presentation");
 const finding={existingId:"00000000-0000-4000-8000-000000000001",actionable:true,subject:"Button destination",reopenReason:null,categories:["ambiguity"] as ["ambiguity"],explanation:"Destination unclear",nextStep:"Contact only?",references:[{ref:"message:one",version:"1",quote:"Book a consultation"}],status:"awaiting_clarification" as const,reminderReason:null,questionRef:null,respondent:"client" as const,resolutionReferences:[]};
 const check={status:"flagged",result:{review:{summary:"Two concerns",coverage:"complete",findings:[finding,{...finding,existingId:null,subject:"Recipient email"}]}}};
 const state=currentAssessmentState(check,[{id:finding.existingId,issue_key:findingKey(finding),status:"resolved",updated_at:"2026-11-12T18:00:00Z"}]);
 expect(state.cleared).toBe(false);
 expect(assessmentPresentation(state.check).className).toContain("amber");
});
