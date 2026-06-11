import { afterEach, describe, expect, it, vi } from "vitest";

import { EmailQuotaError, isQuotaError, parseFrom, restockEmail, sendEmail } from "./email";

describe("restockEmail", () => {
  const args = ["J350W", "https://site/?q=J350W", "https://site/unsub", "https://site/manage"] as const;

  it("a restock reads 'back in stock'", () => {
    const m = restockEmail(...args);
    expect(m.subject).toBe("J350W is back in stock");
    expect(m.text).toContain("just came back in stock");
    expect(m.html).toContain("just came back in stock");
  });

  it("a first appearance (phantom) reads 'now in stock'", () => {
    const m = restockEmail(...args, true);
    expect(m.subject).toBe("J350W is now in stock");
    expect(m.text).toContain("just showed up in stock");
    expect(m.text).toContain("no tracked vendor was carrying it before");
    expect(m.html).toContain("just showed up in stock");
  });
});

const ZEPTO = { host: "api.zeptomail.com", token: "Zoho-enczapikey TESTKEY==" };
const baseArgs = {
  zepto: ZEPTO,
  from: "HPR Motor Finder <alerts@fusionspace.co>",
  to: "flyer@example.com",
  subject: "Subj",
  html: "<p>hi</p>",
  text: "hi",
};

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("parseFrom", () => {
  it("splits 'Name <addr>' and bare addresses", () => {
    expect(parseFrom("HPR Motor Finder <alerts@fusionspace.co>")).toEqual({
      address: "alerts@fusionspace.co",
      name: "HPR Motor Finder",
    });
    expect(parseFrom('"Quoted Name" <a@b.com>')).toEqual({ address: "a@b.com", name: "Quoted Name" });
    expect(parseFrom("  bare@b.com ")).toEqual({ address: "bare@b.com" });
    expect(parseFrom("<a@b.com>")).toEqual({ address: "a@b.com" });
  });
});

describe("isQuotaError", () => {
  it("trips on quota status/codes/messages, not generic errors", () => {
    expect(isQuotaError(402, "", "")).toBe(true);
    expect(isQuotaError(400, "TM_3201", "")).toBe(true);
    expect(isQuotaError(400, "", "You have insufficient credits")).toBe(true);
    expect(isQuotaError(400, "", "daily sending limit exceeded")).toBe(true);
    expect(isQuotaError(400, "TM_5001", "invalid recipient")).toBe(false);
    expect(isQuotaError(500, "", "internal error")).toBe(false);
  });
});

describe("sendEmail", () => {
  it("POSTs the ZeptoMail v1.1 payload with auth + recipient + bodies", async () => {
    const fetchFn = mockFetch(201, { data: { code: "SUCCESS" } });
    await sendEmail({ ...baseArgs, listUnsubscribe: "https://x.test/u?token=abc" });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.zeptomail.com/v1.1/email");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Zoho-enczapikey TESTKEY==");
    const sent = JSON.parse(init.body);
    expect(sent.from).toEqual({ address: "alerts@fusionspace.co", name: "HPR Motor Finder" });
    expect(sent.to).toEqual([{ email_address: { address: "flyer@example.com" } }]);
    expect(sent.subject).toBe("Subj");
    expect(sent.htmlbody).toBe("<p>hi</p>");
    expect(sent.textbody).toBe("hi");
    expect(sent.mime_headers).toEqual({
      "List-Unsubscribe": "<https://x.test/u?token=abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("prefixes a bare token and omits mime_headers when no unsubscribe", async () => {
    const fetchFn = mockFetch(200, {});
    await sendEmail({ ...baseArgs, zepto: { host: "api.zeptomail.eu", token: "BAREKEY==" } });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.zeptomail.eu/v1.1/email");
    expect(init.headers.Authorization).toBe("Zoho-enczapikey BAREKEY==");
    expect(JSON.parse(init.body).mime_headers).toBeUndefined();
  });

  it("throws EmailQuotaError + logs an ops line when credits are exhausted", async () => {
    mockFetch(400, { error: { code: "TM_3201", message: "no credits" } });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendEmail(baseArgs)).rejects.toBeInstanceOf(EmailQuotaError);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("ZeptoMail quota exhausted"));
  });

  it("throws a plain Error on a non-quota failure", async () => {
    mockFetch(400, { error: { code: "TM_5001", message: "invalid recipient" } });
    await expect(sendEmail(baseArgs)).rejects.toThrow(/ZeptoMail send failed/);
    await expect(sendEmail(baseArgs)).rejects.not.toBeInstanceOf(EmailQuotaError);
  });
});
