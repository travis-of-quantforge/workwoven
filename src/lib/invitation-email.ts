import { escapeHtml, sendTransactionalEmail, type EmailStatus } from "./transactional-email";
export type InvitationEmailStatus = EmailStatus;
export async function sendInvitationEmail(recipient: string, engagementName: string, token: string): Promise<InvitationEmailStatus> {
  const appUrl=process.env.NEXT_PUBLIC_APP_URL;
  if(!appUrl)return "unconfigured";
  const link=new URL(`/invite/${token}`,appUrl).toString();
  return sendTransactionalEmail(recipient,`Invitation to ${engagementName}`,
    `<p>You have been invited to join ${escapeHtml(engagementName)} on ${escapeHtml(process.env.NEXT_PUBLIC_APP_NAME || "Workspace")}.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">Accept this invitation</a></p><p>This link expires in seven days. If you were not expecting this invitation, you can ignore this email.</p>`);
}
