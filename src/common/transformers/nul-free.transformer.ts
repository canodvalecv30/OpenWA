import { ValueTransformer } from 'typeorm';

/**
 * Drops U+0000 from free text on its way into a column. PostgreSQL rejects the character in text and
 * varchar, so a WhatsApp message, push name, caption or mimetype carrying one, or an error message
 * quoting one, failed its INSERT or UPDATE. Only for text that is never a lookup key: an id stored
 * without its NUL would stop matching the id the engine reports.
 */
export const NulFreeTransformer: ValueTransformer = {
  to: (value: unknown) => (typeof value === 'string' ? value.replaceAll('\u0000', '') : value),
  from: (value: unknown) => value,
};
