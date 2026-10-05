import { ADDRESSBOOK_NAME_MAX_LENGTH, UpsertContactDto } from './upsert-contact.dto';

const property = (name: string) =>
  Reflect.getMetadata('swagger/apiModelProperties', UpsertContactDto.prototype, name) as {
    minLength?: number;
    maxLength?: number;
  };

// The validator refuses an empty first name; the contract has to publish the same bound, or a
// generated client accepts input the server then refuses.
describe('UpsertContactDto contract', () => {
  it('publishes the firstName length bounds the validator enforces', () => {
    expect(property('firstName')).toMatchObject({ minLength: 1, maxLength: ADDRESSBOOK_NAME_MAX_LENGTH });
  });
});
