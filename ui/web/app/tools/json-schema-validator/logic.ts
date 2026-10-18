import { ToolError } from '../shared/tool-error';

export type SchemaDraft = 'draft-07' | '2020-12';

export type ValidationIssue = {
  instancePath: string;
  message: string;
  params: Record<string, unknown>;
};

export type ValidationResult = { valid: true } | { valid: false; errors: ValidationIssue[] };

function parseJsonOrThrow(text: string, code: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Parse error';
    throw new ToolError(code, `${label} is not valid JSON: ${detail}`, { detail });
  }
}

/**
 * ajv compiles schemas with `new Function` (its README, "Validation and compiling schemas").
 * The page's CSP has no `unsafe-eval`, so the UI calls this inside a worker, where it runs
 * unmodified (validator-protocol.ts says why that worker may eval). Node and the tests call it
 * directly.
 */
async function compileValidator(schema: unknown, draft: SchemaDraft) {
  if (draft === '2020-12') {
    const { default: Ajv2020 } = await import('ajv/dist/2020');
    return new Ajv2020({ allErrors: true, strict: false }).compile(schema as object);
  }
  const { default: Ajv } = await import('ajv');
  return new Ajv({ allErrors: true, strict: false }).compile(schema as object);
}

export async function validateAgainstSchema(
  schemaText: string,
  dataText: string,
  draft: SchemaDraft,
): Promise<ValidationResult> {
  const schema = parseJsonOrThrow(schemaText, 'invalidSchemaJson', 'Schema');
  const data = parseJsonOrThrow(dataText, 'invalidDataJson', 'Data');

  let validate: Awaited<ReturnType<typeof compileValidator>>;
  try {
    validate = await compileValidator(schema, draft);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Could not compile schema';
    throw new ToolError('schemaCompileError', `Schema is not valid JSON Schema: ${detail}`, {
      detail,
    });
  }

  if (validate(data)) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => ({
      instancePath: e.instancePath || '/',
      message: e.message ?? 'Invalid value',
      params: e.params ?? {},
    })),
  };
}

export { inferSchema } from './schema-inference';
