import { afterEach, expect, it, vi } from "vitest";
import { sendInvitationEmail } from "../src/lib/invitation-email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("submits a link only to the selected recipient without exposing the API key in the body", async () => {
  vi.stubEnv("BREVO_API_KEY", "test-key");
  vi.stubEnv("BREVO_SENDER_EMAIL", "invites@example.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://workspace.example.test");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);

  expect(await sendInvitationEmail("recipient@example.test", "Reporting dashboard", "secret-token"))
    .toBe("submitted");
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("https://api.brevo.com/v3/smtp/email");
  expect(options.headers["api-key"]).toBe("test-key");
  const payload = JSON.parse(options.body);
  expect(payload.to).toEqual([{ email: "recipient@example.test" }]);
  expect(payload.htmlContent).toContain('href="https://workspace.example.test/invite/secret-token"');
  expect(payload.htmlContent).toContain("Accept this invitation</a>");
  expect(payload.htmlContent).not.toContain("Sign in with");
  expect(options.body).not.toContain("test-key");
});

it("reports missing configuration and provider rejection without sending another invitation", async () => {
  vi.stubEnv("BREVO_API_KEY", "");
  const fetchMock = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetchMock);
  expect(await sendInvitationEmail("recipient@example.test", "Project", "token"))
    .toBe("unconfigured");
  expect(fetchMock).not.toHaveBeenCalled();

  vi.stubEnv("BREVO_API_KEY", "test-key");
  vi.stubEnv("BREVO_SENDER_EMAIL", "invites@example.test");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://workspace.example.test");
  expect(await sendInvitationEmail("recipient@example.test", "Project", "token"))
    .toBe("failed");
});
