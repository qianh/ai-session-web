import { z } from "zod";

export const WEB_SESSION_SOURCES = [
  "claude-web",
  "chatgpt-web",
  "gemini-web",
  "grok-web",
] as const;

export const WebSessionSourceSchema = z.enum(WEB_SESSION_SOURCES);
export type WebSessionSource = z.infer<typeof WebSessionSourceSchema>;

export const MediaRefSchema = z.object({
  kind: z.enum(["image", "attachment"]),
  url: z.url(),
  name: z.string().min(1).optional(),
  mimeType: z.string().min(1).optional(),
  sizeBytes: z.int().nonnegative().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  drivePath: z.string().min(1).optional(),
});

export type MediaRef = z.infer<typeof MediaRefSchema>;

export const TurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  media: z.array(MediaRefSchema),
});

export type Turn = z.infer<typeof TurnSchema>;

const IsoTimestampSchema = z.iso.datetime({ offset: true });

export const NormalizedSessionSchema = z
  .object({
    source: WebSessionSourceSchema,
    conversationId: z.string().min(1),
    device: z.string().min(1),
    title: z.string().optional(),
    workspaceId: z.string().min(1).optional(),
    sourceUrl: z.url().optional(),
    startedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
    turns: z.array(TurnSchema).min(1),
    warnings: z.array(z.string()),
  })
  .refine((session) => session.updatedAt >= session.startedAt, {
    message: "updatedAt must not precede startedAt",
    path: ["updatedAt"],
  });

export type NormalizedSession = z.infer<typeof NormalizedSessionSchema>;
