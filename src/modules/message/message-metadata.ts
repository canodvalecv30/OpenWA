import { IsNull, Not, Raw, type FindOptionsWhere, type Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/** Apply a metadata change to the current row without restoring a concurrent archive or revoke. */
export async function updateMessageMetadata(
  repository: Repository<Message>,
  where: FindOptionsWhere<Message>,
  change: (metadata: Record<string, unknown>) => Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const target = { ...where, type: Not('revoked') };
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await repository.findOne({ where: target });
    if (!row) return null;
    const snapshot = row.metadata;
    const metadata = change({ ...snapshot });
    const result = await repository.update(
      {
        ...target,
        metadata:
          snapshot == null ? IsNull() : Raw(column => `${column} = :snapshot`, { snapshot: JSON.stringify(snapshot) }),
      },
      { metadata: metadata as QueryDeepPartialEntity<Record<string, unknown>> },
    );
    if (result.affected) return metadata;
    // Another metadata writer won. Read its result before applying this change again.
  }
  throw new Error('Message metadata changed repeatedly during update');
}

/** An already archived echo keeps its media marker when the REST writer supplies inline bytes. */
export function mergeSentMetadata(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const media = current.media as { archived?: boolean; omitted?: boolean } | undefined;
  return { ...current, ...incoming, ...(media?.archived && media.omitted ? { media } : {}) };
}
