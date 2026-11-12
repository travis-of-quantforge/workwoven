import { describe, it, expect } from "vitest";
import {
  conversationReviewSchema,
  validateConversationReview,
  skippedQuestionThreshold,
} from "../src/lib/ai/conversation-checks";
import { reviewInput } from "../src/lib/ai/conversation-context";
const e = "engagement",
  f = "98000000-0000-4000-8000-000000000003";
const sources = [
  {
    ref: "message:one",
    role: "client",
    version: "1",
    body: "Make it easy to update.",
    engagementId: e,
    visibility: "shared",
    date: "2026-11-12T10:00:00Z",
  },
  {
    ref: "message:two",
    role: "professional",
    version: "1",
    body: "I will edit content myself.",
    engagementId: e,
    visibility: "shared",
    date: "2026-11-12T11:00:00Z",
  },
];
const issue = {
  existingId: null,
  subject: "content editing",
  reopenReason: null,
  actionable: true,
  categories: ["ambiguity"],
  explanation: "Self-service or professional updates?",
  nextStep: "Which editing workflow do you expect?",
  references: [{ ref: "message:one", version: "1", quote: "easy to update" }],
  status: "awaiting_clarification",
  respondent: "client",
  reminderReason: null,
  questionRef: null,
  resolutionReferences: [],
};
const review = {
  summary: "Clarify editing expectations",
  coverage: "complete",
  findings: [issue],
};
describe("shared conversation review validation", () => {
  it("supports all six checks and a successful quiet conversation", () => {
    for (const category of [
      "scope",
      "ambiguity",
      "conflict",
      "understanding",
      "unanswered_question",
      "mediation",
    ])
      expect(
        conversationReviewSchema.parse({
          ...review,
          findings: [{ ...issue, categories: [category] }],
        }).findings,
      ).toHaveLength(1);
    expect(
      validateConversationReview(
        { ...review, findings: [] },
        e,
        sources,
        new Set(),
      ).findings,
    ).toEqual([]);
  });
  it("grounds grouped ambiguity and expectation against shared exact evidence", () => {
    expect(
      validateConversationReview(
        {
          ...review,
          findings: [
            { ...issue, categories: ["ambiguity", "understanding", "scope"] },
          ],
        },
        e,
        sources,
        new Set(),
      ).findings,
    ).toHaveLength(1);
    for (const changed of [
      { ...sources[0], visibility: "client" },
      { ...sources[0], engagementId: "other" },
      { ...sources[0], version: "2" },
      { ...sources[0], body: "not the quoted text" },
    ])
      expect(() =>
        validateConversationReview(review, e, [changed], new Set()),
      ).toThrow("Unsupported");
  });
  it("requires a known issue and later evidence for resolution", () => {
    const resolved = {
      ...issue,
      existingId: f,
      status: "resolved",
      actionable: false,
      resolutionReferences: [
        {
          ref: "message:two",
          version: "1",
          quote: "I will edit content myself.",
        },
      ],
    };
    expect(
      validateConversationReview(
        { ...review, findings: [resolved] },
        e,
        sources,
        new Set([f]),
      ).findings[0].status,
    ).toBe("resolved");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [resolved] },
        e,
        sources,
        new Set(),
      ),
    ).toThrow("Unknown");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [{ ...resolved, resolutionReferences: [] }] },
        e,
        sources,
        new Set([f]),
      ),
    ).toThrow("Resolution");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [{ ...issue, status: "dismissed" }] },
        e,
        sources,
        new Set(),
      ),
    ).toThrow("Dismissal");
  });
  it("suppresses premature or incomplete-history unanswered-question reminders", () => {
    const q = {
      ...issue,
      categories: ["unanswered_question"],
      questionRef: "message:one",
      reminderReason: "skipped",
      respondent: "professional",
    };
    const policy = { complete: true, requested: false, threshold: 5 };
    expect(() =>
      validateConversationReview(
        { ...review, findings: [q] },
        e,
        sources,
        new Set(),
        policy,
      ),
    ).toThrow("premature");
    const later = Array.from({ length: 5 }, (_, i) => ({
      ...sources[1],
      ref: `message:later${i}`,
    }));
    expect(
      validateConversationReview(
        { ...review, findings: [q] },
        e,
        [sources[0], ...later],
        new Set(),
        policy,
      ).findings,
    ).toHaveLength(1);
    expect(() =>
      validateConversationReview(
        { ...review, findings: [q] },
        e,
        sources,
        new Set(),
        { ...policy, complete: false },
      ),
    ).toThrow("Incomplete");
    expect(() =>
      validateConversationReview(
        { ...review, findings: [{ ...q, reminderReason: "requested_review" }] },
        e,
        sources,
        new Set(),
        policy,
      ),
    ).toThrow("not requested");
    expect(
      validateConversationReview(
        { ...review, findings: [{ ...q, actionable: false }] },
        e,
        sources,
        new Set(),
        policy,
      ).findings[0].actionable,
    ).toBe(false);
  });
  it("bounds model context and records incomplete coverage instead of claiming all history was read", () => {
    const input = reviewInput({
      sources: Array.from({ length: 30 }, (_, i) => ({
        ref: `message:${i}`,
        version: "1",
        body: "x".repeat(5000),
        state: "discussed",
      })),
      findings: [],
      complete: true,
      requested: false,
    });
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThanOrEqual(48000);
    expect(input.complete).toBe(false);
  });
  it("defaults to five skipped messages and validates configuration", () => {
    expect(skippedQuestionThreshold(undefined)).toBe(5);
    expect(skippedQuestionThreshold("8")).toBe(8);
    for (const value of ["0", "-1", "five", "1.5", "101"])
      expect(() => skippedQuestionThreshold(value)).toThrow();
  });
});
it("retains timestamped prior assessments as advisory continuity within the existing budget",()=>{
 const prior={id:"previous",messageId:"message",assessedAt:"2026-11-12T15:00:00Z",status:"checked",summary:"We already asked who supplies images."};
 const input=reviewInput({sources:[],findings:[],complete:true,requested:false,priorAssessments:[prior]});
 expect(input.priorAssessments).toEqual([prior]);
 expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(16000);
});

