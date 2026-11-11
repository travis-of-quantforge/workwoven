export const freelanceContract = `FREELANCE SERVICES AGREEMENT

1. Parties and work
The client and professional identified in this engagement agree to collaborate on the work described in their mutually accepted milestones. Discussion, estimates and desired outcomes are not additional commitments by themselves. The professional will exercise reasonable skill and care; business results such as profit, sales or investment returns are not guaranteed.

2. Scope and changes
Each accepted milestone defines its deliverables, acceptance criteria, client responsibilities, price and target date. Work not included in those commitments must be discussed and approved as a new milestone or revision before it becomes required. Correcting work that fails agreed acceptance criteria is part of the original commitment. Neither party may change accepted terms unilaterally. If terms conflict or are unclear, the parties will resolve that uncertainty in writing before the affected work proceeds.

3. Cooperation and timing
The client will supply the agreed materials, access and feedback in a timely manner. The professional will communicate progress and material risks promptly. Delays or dependencies should be discussed, with revised commitments approved by both parties. Neither party may treat silence as approval.

4. Delivery, review and payment
The professional will submit work for review against the accepted milestone criteria. The client will review reasonably promptly and either accept it or identify specific unmet criteria. Payment amounts, currency, due dates and any deposit or staged-payment arrangement must be agreed in the milestones or a mutually approved written revision. In the absence of a different accepted arrangement, a milestone payment is due when the client accepts its delivery. Extra payments and refunds require explicit human authorization; the platform and its AI cannot authorize them.

5. Ownership and third-party materials
After full payment for the relevant deliverable, the professional assigns to the client the transferable intellectual-property rights in original work specifically created for that deliverable, to the extent permitted by applicable law. Each party retains its pre-existing materials, tools and know-how. The professional will identify retained or third-party components and provide or identify the permissions needed for the client's agreed use. Neither party may provide materials it lacks permission to use. Portfolio publication requires the client's permission.

6. Confidentiality and information
Both parties will protect the other's non-public information, use it only for this engagement, and limit access to people who need it and are subject to appropriate confidentiality obligations. This does not cover information already lawfully known, independently developed, publicly available without a breach, or required to be disclosed by law. Share only the personal data and account access necessary for the work, and agree any special handling requirements before sharing them.

7. Ending the engagement and concerns
Either party may request to end the engagement by written notice. They will agree a practical handover and payment for accepted work and any other charges expressly agreed in advance. Cancellation does not automatically cancel an existing payment obligation, issue a refund, or waive a concern. The parties will first try to resolve concerns in good faith using the accepted records. Any settlement or revised terms require explicit agreement; AI suggestions are not binding decisions.

8. Status and agreement
The professional provides independent services. This template does not itself establish employment, agency or a partnership, and does not override applicable law or rights that cannot be excluded. The parties should specify any required governing law, dispute forum or additional legal terms in an approved revision. This contract takes effect in Workspace only when both parties approve the same version. Later changes require the same process.`;

export const contractTemplates = [
  {
    id: "general",
    name: "General freelance services",
    body: freelanceContract,
  },
  {
    id: "support",
    name: "Ongoing support and maintenance",
    body:
      freelanceContract.replace(
        "FREELANCE SERVICES AGREEMENT",
        "ONGOING SUPPORT AND MAINTENANCE AGREEMENT",
      ) +
      `\n\n9. Support boundaries\nSupport covers only the systems, tasks and service periods expressly accepted in the milestones. Response times, availability windows, included hours, hourly rates and recurring charges apply only if explicitly agreed by both parties. No round-the-clock availability, unlimited revisions or automatic renewal is implied. New features and additional support require an approved milestone or revision. Urgent work still requires authorization of any additional price and schedule.`,
  },
  { id: "custom", name: "Custom contract", body: "" },
] as const;
