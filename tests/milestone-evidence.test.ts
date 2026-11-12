import { it, expect } from "vitest";
import { boundedMilestoneEvidence, milestoneFileCoverage } from "../src/lib/ai/milestone-evidence";
import type { Evidence } from "../src/lib/ai/contracts";
const source: Evidence={ref:"message:example",kind:"message",record_id:"96000000-0000-4000-8000-000000000003",version:"1",body:"x".repeat(5000),state:"discussed",source_visibility:"shared",excerpt:false};
it("retains every attachment after a long discussion within the existing budget",()=>{
 const rows=[...Array.from({length:20},(_,i)=>({...source,ref:`message:${i}`})),...Array.from({length:4},(_,i)=>({...source,kind:"attachment" as const,ref:`attachment:${i}`,body:`File requirements ${i}: `+"y".repeat(10000)}))];
 const found=boundedMilestoneEvidence(rows);
 expect(found).toHaveLength(rows.length);expect(found.filter(s=>s.kind==="attachment")).toHaveLength(4);
 expect(found.every(s=>s.body.length>0)).toBe(true);expect(found.some(s=>s.excerpt)).toBe(true);
 expect(Buffer.byteLength(JSON.stringify(found))).toBeLessThan(30100);
});
it("rejects an unrepresentable source count instead of silently ignoring files",()=>{
 expect(()=>boundedMilestoneEvidence(Array.from({length:1000},()=>source))).toThrow("Too many shared sources");
});

it("always reports unreadable files and partial text instead of implying full file coverage",()=>{
 const unavailable={...source,kind:"attachment" as const,state:"unavailable_text",body:"File: design.pdf\nContents unavailable",excerpt:true};
 expect(milestoneFileCoverage([unavailable])).toContain("File contents not read: design.pdf");
 expect(milestoneFileCoverage([{...unavailable,state:"partial_text"}])).toContain("only as text excerpts");
 expect(milestoneFileCoverage([source])).toBe("");
});
