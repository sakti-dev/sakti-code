/**
 * Schema validation and resolution diagnostics.
 *
 * Extracted from the removed `schema` command so `doctor` can report
 * schema health without a dedicated management UI.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  getProjectSchemasDir,
  getUserSchemasDir,
  getPackageSchemasDir,
} from './resolver.js';
import { parseSchema, SchemaValidationError } from './schema.js';

export type SchemaSource = 'project' | 'user' | 'package';

export interface SchemaLocation {
  source: SchemaSource;
  path: string;
  exists: boolean;
}

export interface SchemaResolution {
  name: string;
  source: SchemaSource;
  path: string;
  shadows: Array<{ source: SchemaSource; path: string }>;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Check all three locations (project/user/package) for a schema and
 * return which ones exist.
 */
export function checkSchemaLocations(
  name: string,
  projectRoot: string
): SchemaLocation[] {
  const locations: SchemaLocation[] = [];

  const projectDir = path.join(getProjectSchemasDir(projectRoot), name);
  locations.push({
    source: 'project',
    path: projectDir,
    exists: fs.existsSync(path.join(projectDir, 'schema.yaml')),
  });

  const userDir = path.join(getUserSchemasDir(), name);
  locations.push({
    source: 'user',
    path: userDir,
    exists: fs.existsSync(path.join(userDir, 'schema.yaml')),
  });

  const packageDir = path.join(getPackageSchemasDir(), name);
  locations.push({
    source: 'package',
    path: packageDir,
    exists: fs.existsSync(path.join(packageDir, 'schema.yaml')),
  });

  return locations;
}

/**
 * Resolve a schema name to its active location with shadow detection.
 * Returns null when no schema with this name exists in any location.
 */
export function resolveSchemaLocation(
  name: string,
  projectRoot: string
): SchemaResolution | null {
  const locations = checkSchemaLocations(name, projectRoot);
  const existing = locations.filter((loc) => loc.exists);

  if (existing.length === 0) {
    return null;
  }

  const active = existing[0];
  const shadows = existing.slice(1).map((loc) => ({
    source: loc.source,
    path: loc.path,
  }));

  return {
    name,
    source: active.source,
    path: active.path,
    shadows,
  };
}

/**
 * Validate a schema directory: schema.yaml parses, structure is valid,
 * and every artifact's template file exists. Dependency-graph and
 * reference validation happen inside parseSchema (it throws on cycles
 * and invalid references).
 */
export function validateSchema(schemaDir: string): SchemaValidationResult {
  const issues: ValidationIssue[] = [];
  const schemaPath = path.join(schemaDir, 'schema.yaml');

  if (!fs.existsSync(schemaPath)) {
    issues.push({
      level: 'error',
      path: 'schema.yaml',
      message: 'schema.yaml not found',
    });
    return { valid: false, issues };
  }

  let content: string;
  try {
    content = fs.readFileSync(schemaPath, 'utf-8');
  } catch (err) {
    issues.push({
      level: 'error',
      path: 'schema.yaml',
      message: `Failed to read file: ${(err as Error).message}`,
    });
    return { valid: false, issues };
  }

  try {
    const schema = parseSchema(content);

    for (const artifact of schema.artifacts) {
      const templateInTemplates = path.join(schemaDir, 'templates', artifact.template);
      const templateInRoot = path.join(schemaDir, artifact.template);

      if (!fs.existsSync(templateInTemplates) && !fs.existsSync(templateInRoot)) {
        issues.push({
          level: 'error',
          path: `artifacts.${artifact.id}.template`,
          message: `Template file '${artifact.template}' not found for artifact '${artifact.id}'`,
        });
      }
    }
  } catch (err) {
    const message =
      err instanceof SchemaValidationError
        ? err.message
        : `Parse error: ${(err as Error).message}`;
    issues.push({ level: 'error', path: 'schema.yaml', message });
  }

  return { valid: issues.length === 0, issues };
}
