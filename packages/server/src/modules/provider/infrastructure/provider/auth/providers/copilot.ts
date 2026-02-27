import type { ProviderAuthDefinition } from "../definition";

const CLIENT_ID = "Ov23li8tweQw6odWQebz";

interface DeviceCodeResponse {
  verification_uri?: string;
  user_code?: string;
  device_code?: string;
  interval?: number;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
}

function normalizeDomain(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function urlsForDomain(domain: string) {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
  };
}

async function readOAuthError(response: Response): Promise<string> {
  const fallback = `oauth_http_${response.status}`;
  try {
    const payload = (await response.json()) as { error?: string; error_description?: string };
    const code = payload.error ?? fallback;
    const detail = payload.error_description ? `: ${payload.error_description}` : "";
    return `${code}${detail}`;
  } catch {
    return fallback;
  }
}

export function createGitHubCopilotProviderAuthDefinition(): ProviderAuthDefinition {
  return {
    providerId: "github-copilot",
    methods: [
      {
        type: "oauth",
        label: "Login with GitHub Copilot",
        prompts: [
          {
            type: "select",
            key: "deploymentType",
            message: "Select GitHub deployment type",
            options: [
              {
                label: "GitHub.com",
                value: "github.com",
                hint: "Public",
              },
              {
                label: "GitHub Enterprise",
                value: "enterprise",
                hint: "Data residency or self-hosted",
              },
            ],
          },
          {
            type: "text",
            key: "enterpriseUrl",
            message: "Enter your GitHub Enterprise URL or domain",
            placeholder: "company.ghe.com or https://company.ghe.com",
          },
        ],
        async authorize(inputs = {}) {
          const deploymentType = String(inputs.deploymentType ?? "github.com");
          const enterpriseUrl =
            deploymentType === "enterprise" && typeof inputs.enterpriseUrl === "string"
              ? inputs.enterpriseUrl
              : undefined;
          const domain =
            deploymentType === "enterprise" && enterpriseUrl
              ? normalizeDomain(enterpriseUrl)
              : "github.com";
          const urls = urlsForDomain(domain);

          const deviceResponse = await fetch(urls.deviceCodeUrl, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              client_id: CLIENT_ID,
              scope: "read:user",
            }),
          });

          if (!deviceResponse.ok) {
            throw new Error(`Copilot OAuth init failed: ${await readOAuthError(deviceResponse)}`);
          }

          const device = (await deviceResponse.json()) as DeviceCodeResponse;
          if (!device.device_code || !device.verification_uri) {
            throw new Error("Copilot OAuth init failed: missing_device_flow_fields");
          }

          return {
            method: "auto" as const,
            url: device.verification_uri,
            instructions: device.user_code
              ? `Enter code: ${device.user_code}`
              : "Complete login in browser.",
            callback: async () => {
              const response = await fetch(urls.accessTokenUrl, {
                method: "POST",
                headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  client_id: CLIENT_ID,
                  device_code: device.device_code,
                  grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                }),
              });

              if (!response.ok) {
                throw new Error(`Copilot OAuth polling failed: ${await readOAuthError(response)}`);
              }

              const data = (await response.json()) as AccessTokenResponse;
              if (data.access_token) {
                return {
                  type: "connected" as const,
                  payload: {
                    accessToken: data.access_token,
                    refreshToken: data.access_token,
                    expiresAt: Date.now() + 60 * 60 * 1000,
                  },
                };
              }

              if (data.error === "authorization_pending" || data.error === "slow_down") {
                return { type: "pending" as const };
              }

              throw new Error(
                `Copilot OAuth callback failed: ${data.error ?? "unknown_oauth_error"}`
              );
            },
          };
        },
      },
    ],
  };
}
