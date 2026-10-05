import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBulkRecipients } from './bulkRecipients.ts';

test('parses one recipient per line, trimming whitespace and dropping blanks', () => {
  const text = '  +62 812-3456-78  \n\n628987654321@c.us\n   \n1203630000@g.us';
  assert.deepEqual(parseBulkRecipients(text), ['62812345678@c.us', '628987654321@c.us', '1203630000@g.us']);
});

test('normalizes bare phone numbers to @c.us chat IDs', () => {
  assert.deepEqual(parseBulkRecipients('+1 (555) 010-2233'), ['15550102233@c.us']);
});

test('passes full chat IDs through untouched', () => {
  assert.deepEqual(parseBulkRecipients('123@lid\n4567890-1234@g.us'), ['123@lid', '4567890-1234@g.us']);
});

test('splits on CRLF and on bare CR, which an uploaded file can carry', () => {
  const expected = ['628111222333@c.us', '628222333444@c.us'];
  assert.deepEqual(parseBulkRecipients('628111222333\r\n628222333444'), expected);
  assert.deepEqual(parseBulkRecipients('628111222333\r628222333444'), expected);
});

test('de-dupes entries that normalize to the same chat ID', () => {
  const text = '+62 812 3456 78\n62812345678\n62812345678@c.us';
  assert.deepEqual(parseBulkRecipients(text), ['62812345678@c.us']);
});

test('drops lines with neither an @ nor any digits instead of sending "@c.us"', () => {
  assert.deepEqual(parseBulkRecipients('not-a-number\n---\n628123456789'), ['628123456789@c.us']);
});

test('returns an empty list for empty input', () => {
  assert.deepEqual(parseBulkRecipients(''), []);
  assert.deepEqual(parseBulkRecipients('  \n \n'), []);
});

// A real spreadsheet export. The digit strip used to run over the WHOLE line, so the index column
// and the number were concatenated into a different number that still looked plausible.
test('a multi-column CSV row yields the phone column, not the columns concatenated', () => {
  const csv = 'id,phone\n1,628123456789\n2,628987654321';
  assert.deepEqual(parseBulkRecipients(csv), ['628123456789@c.us', '628987654321@c.us']);
});

test('a comma-separated list on one line is several recipients', () => {
  assert.deepEqual(parseBulkRecipients('628111222333, 628222333444'), ['628111222333@c.us', '628222333444@c.us']);
});

test('semicolon and tab separate entries too', () => {
  assert.deepEqual(parseBulkRecipients('628111222333;628222333444'), ['628111222333@c.us', '628222333444@c.us']);
  assert.deepEqual(parseBulkRecipients('628111222333\t628222333444'), ['628111222333@c.us', '628222333444@c.us']);
});

// The formatting characters must NOT split: this is one number, and the existing test above pins it.
test('phone formatting is not a field separator', () => {
  assert.deepEqual(parseBulkRecipients('+62 (812) 345-6789'), ['628123456789@c.us']);
});

test('a chat ID sitting in a CSV column still passes through', () => {
  assert.deepEqual(parseBulkRecipients('alice,4567890-1234@g.us'), ['4567890-1234@g.us']);
});

test('a number too short to be a phone is dropped rather than sent', () => {
  assert.deepEqual(parseBulkRecipients('12345'), []);
  assert.deepEqual(parseBulkRecipients('123456'), ['123456@c.us']);
});

// A contact export carries an email column next to the phone. Passing every '@' field through sent
// each address as a recipient that could only fail, and doubled the count held against the batch cap.
test('an @ field without a WhatsApp chat id shape is dropped, so an email column is not a recipient', () => {
  const csv = 'name,email,phone\nJohn,john@example.com,628123456789\nAmy,12345@qq.com,628987654321';
  assert.deepEqual(parseBulkRecipients(csv), ['628123456789@c.us', '628987654321@c.us']);
  assert.deepEqual(
    parseBulkRecipients('628123456789@s.whatsapp.net\n120363123456789@newsletter\n628123456789:12@lid'),
    ['628123456789@s.whatsapp.net', '120363123456789@newsletter', '628123456789:12@lid'],
  );
});
