import { describe, expect, it } from "vitest";

import type { AlertConfig } from "./config";
import { hasDispatchBearer, json } from "./http";

// hasDispatchBearer is the only thing gating the CI-only dispatch + backfill
// endpoints (which send email and mutate subscriber state). Pin its contract.

const SECRET = "dispatch-secret-abc123";
const cfg = { dispatchSecret: SECRET } as AlertConfig;
const withAuth = (auth?: string) =>
  new Request("https://example.test", { headers: auth ? { authorization: auth } : {} });

describe("hasDispatchBearer", () => {
  it("accepts the exact bearer secret", () => {
    expect(hasDispatchBearer(withAuth(`Bearer ${SECRET}`), cfg)).toBe(true);
  });

  it("rejects a wrong secret of the same length (real char compare)", () => {
    expect(hasDispatchBearer(withAuth("Bearer dispatch-secret-abc124"), cfg)).toBe(false);
  });

  it("rejects a secret of a different length", () => {
    expect(hasDispatchBearer(withAuth(`Bearer ${SECRET}extra`), cfg)).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(hasDispatchBearer(withAuth(), cfg)).toBe(false);
  });

  it("rejects a non-Bearer scheme carrying the secret", () => {
    expect(hasDispatchBearer(withAuth(`Basic ${SECRET}`), cfg)).toBe(false);
  });

  it("rejects the raw secret without the Bearer prefix", () => {
    expect(hasDispatchBearer(withAuth(SECRET), cfg)).toBe(false);
  });

  it("is case-sensitive on the scheme", () => {
    expect(hasDispatchBearer(withAuth(`bearer ${SECRET}`), cfg)).toBe(false);
  });

  it("rejects an empty bearer even when the configured secret is empty", () => {
    // The `bearer !== ""` guard prevents an "" === "" match if the secret were
    // ever misconfigured to empty.
    expect(hasDispatchBearer(withAuth("Bearer "), { dispatchSecret: "" } as AlertConfig)).toBe(false);
  });
});

describe("json", () => {
  it("defaults to 200 with a JSON content-type and serializes the body", async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("uses the provided status code", () => {
    expect(json({ error: "unauthorized" }, 401).status).toBe(401);
  });
});
