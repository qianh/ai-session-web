import { sha256Hex } from "./hash";
import type { MediaRef, NormalizedSession } from "./session";

export interface RenderOptions {
  redactionVersion: number;
  redactionCount: number;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function renderMedia(media: MediaRef): string {
  const target = media.drivePath ?? media.url;
  if (media.kind === "image") return `![](${target})`;
  return `[${media.name ?? "attachment"}](${target})`;
}

export async function renderSessionMarkdown(
  session: NormalizedSession,
  options: RenderOptions,
): Promise<{ markdown: string; contentSha256: string }> {
  const body = session.turns
    .map((turn) => {
      const content = [turn.text, ...turn.media.map(renderMedia)]
        .filter(Boolean)
        .join("\n\n");
      return `## ${turn.role === "user" ? "User" : "Assistant"}\n${content}`;
    })
    .join("\n\n");
  const optionalMetadata = [
    session.title === undefined ? null : `title: ${yamlString(session.title)}`,
    session.workspaceId === undefined
      ? null
      : `workspace_id: ${yamlString(session.workspaceId)}`,
    session.sourceUrl === undefined
      ? null
      : `source_url: ${yamlString(session.sourceUrl)}`,
    session.warnings.length === 0
      ? null
      : `warnings: ${JSON.stringify(session.warnings)}`,
  ].filter((line): line is string => line !== null);
  const canonical = [
    `source: ${session.source}`,
    `conversation_id: ${session.conversationId}`,
    `device: ${session.device}`,
    `started_at: ${session.startedAt}`,
    `updated_at: ${session.updatedAt}`,
    `turn_count: ${session.turns.length}`,
    ...optionalMetadata,
    `redaction_version: ${options.redactionVersion}`,
    `redaction_count: ${options.redactionCount}`,
    "---",
    body,
    "",
  ].join("\n");
  const contentSha256 = await sha256Hex(canonical);
  const markdown = `---\n${canonical.replace(
    "---\n",
    `content_sha256: ${contentSha256}\n---\n`,
  )}`;
  return { markdown, contentSha256 };
}
