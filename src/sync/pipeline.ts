import { renderSessionMarkdown } from "../domain/markdown";
import { redactText, type RedactionOptions } from "../domain/redact";
import type { NormalizedSession } from "../domain/session";
import type { PreparedSession } from "../drive/upload-service";

export interface MediaArchivePort {
  archive(session: NormalizedSession): Promise<{
    session: NormalizedSession;
    warnings: Array<{ code: string; url: string }>;
  }>;
}

export interface SessionPreparePort {
  prepare(session: NormalizedSession): Promise<PreparedSession>;
}

export class SessionPipeline implements SessionPreparePort {
  constructor(
    private readonly media: MediaArchivePort,
    private readonly redaction: RedactionOptions = {},
  ) {}

  async prepare(session: NormalizedSession): Promise<PreparedSession> {
    const archived = await this.media.archive(session);
    let redactionCount = 0;
    const redact = (value: string): string => {
      const result = redactText(value, this.redaction);
      redactionCount += result.count;
      return result.text;
    };
    const redacted: NormalizedSession = {
      ...archived.session,
      ...(archived.session.title === undefined
        ? {}
        : { title: redact(archived.session.title) }),
      ...(archived.session.workspaceId === undefined
        ? {}
        : { workspaceId: redact(archived.session.workspaceId) }),
      ...(archived.session.sourceUrl === undefined
        ? {}
        : { sourceUrl: redact(archived.session.sourceUrl) }),
      turns: archived.session.turns.map((turn) => ({
        ...turn,
        text: redact(turn.text),
        media: turn.media.map((item) => ({
          ...item,
          url: redact(item.url),
          ...(item.name === undefined ? {} : { name: redact(item.name) }),
        })),
      })),
    };
    const rendered = await renderSessionMarkdown(redacted, {
      redactionVersion: 1,
      redactionCount,
    });
    return {
      session: redacted,
      markdown: rendered.markdown,
      contentSha256: rendered.contentSha256,
    };
  }
}
