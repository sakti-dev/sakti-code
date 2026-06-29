import { describe, expect, it } from "vite-plus/test";
import { ZaiLanguageModel } from "../zai-language-model.ts";

describe("ZaiLanguageModel.doGenerate", () => {
  it("POSTs to {baseURL}/messages and maps the response", async () => {
    let postedUrl = "";
    let postedBody: unknown;
    const fakeFetch = (async (
      url: string,
      init: { body?: string }
    ): Promise<Response> => {
      postedUrl = url;
      postedBody = JSON.parse(init.body ?? "{}");
      return new Response(
        JSON.stringify({
          id: "msg_1",
          model: "glm-5.2",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "hello" }],
          usage: { input_tokens: 10, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const model = new ZaiLanguageModel("glm-5.2", {
      baseURL: "https://api.z.ai/api/anthropic",
      provider: "zai.messages",
      headers: async () => ({ "x-api-key": "k" }),
      fetch: fakeFetch,
    });

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });

    expect(postedUrl).toBe("https://api.z.ai/api/anthropic/v1/messages");
    expect((postedBody as { model: string }).model).toBe("glm-5.2");
    expect(result.content[0]).toMatchObject({ type: "text", text: "hello" });
    expect(result.finishReason.unified).toBe("stop");
  });
});
