import * as wsModuleNs from "ws";

const wsModule = wsModuleNs as unknown as {
  WebSocket?: unknown;
  default?: {
    WebSocket?: unknown;
  } & Record<string, unknown>;
};

const resolvedWebSocket =
  wsModule.WebSocket ?? wsModule.default?.WebSocket ?? wsModule.default ?? wsModuleNs;

export const WebSocket = resolvedWebSocket as typeof wsModuleNs;
export default resolvedWebSocket as typeof wsModuleNs;
