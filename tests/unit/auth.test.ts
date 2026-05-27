/**
 * Unit tests for api/auth.ts — NetlifyAuthenticator string-based postMessage protocol.
 *
 * Covers spec scenarios:
 *   - Missing env vars → 500 HTML error
 *   - No code param → 302 redirect to GitHub authorize
 *   - Successful token exchange → HTML with string postMessage handshake
 *   - Token exchange failure → HTML error page
 *
 * Uses dynamic imports so vi.stubEnv applies before module-level constants are evaluated.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ─── Mock helpers ───────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    query: {} as Record<string, string | string[] | undefined>,
    headers: {} as Record<string, string | string[] | undefined>,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockRes = Record<string, any> & {
  _status: number;
  _body: string;
  _headers: Record<string, string>;
  _redirectUrl: string;
  status: (code: number) => MockRes;
  json: (data: unknown) => MockRes;
  send: (body: string) => MockRes;
  setHeader: (name: string, value: string) => MockRes;
  redirect: (code: number, url: string) => MockRes;
};

function mockRes(): MockRes {
  const state = {
    _status: 200,
    _body: "",
    _headers: {} as Record<string, string>,
    _redirectUrl: "",
  };

  const chain: Record<string, unknown> = {
    status(code: number) {
      state._status = code;
      return chain;
    },
    json(data: unknown) {
      state._body = JSON.stringify(data);
      state._headers["Content-Type"] = "application/json";
      return chain;
    },
    send(body: string) {
      state._body = body;
      return chain;
    },
    setHeader(name: string, value: string) {
      state._headers[name] = value;
      return chain;
    },
    redirect(code: number, url: string) {
      state._status = code;
      state._redirectUrl = url;
      return chain;
    },
  };

  // Attach getters that always read from state — avoids stale spread copies
  Object.defineProperty(chain, "_status", { get: () => state._status });
  Object.defineProperty(chain, "_body", { get: () => state._body });
  Object.defineProperty(chain, "_headers", { get: () => state._headers });
  Object.defineProperty(chain, "_redirectUrl", {
    get: () => state._redirectUrl,
  });

  return chain as unknown as MockRes;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("api/auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ── Scenario: Missing env vars → 500 HTML error ─────────────────────────

  describe("missing environment variables", () => {
    it("returns 500 HTML error when GITHUB_CLIENT_ID is unset", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "secret-value");
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq();
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._status).toBe(500);
      expect(res._headers["Content-Type"]).toContain("text/html");
      expect(res._body).toContain("GITHUB_CLIENT_ID");
    });

    it("returns 500 HTML error when GITHUB_CLIENT_SECRET is unset", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "client-id");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "");
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq();
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._status).toBe(500);
      expect(res._headers["Content-Type"]).toContain("text/html");
      expect(res._body).toContain("GITHUB_CLIENT_SECRET");
    });
  });

  // ── Scenario: No code param → 302 redirect to GitHub authorize ──────────

  describe("no code param — redirect to GitHub", () => {
it("returns 302 redirect to GitHub authorize URL", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "test-client-id");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "test-test-secret");
      vi.stubEnv("ALLOWED_ORIGINS", "https://example.com");
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq({
        headers: { "x-forwarded-proto": "https", host: "example.com" },
      });
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._status).toBe(302);
      expect(res._redirectUrl).toContain(
        "https://github.com/login/oauth/authorize",
      );
      expect(res._redirectUrl).toContain("client_id=test-client-id");
      expect(res._redirectUrl).toContain("scope=repo");
      expect(res._redirectUrl).toContain("redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Fauth");
    });

    it("uses x-forwarded-proto and host to build redirect_uri", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "cid");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "csec");
      vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:3000");
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq({
        headers: { "x-forwarded-proto": "http", host: "localhost:3000" },
      });
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._redirectUrl).toContain(
        "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth",
      );
    });
  });

  // ── Scenario: Successful token exchange → HTML with string postMessage ──

  describe("with valid code — token exchange", () => {
    it("returns HTML with authorizing:github handshake message", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "cid");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "csec");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ access_token: "gh_token_abc123" }),
      }));
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq({
        query: { code: "auth-code-xyz" },
        headers: { host: "example.com" },
      });
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._status).toBe(200);
      expect(res._headers["Content-Type"]).toContain("text/html");
      // Must contain the handshake message
      expect(res._body).toContain('postMessage("authorizing:github"');
      // Must contain the success message with token
      expect(res._body).toContain(
        'postMessage("authorization:github:success:',
      );
      // Must contain the token value and provider inside the JS object literal
      // (JSON.stringify runs client-side, so keys are unquoted in the source)
      expect(res._body).toContain('"gh_token_abc123"');
      expect(res._body).toContain('provider: "github"');
      // Must close the window
      expect(res._body).toContain("window.close()");
    });

    it("sends correct token exchange POST to GitHub", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "my-client");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "my-secret");
      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ access_token: "tok" }),
      });
      vi.stubGlobal("fetch", mockFetch);
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq({
        query: { code: "code-123" },
        headers: { host: "test.example" },
      });
      const res = mockRes();

      await handler(req as never, res as never);

      // Verify fetch was called with correct params
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://github.com/login/oauth/access_token");
      expect(options.method).toBe("POST");
      expect(options.headers["Content-Type"]).toBe("application/json");
      expect(options.headers.Accept).toBe("application/json");

      const body = JSON.parse(options.body);
      expect(body.client_id).toBe("my-client");
      expect(body.client_secret).toBe("my-secret");
      expect(body.code).toBe("code-123");
    });
  });

  // ── Scenario: Token exchange failure → HTML error page ──────────────────

  describe("token exchange failure", () => {
    it("returns HTML error page when GitHub returns an error", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "cid");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "csec");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ error: "bad_verification_code" }),
      }));
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq({
        query: { code: "bad-code" },
        headers: { host: "example.com" },
      });
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._status).toBe(400);
      expect(res._headers["Content-Type"]).toContain("text/html");
      expect(res._body).toContain("bad_verification_code");
    });

    it("returns HTML error page when fetch throws", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "cid");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "csec");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq({
        query: { code: "code" },
        headers: { host: "example.com" },
      });
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._status).toBe(500);
      expect(res._headers["Content-Type"]).toContain("text/html");
      expect(res._body).toContain("network error");
    });
  });

  // ── Scenario: Non-GET method ────────────────────────────────────────────

  describe("method validation", () => {
    it("returns 405 when method is not GET", async () => {
      vi.stubEnv("GITHUB_CLIENT_ID", "cid");
      vi.stubEnv("GITHUB_CLIENT_SECRET", "csec");
      vi.resetModules();

      const { default: handler } = await import("../../api/auth");
      const req = mockReq({ method: "POST" });
      const res = mockRes();

      await handler(req as never, res as never);

      expect(res._status).toBe(405);
    });
  });
});
