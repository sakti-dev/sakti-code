import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { ProviderAuthDefinition } from "../definition";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const CALLBACK_PATH = "/auth/callback";

interface DeviceAuthCodeResponse {
  device_auth_id: string;
  user_code: string;
  interval?: string;
}

interface DeviceAuthTokenResponse {
  authorization_code: string;
  code_verifier: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface BrowserTokenResponse extends OAuthTokenResponse {
  id_token?: string;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) return fallback;
  return value.trim();
}

function openAIOAuthConfig() {
  const issuer = env("SAKTI_CODE_OPENAI_OAUTH_ISSUER", ISSUER);
  const callbackPort = Number.parseInt(env("SAKTI_CODE_OPENAI_OAUTH_CALLBACK_PORT", "1455"), 10);
  return {
    issuer,
    clientId: env("SAKTI_CODE_OPENAI_OAUTH_CLIENT_ID", CLIENT_ID),
    redirectUri: env(
      "SAKTI_CODE_OPENAI_OAUTH_REDIRECT_URI",
      `http://127.0.0.1:${Number.isFinite(callbackPort) ? callbackPort : 1455}${CALLBACK_PATH}`
    ),
    callbackPort: Number.isFinite(callbackPort) ? callbackPort : 1455,
  };
}

function base64UrlEncode(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generatePKCE() {
  const verifier = base64UrlEncode(randomBytes(48));
  const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function generateState() {
  return base64UrlEncode(randomBytes(32));
}

interface BrowserOAuthStateEntry {
  code?: string;
  error?: string;
  token?: BrowserTokenResponse;
}

const browserOAuthState = new Map<string, BrowserOAuthStateEntry>();
let browserOAuthServer: Server | null = null;
let browserOAuthServerPort: number | null = null;

function htmlResponse(title: string, description: string): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${description}</p></body></html>`;
}

async function ensureBrowserOAuthServer(port: number) {
  if (browserOAuthServer && browserOAuthServerPort === port) return;
  if (browserOAuthServer && browserOAuthServerPort !== port) {
    await new Promise<void>(resolve => {
      browserOAuthServer?.close(() => resolve());
    });
    browserOAuthServer = null;
    browserOAuthServerPort = null;
  }

  browserOAuthServer = createServer((req, res) => {
    const requestURL = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (requestURL.pathname !== CALLBACK_PATH) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    const state = requestURL.searchParams.get("state");
    const code = requestURL.searchParams.get("code");
    const error = requestURL.searchParams.get("error");
    if (!state || !browserOAuthState.has(state)) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(htmlResponse("Authorization Failed", "Invalid OAuth state."));
      return;
    }

    const entry = browserOAuthState.get(state)!;
    if (error) {
      entry.error = error;
      browserOAuthState.set(state, entry);
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(htmlResponse("Authorization Failed", `OAuth error: ${error}`));
      return;
    }

    if (code) {
      entry.code = code;
      browserOAuthState.set(state, entry);
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      htmlResponse("Authorization Successful", "You can close this window and return to the app.")
    );
  });

  await new Promise<void>((resolve, reject) => {
    browserOAuthServer?.once("error", reject);
    browserOAuthServer?.listen(port, "127.0.0.1", () => {
      browserOAuthServer?.off("error", reject);
      resolve();
    });
  });
  browserOAuthServerPort = port;
}

function setBrowserOAuthStateForTest(state: string, input: BrowserOAuthStateEntry) {
  const current = browserOAuthState.get(state) ?? {};
  browserOAuthState.set(state, {
    ...current,
    ...input,
  });
}

function resetBrowserOAuthStateForTest() {
  browserOAuthState.clear();
}

export const __openAIOAuthTest = {
  setBrowserOAuthStateForTest,
  resetBrowserOAuthStateForTest,
};

export function createOpenAIProviderAuthDefinition(): ProviderAuthDefinition {
  const config = openAIOAuthConfig();

  return {
    providerId: "openai",
    methods: [
      {
        type: "oauth",
        label: "ChatGPT Pro/Plus (browser)",
        async authorize() {
          const pkce = generatePKCE();
          const state = generateState();
          browserOAuthState.set(state, {});
          const disableServer = env("SAKTI_CODE_OPENAI_OAUTH_DISABLE_LOCAL_SERVER", "0") === "1";
          if (!disableServer) {
            await ensureBrowserOAuthServer(config.callbackPort);
          }
          const params = new URLSearchParams({
            response_type: "code",
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            scope: "openid profile email offline_access",
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
            id_token_add_organizations: "true",
            codex_cli_simplified_flow: "true",
            state,
            originator: "opencode",
          });
          return {
            method: "auto" as const,
            url: `${config.issuer}/oauth/authorize?${params.toString()}`,
            instructions: "Complete authorization in your browser.",
            callback: async () => {
              const entry = browserOAuthState.get(state);
              if (!entry) return { type: "pending" as const };
              if (entry.error) {
                throw new Error(`OpenAI OAuth callback failed: ${entry.error}`);
              }
              if (!entry.code) {
                return { type: "pending" as const };
              }
              if (entry.token) {
                return {
                  type: "connected" as const,
                  payload: {
                    accessToken: entry.token.access_token!,
                    refreshToken: entry.token.refresh_token!,
                    expiresAt: Date.now() + (entry.token.expires_in ?? 3600) * 1000,
                  },
                };
              }

              const tokenResponse = await fetch(`${config.issuer}/oauth/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  code: entry.code,
                  redirect_uri: config.redirectUri,
                  client_id: config.clientId,
                  code_verifier: pkce.verifier,
                }).toString(),
              });

              if (!tokenResponse.ok) {
                throw new Error(
                  `OpenAI OAuth token exchange failed: oauth_http_${tokenResponse.status}`
                );
              }
              const tokens = (await tokenResponse.json()) as BrowserTokenResponse;
              if (!tokens.access_token || !tokens.refresh_token) {
                throw new Error("OpenAI OAuth token exchange failed: missing_tokens");
              }
              entry.token = tokens;
              browserOAuthState.set(state, entry);
              return {
                type: "connected" as const,
                payload: {
                  accessToken: tokens.access_token,
                  refreshToken: tokens.refresh_token,
                  expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                },
              };
            },
          };
        },
      },
      {
        type: "oauth",
        label: "ChatGPT Pro/Plus (headless)",
        async authorize() {
          const deviceResponse = await fetch(`${config.issuer}/api/accounts/deviceauth/usercode`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ client_id: config.clientId }),
          });

          if (!deviceResponse.ok) {
            throw new Error(`OpenAI OAuth init failed: oauth_http_${deviceResponse.status}`);
          }

          const device = (await deviceResponse.json()) as DeviceAuthCodeResponse;
          return {
            method: "auto" as const,
            url: `${config.issuer}/codex/device`,
            instructions: `Enter code: ${device.user_code}`,
            callback: async () => {
              const poll = await fetch(`${config.issuer}/api/accounts/deviceauth/token`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  device_auth_id: device.device_auth_id,
                  user_code: device.user_code,
                }),
              });

              if (poll.status === 403 || poll.status === 404) {
                return { type: "pending" as const };
              }

              if (!poll.ok) {
                throw new Error(`OpenAI OAuth polling failed: oauth_http_${poll.status}`);
              }

              const authCode = (await poll.json()) as DeviceAuthTokenResponse;
              const tokenResponse = await fetch(`${config.issuer}/oauth/token`, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  code: authCode.authorization_code,
                  redirect_uri: `${config.issuer}/deviceauth/callback`,
                  client_id: config.clientId,
                  code_verifier: authCode.code_verifier,
                }).toString(),
              });

              if (!tokenResponse.ok) {
                throw new Error(
                  `OpenAI OAuth token exchange failed: oauth_http_${tokenResponse.status}`
                );
              }

              const tokens = (await tokenResponse.json()) as OAuthTokenResponse;
              if (!tokens.access_token || !tokens.refresh_token) {
                throw new Error("OpenAI OAuth token exchange failed: missing_tokens");
              }

              return {
                type: "connected" as const,
                payload: {
                  accessToken: tokens.access_token,
                  refreshToken: tokens.refresh_token,
                  expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                },
              };
            },
          };
        },
      },
      {
        type: "api",
        label: "Manually enter API Key",
      },
    ],
    async refreshOAuthToken(input) {
      const tokenResponse = await fetch(`${config.issuer}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
          client_id: config.clientId,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        throw new Error(`OpenAI OAuth refresh failed: oauth_http_${tokenResponse.status}`);
      }

      const tokens = (await tokenResponse.json()) as OAuthTokenResponse;
      if (!tokens.access_token) {
        throw new Error("OpenAI OAuth refresh failed: missing_access_token");
      }

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      };
    },
  };
}
