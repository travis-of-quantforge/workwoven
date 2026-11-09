export type InvitationEmailStatus = "submitted" | "unconfigured" | "failed";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

export async function sendInvitationEmail(
  recipient: string,
  engagementName: string,
  token: string,
): Promise<InvitationEmailStatus> {
  const key = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!key || !sender || !appUrl) return "unconfigured";

  try {
    const link = new URL(`/invite/${token}`, appUrl).toString();
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": key,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: { email: sender, name: process.env.NEXT_PUBLIC_APP_NAME || "Workspace" },
        to: [{ email: recipient }],
        subject: `Invitation to ${engagementName}`,
        htmlContent: `<p>You have been invited to join ${escapeHtml(engagementName)} on ${escapeHtml(process.env.NEXT_PUBLIC_APP_NAME || "Workspace")}.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600">Accept this invitation</a></p><p>This link expires in seven days. If you were not expecting this invitation, you can ignore this email.</p>`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? "submitted" : "failed";
  } catch {
    return "failed";
  }
}
