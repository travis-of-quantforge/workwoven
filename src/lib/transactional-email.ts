export type EmailStatus = "submitted" | "unconfigured" | "failed";
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);
export async function sendTransactionalEmail(recipient: string, subject: string, htmlContent: string): Promise<EmailStatus> {
  const key=process.env.BREVO_API_KEY, sender=process.env.BREVO_SENDER_EMAIL;
  if(!key || !sender)return "unconfigured";
  try {
    const response=await fetch("https://api.brevo.com/v3/smtp/email",{
      method:"POST",headers:{"api-key":key,accept:"application/json","content-type":"application/json"},
      body:JSON.stringify({sender:{email:sender,name:process.env.NEXT_PUBLIC_APP_NAME || "Workspace"},to:[{email:recipient}],subject,htmlContent}),
      signal:AbortSignal.timeout(8000),
    });
    return response.ok?"submitted":"failed";
  }catch{return "failed";}
}
