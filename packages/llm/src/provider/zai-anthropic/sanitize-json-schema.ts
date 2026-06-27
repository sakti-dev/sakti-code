import type { JSONSchema7, JSONSchema7Definition } from "@ai-sdk/provider";

/**
 * # sanitizeJsonSchema — strip JSON Schema keywords Anthropic rejects
 *
 * Ported verbatim from `@ai-sdk/anthropic/sanitize-json-schema.ts`. Z.ai
 * surfaces the same constrained-decoder as Anthropic, so the same keywords
 * (`format`, `$ref`/`$schema` handling, constraint relocation into the
 * `description`) need to be normalized before sending `input_schema` /
 * `output_config.format.schema`.
 *
 * The full original schema is still used by AI SDK result validation; this
 * only relaxes the schema sent to Z.ai's constrained decoder.
 */

const SUPPORTED_STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

const DESCRIPTION_CONSTRAINT_KEYS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "not",
] satisfies Array<keyof JSONSchema7>;

export function sanitizeJsonSchema(schema: JSONSchema7): JSONSchema7 {
  return sanitizeSchema(schema) as JSONSchema7;
}

function sanitizeDefinition(
  definition: JSONSchema7Definition
): JSONSchema7Definition {
  if (typeof definition === "boolean" || !isPlainObject(definition)) {
    return definition;
  }
  return sanitizeSchema(definition as JSONSchema7);
}

function sanitizeSchema(schema: JSONSchema7): JSONSchema7 {
  if (schema.$ref != null) {
    return { $ref: schema.$ref };
  }
  const result: JSONSchema7 = {};
  copyScalarFields(schema, result);
  copyCompositionFields(schema, result);
  copyDefinitionsFields(schema, result);
  copyObjectFields(schema, result);
  copyItemsField(schema, result);
  copyFormatField(schema, result);

  const constraintDescription = getConstraintDescription(schema);
  if (constraintDescription != null) {
    result.description =
      result.description == null
        ? constraintDescription
        : `${result.description}\n${constraintDescription}`;
  }
  return result;
}

function copyScalarFields(schema: JSONSchema7, result: JSONSchema7): void {
  if (schema.$schema != null) {
    result.$schema = schema.$schema;
  }
  if (schema.$id != null) {
    result.$id = schema.$id;
  }
  if (schema.title != null) {
    result.title = schema.title;
  }
  if (schema.description != null) {
    result.description = schema.description;
  }
  if (schema.default !== undefined) {
    result.default = schema.default;
  }
  if (schema.const !== undefined) {
    result.const = schema.const;
  }
  if (schema.enum != null) {
    result.enum = schema.enum;
  }
  if (schema.type != null) {
    result.type = schema.type;
  }
}

function copyCompositionFields(schema: JSONSchema7, result: JSONSchema7): void {
  if (schema.anyOf != null) {
    result.anyOf = schema.anyOf.map(sanitizeDefinition);
  } else if (schema.oneOf != null) {
    result.anyOf = schema.oneOf.map(sanitizeDefinition);
  }
  if (schema.allOf != null) {
    result.allOf = schema.allOf.map(sanitizeDefinition);
  }
}

function copyDefinitionsFields(schema: JSONSchema7, result: JSONSchema7): void {
  if (schema.definitions != null) {
    result.definitions = Object.fromEntries(
      Object.entries(schema.definitions).map(([name, definition]) => [
        name,
        sanitizeDefinition(definition),
      ])
    );
  }
  const schemaWithDefs = schema as JSONSchema7 & {
    $defs?: Record<string, JSONSchema7Definition>;
  };
  if (schemaWithDefs.$defs != null) {
    const resultWithDefs = result as JSONSchema7 & {
      $defs?: Record<string, JSONSchema7Definition>;
    };
    resultWithDefs.$defs = Object.fromEntries(
      Object.entries(schemaWithDefs.$defs).map(([name, definition]) => [
        name,
        sanitizeDefinition(definition),
      ])
    );
  }
}

function copyObjectFields(schema: JSONSchema7, result: JSONSchema7): void {
  if (schema.type !== "object" && schema.properties == null) {
    return;
  }
  if (schema.properties != null) {
    result.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([name, definition]) => [
        name,
        sanitizeDefinition(definition),
      ])
    );
  }
  result.additionalProperties = false;
  if (schema.required != null) {
    result.required = schema.required;
  }
}

function copyItemsField(schema: JSONSchema7, result: JSONSchema7): void {
  if (schema.items == null) {
    return;
  }
  result.items = Array.isArray(schema.items)
    ? schema.items.map(sanitizeDefinition)
    : sanitizeDefinition(schema.items);
}

function copyFormatField(schema: JSONSchema7, result: JSONSchema7): void {
  if (
    typeof schema.format === "string" &&
    SUPPORTED_STRING_FORMATS.has(schema.format)
  ) {
    result.format = schema.format;
  }
}

function getConstraintDescription(schema: JSONSchema7): string | undefined {
  const descriptions = DESCRIPTION_CONSTRAINT_KEYS.flatMap((key) => {
    const value = schema[key];
    if (value == null || value === false) {
      return [];
    }
    return `${formatConstraintName(key)}: ${formatConstraintValue(value)}`;
  });
  if (
    typeof schema.format === "string" &&
    !SUPPORTED_STRING_FORMATS.has(schema.format)
  ) {
    descriptions.push(`format: ${schema.format}`);
  }
  return descriptions.length === 0 ? undefined : `${descriptions.join("; ")}.`;
}

function formatConstraintName(key: string): string {
  return key.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`);
}

function formatConstraintValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
