/**
 * Default base URL for the Z.ai general API endpoint.
 */
export const DEFAULT_GENERAL_BASE_URL = "https://api.z.ai/api/paas/v4" as const;

/**
 * Default base URL for the Z.ai coding API endpoint.
 */
export const DEFAULT_CODING_BASE_URL = "https://api.z.ai/api/coding/paas/v4" as const;

/**
 * Default base URL for the Z.ai China (Zhipu) API endpoint.
 */
export const DEFAULT_CHINA_BASE_URL = "https://open.bigmodel.cn/api/paas/v4" as const;

/**
 * Default x-source-channel header value.
 */
export const DEFAULT_SOURCE_CHANNEL = "typescript-sdk" as const;

/**
 * Default Accept-Language header value.
 */
export const DEFAULT_ACCEPT_LANGUAGE = "en-US,en" as const;
