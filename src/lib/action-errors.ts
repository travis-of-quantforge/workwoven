import { ZodError } from "zod";
export class WorkspaceActionError extends Error {}
export function databaseActionError(code: string, message: string) {
  if (["PGRST205", "PGRST202"].includes(code))
    return new WorkspaceActionError(
      "Workspace database setup is incomplete. Apply the migrations, then retry.",
    );
  const allowed = [
    "Verified account required",
    "Forbidden",
    "Funding required",
    "Completion requires an accepted agreement",
    "Reviews require a closed engagement with an accepted agreement",
    "Submitted feedback is frozen",
    "The review submission window has closed",
    "No counterparty to review",
    "Ratings must be integers from 1 to 5",
    "Only the reviewed party can reply after publication",
    "Review unavailable",
    "Only the professional can propose portfolio publication",
    "Portfolio requires an accepted engagement",
    "Only the client can approve portfolio publication",
    "Both parties must join before scheduling",
    "Invalid IANA timezone",
    "Choose a future meeting within two years",
    "Select a current accepted milestone",
    "Stale meeting version",
    "Meeting unavailable",
    "Response already recorded; propose another time to revise",
    "Meeting proposal is stale or ended",
    "Explain why this meeting time does not work",
    "Engagement is closed",
    "Accepted agreement changed; refresh",
    "Submit scope before a milestone plan",
    "Milestone amounts exceed agreement price",
    "Milestone dependencies contain a cycle",
    "Dependent tasks must start after their predecessors finish",
    "Only the accepted task owner can report progress",
    "Only the professional can submit delivery",
    "Delivery requires the current accepted milestone",
    "Delivery files must be shared in this engagement",
    "This milestone delivery is already accepted",
    "Only the client can review delivery",
    "Delivery review already recorded",
    "Review the latest delivery against the current accepted milestone",
    "Party already joined",
    "Revoke the pending invitation before creating another",
    "Stale version; refresh before submitting",
    "Cannot approve a superseded version",
    "Invitation unavailable for this account",
    "Reply must reference a visible root message in this context",
    "Mention must reference an authorised party in this context",
  ];
  if (allowed.includes(message))
    return new WorkspaceActionError(
      message === "Forbidden"
        ? "You do not have permission for this action."
        : message,
    );
  if (code === "23505")
    return new WorkspaceActionError(
      "This action was already recorded or the party has already joined. Refresh to see the current state.",
    );
  return new WorkspaceActionError(
    "The action could not be saved. Check your connection and refresh before retrying.",
  );
}
export function actionErrorMessage(error: unknown) {
  if (error instanceof WorkspaceActionError) return error.message;
  if (error instanceof ZodError)
    return (
      "Check the form fields: " +
      error.issues
        .map((i) => i.path.join(".") || "value")
        .filter(Boolean)
        .slice(0, 3)
        .join(", ") +
      "."
    );
  return "The action could not be completed. Check your connection and sign-in, then retry.";
}
