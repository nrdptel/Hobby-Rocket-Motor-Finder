import { describe, expect, it } from "vitest";

import { restockEmail } from "./email";

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
