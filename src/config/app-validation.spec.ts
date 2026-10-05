import { BadRequestException } from '@nestjs/common';
import { NulBodyPipe } from './app-validation';
import { ImportDataDto } from '../modules/infra/dto/import-data.dto';
import { SendBulkMessageDto } from '../modules/message/dto/bulk-message.dto';

// PostgreSQL rejects U+0000 in every text and varchar value and bound parameter, so a body string
// holding one failed the lookup or write behind the route as a 500.
describe('NulBodyPipe', () => {
  const pipe = new NulBodyPipe();

  it('refuses a body holding a NUL character at any depth', () => {
    const body = { messages: [{ chatId: 'a@c.us', variables: { name: 'x\u0000' } }] };
    expect(() => pipe.transform(body, { type: 'body', metatype: SendBulkMessageDto })).toThrow(BadRequestException);
  });

  it('passes a body without one, and leaves the path and query to the URL refusal', () => {
    const body = { messages: [{ chatId: 'a@c.us', variables: { name: 'x' } }] };
    expect(pipe.transform(body, { type: 'body', metatype: SendBulkMessageDto })).toBe(body);
    expect(pipe.transform('x\u0000', { type: 'param', metatype: String, data: 'id' })).toBe('x\u0000');
  });

  // The restore writes backup rows verbatim, and a SQLite backup may hold a NUL in a stored message.
  it('lets a restore body through', () => {
    const backup = { tables: { messages: [{ body: 'a\u0000b' }] } };
    expect(pipe.transform(backup, { type: 'body', metatype: ImportDataDto })).toBe(backup);
  });
});