it("retains client file provenance and gives reviewers the briefing relationship context",async()=>{
 const {conversationInstructions}=await import("../src/lib/ai/conversation-context");
 const input=reviewInput({sources:[
  {ref:"message:goals",version:"1",body:"Can you build this website?",state:"discussed",role:"client",date:"2026-11-12T10:00:00Z"},
  {ref:"attachment:brief",version:"hash",body:"A brochure website with five pages.",state:"extracted_text",uploaderRole:"client",sourceMessageRef:"message:goals"},
  {ref:"attachment:design",version:"hash",body:"Use teal and navy.",state:"extracted_text",uploaderRole:"client",sourceMessageRef:"message:goals"},
 ],findings:[],complete:true,requested:false});
 expect(input.sources.find(s=>s.ref==="attachment:brief")).toMatchObject({uploaderRole:"client",sourceMessageRef:"message:goals"});
 expect(conversationInstructions).toContain("A client brief is NOT expected to confirm");
 expect(conversationInstructions).toContain("one ongoing briefing turn");
 expect(conversationInstructions).toContain("Prior AI assessments can be mistaken");
 expect(validateConversationReview({summary:"The client has supplied the initial brief; an ordinary professional response is pending.",coverage:"complete",findings:[]},e,input.sources.map(s=>({...s,engagementId:e,visibility:"shared"})),new Set()).findings).toEqual([]);
});

it("does not treat the client's own follow-up briefing messages as a skipped professional response",()=>{
 const question={...sources[0],body:"Can you meet these requirements?",role:"client"};
 const later=Array.from({length:5},(_,i)=>({...sources[1],ref:`message:client-file${i}`,role:"client",body:"Here is the next part of my brief."}));
 const pending={...issue,categories:["unanswered_question"],questionRef:question.ref,respondent:"professional",reminderReason:"skipped",references:[{ref:question.ref,version:"1",quote:question.body}]};
 const policy={complete:true,requested:false,threshold:5};
 expect(()=>validateConversationReview({...review,findings:[pending]},e,[question,...later],new Set(),policy)).toThrow("respondent turn");
 expect(()=>validateConversationReview({...review,findings:[{...pending,respondent:"client"}]},e,[question,...later],new Set(),policy)).toThrow("respondent turn");
 const respondent={...sources[1],ref:"message:professional-turn",role:"professional",body:"Let us commit to the delivery date now."};
 expect(validateConversationReview({...review,findings:[pending]},e,[question,...later,respondent],new Set(),policy).findings).toHaveLength(1);
 expect(validateConversationReview({...review,findings:[{...pending,actionable:false,reminderReason:null}]},e,[question,...later],new Set(),policy).findings[0].actionable).toBe(false);
});

it("can flag cross-document implementation ambiguity before any professional response or accepted agreement",async()=>{
 const {northstarDesign,northstarBrief}=await import("./fixtures/northstar-brief");
 const {conversationInstructions}=await import("../src/lib/ai/conversation-context");
 const {assessmentPresentation}=await import("../src/lib/assessment-presentation");
 const supplied=[{ref:"attachment:design",version:"design-hash",body:northstarDesign,state:"extracted_text",uploaderRole:"client" as const,sourceMessageRef:"message:upload"},
 {ref:"attachment:brief",version:"brief-hash",body:northstarBrief,state:"extracted_text",uploaderRole:"client" as const,sourceMessageRef:"message:upload"}];
 const input=reviewInput({sources:supplied,findings:[],complete:true,requested:false});
 expect(input.sources.map(s=>s.body)).toEqual(expect.arrayContaining([northstarDesign,northstarBrief]));
 expect(conversationInstructions).toContain("ordinary-waiting rule applies ONLY");
 expect(conversationInstructions).toContain("even during initial briefing");
 const finding={...issue,categories:["ambiguity"],subject:"Consultation button destination",explanation:"The action label leaves the destination unclear; the functional brief excludes online booking. This does not establish that a booking feature is required.",nextStep:"Should the button link to Contact only, or do something else?",references:[{ref:"attachment:design",version:"design-hash",quote:"Primary button: Book a consultation."},{ref:"attachment:brief",version:"brief-hash",quote:"No customer accounts, online appointment booking, payment collection, blog or ecommerce in this release."}]};
 const result=validateConversationReview({summary:"Clarify the button's behaviour.",coverage:"complete",findings:[finding]},e,input.sources.map(s=>({...s,engagementId:e,visibility:"shared"})),new Set(),{complete:true,requested:false,threshold:5});
 expect(result.findings).toHaveLength(1);
 expect(assessmentPresentation({status:"flagged",result:{review:result}}).className).toContain("amber");
 const answer={ref:"message:clarification",version:"1",body:"The button links to Contact only, with no booking calendar.",engagementId:e,visibility:"shared",role:"client"};
 const settled={...finding,existingId:f,actionable:false,status:"resolved",resolutionReferences:[{ref:answer.ref,version:answer.version,quote:answer.body}]};
 expect(validateConversationReview({summary:"The client clarified contact-page navigation.",coverage:"complete",findings:[settled]},e,[...input.sources.map(s=>({...s,engagementId:e,visibility:"shared"})),answer],new Set([f])).findings[0].status).toBe("resolved");
});
