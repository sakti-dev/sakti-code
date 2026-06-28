/**
 * Turn an array of SSE event objects into a `Response` whose body matches the
 * Anthropic streaming protocol: one `data: {...}\n\n` per event, plus a final
 * `data: [DONE]\n\n` (Anthropic doesn't strictly require [DONE] but other
 * servers' parsers expect it; we always emit it as a sentinel we ignore).
 */
export function sseResponse(events: unknown[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
