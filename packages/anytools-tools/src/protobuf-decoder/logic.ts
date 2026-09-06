import { ToolError } from '../shared/tool-error';

export type { DecodedField, Guess, WireType } from './wire-format';
export { decodeWireFormat } from './wire-format';

type ProtobufModule = typeof import('protobufjs');
type ProtoRoot = import('protobufjs').Root;
type ProtoType = import('protobufjs').Type;

/**
 * ~300 KB of JavaScript for full `.proto`-text parsing, so it is loaded only once someone
 * actually pastes a schema. Node's ESM loader only surfaces `default` through protobufjs's
 * CommonJS entry, while a bundler hands back the namespace directly — same shape mismatch
 * xlsx-to-csv hit with exceljs, same fix.
 */
async function loadProtobuf(): Promise<ProtobufModule> {
  const mod = (await import('protobufjs')) as ProtobufModule & { default?: ProtobufModule };
  return mod.default ?? mod;
}

function parseProtoOrThrow(protobuf: ProtobufModule, protoSource: string): ProtoRoot {
  try {
    return protobuf.parse(protoSource).root;
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Parse error';
    throw new ToolError('invalidProto', `.proto source could not be parsed: ${detail}`, {
      detail,
    });
  }
}

/** Every message type declared in the .proto, dotted (`Package.Message.Nested`). */
export async function listMessageTypes(protoSource: string): Promise<string[]> {
  const protobuf = await loadProtobuf();
  const root = parseProtoOrThrow(protobuf, protoSource);
  const names: string[] = [];
  const walk = (ns: { nestedArray: unknown[] }) => {
    for (const obj of ns.nestedArray) {
      if (obj instanceof protobuf.Type) names.push(obj.fullName.replace(/^\./, ''));
      if (obj instanceof protobuf.Type || obj instanceof protobuf.Namespace) {
        walk(obj as unknown as { nestedArray: unknown[] });
      }
    }
  };
  walk(root as unknown as { nestedArray: unknown[] });
  return names;
}

/** Decode `bytes` as `messageType` from the given `.proto` source, field names and all. */
export async function decodeWithSchema(
  protoSource: string,
  bytes: Uint8Array,
  messageType: string,
): Promise<Record<string, unknown>> {
  const protobuf = await loadProtobuf();
  const root = parseProtoOrThrow(protobuf, protoSource);

  let type: ProtoType;
  try {
    type = root.lookupType(messageType);
  } catch {
    throw new ToolError(
      'typeNotFound',
      `Message type "${messageType}" was not found in the .proto source.`,
      { messageType },
    );
  }

  try {
    const message = type.decode(bytes);
    return type.toObject(message, { longs: String, enums: String, bytes: String, defaults: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Decode error';
    throw new ToolError(
      'decodeFailed',
      `This payload does not decode as ${messageType}: ${detail}`,
      { messageType, detail },
    );
  }
}
