import protobuf from 'protobufjs';
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ToolError } from '../shared/tool-error';
import { decodeWireFormat, decodeWithSchema, listMessageTypes } from './logic';

const PERSON_PROTO = `
syntax = "proto3";
package tutorial;

message Person {
  string name = 1;
  int32 id = 2;
  message PhoneNumber {
    string number = 1;
  }
  repeated PhoneNumber phones = 3;
}
`;

function encodePerson(payload: {
  name: string;
  id: number;
  phones?: { number: string }[];
}): Uint8Array {
  const root = protobuf.parse(PERSON_PROTO).root;
  const Person = root.lookupType('tutorial.Person');
  const message = Person.create(payload);
  return Person.encode(message).finish();
}

describe('listMessageTypes', () => {
  it('lists a top-level message', async () => {
    expect(await listMessageTypes(PERSON_PROTO)).toContain('tutorial.Person');
  });

  it('lists a nested message with its dotted path', async () => {
    expect(await listMessageTypes(PERSON_PROTO)).toContain('tutorial.Person.PhoneNumber');
  });

  it('throws a ToolError for unparsable .proto source', async () => {
    await expect(listMessageTypes('message {{{ not proto')).rejects.toMatchObject({
      code: 'invalidProto',
    });
  });
});

describe('decodeWithSchema', () => {
  it('decodes a payload using field names from the .proto', async () => {
    const bytes = encodePerson({ name: 'Ada Lovelace', id: 1 });
    const result = await decodeWithSchema(PERSON_PROTO, bytes, 'tutorial.Person');
    expect(result).toMatchObject({ name: 'Ada Lovelace', id: 1 });
  });

  it('decodes repeated nested messages', async () => {
    const bytes = encodePerson({
      name: 'Grace Hopper',
      id: 2,
      phones: [{ number: '555-0100' }, { number: '555-0101' }],
    });
    const result = await decodeWithSchema(PERSON_PROTO, bytes, 'tutorial.Person');
    expect(result.phones).toEqual([{ number: '555-0100' }, { number: '555-0101' }]);
  });

  it('throws a ToolError when the message type does not exist', async () => {
    const bytes = encodePerson({ name: 'x', id: 1 });
    await expect(
      decodeWithSchema(PERSON_PROTO, bytes, 'tutorial.NoSuchType'),
    ).rejects.toMatchObject({ code: 'typeNotFound' });
  });

  it('throws a ToolError for unparsable .proto source', async () => {
    await expect(
      decodeWithSchema('message {{{ not proto', new Uint8Array([0]), 'x'),
    ).rejects.toMatchObject({ code: 'invalidProto' });
  });

  it('throws a ToolError, not a raw crash, for a payload that does not fit the schema', async () => {
    // Declares a length-delimited field 1 with length 50 but supplies only one more byte.
    const truncated = new Uint8Array([0x0a, 50, 0x00]);
    await expect(
      decodeWithSchema(PERSON_PROTO, truncated, 'tutorial.Person'),
    ).rejects.toMatchObject({ code: 'decodeFailed' });
  });
});

describe('re-exported blind decoder', () => {
  it('is reachable from logic.ts too', () => {
    expect(() => decodeWireFormat(new Uint8Array())).toThrow(ToolError);
  });
});
