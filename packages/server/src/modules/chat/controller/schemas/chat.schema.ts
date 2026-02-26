import { z } from "zod";

export const chatMessageSchema = z.object({
  message: z.union([
    z.string(),
    z.object({
      content: z.array(
        z.object({
          type: z.enum(["text", "image", "image_url", "file"]),
          text: z.string().optional(),
          url: z.string().optional(),
          image: z.union([z.string(), z.object({ url: z.string() })]).optional(),
          mediaType: z.string().optional(),
        })
      ),
    }),
  ]),
  messageId: z.string().optional(),
  retryOfAssistantMessageId: z.string().optional(),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  runtimeMode: z.enum(["intake", "plan", "build"]).optional(),
  stream: z.boolean().optional().default(true),
});

export const sessionMessagesSchema = z.object({
  limit: z.coerce.number().min(1).max(1000).default(100),
  offset: z.coerce.number().min(0).default(0),
});
