/**
 * AST Query Tool - Type-aware TypeScript code queries
 *
 * Uses ts-morph for type-aware AST parsing, enabling rich code understanding
 * including type resolution, signature extraction, and reference finding.
 */

import { tool, zodSchema } from "ai";
import path from "node:path";
import { Project, ScriptTarget, SyntaxKind } from "ts-morph";
import { z } from "zod";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ASTResult = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "variable" | "reference";
  location: {
    file: string;
    line: number;
  };
  signature?: string;
  parameters?: Array<{
    name: string;
    type: string;
    optional: boolean;
  }>;
  returnType?: string;
  properties?: Array<{
    name: string;
    type: string;
  }>;
};

export type ASTQueryOutput = {
  results: ASTResult[];
};

// ============================================================================
// TS-MORPH PROJECT (Singleton)
// ============================================================================

let projectInstance: Project | null = null;

/**
 * Get or create the ts-morph Project singleton
 */
export function getOrCreateProject(repoPath: string): Project {
  if (!projectInstance) {
    projectInstance = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        skipLibCheck: true,
        skipDefaultLibCheck: true,
        esModuleInterop: true,
        target: ScriptTarget.Latest,
      },
    });
  }

  // Add directory if not already added
  const sourceFiles = projectInstance.getSourceFiles();
  const alreadyAdded = sourceFiles.some(sf => sf.getFilePath().startsWith(repoPath));

  if (!alreadyAdded) {
    projectInstance.addSourceFilesAtPaths(path.join(repoPath, "**/*.ts"));
    projectInstance.addSourceFilesAtPaths(path.join(repoPath, "**/*.tsx"));
    projectInstance.addSourceFilesAtPaths(path.join(repoPath, "**/*.d.ts"));
  }

  return projectInstance;
}

/**
 * Reset the project (useful for testing)
 */
export function resetTestProject(): void {
  if (projectInstance) {
    projectInstance = null;
  }
}

// Export for testing
export const _testProject = {
  reset: resetTestProject,
};

// ============================================================================
// AST QUERY FUNCTIONS
// ============================================================================

/**
 * Find all functions in a file or directory
 */
async function findFunctions(
  project: Project,
  repoPath: string,
  filePath?: string
): Promise<ASTQueryOutput> {
  const sourceFiles = filePath
    ? [project.getSourceFileOrThrow(filePath)]
    : project.getSourceFiles();
  const functions: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    for (const func of sourceFile.getFunctions()) {
      functions.push({
        name: func.getName() || "<anonymous>",
        kind: "function",
        location: {
          file: sourceFile.getFilePath().slice(repoPath.length + 1),
          line: func.getStartLineNumber(),
        },
        signature: func.getSignature()?.getDeclaration().getText(),
      });
    }
  }

  return { results: functions };
}

/**
 * Find all classes in a file or directory
 */
async function findClasses(
  project: Project,
  repoPath: string,
  filePath?: string
): Promise<ASTQueryOutput> {
  const sourceFiles = filePath
    ? [project.getSourceFileOrThrow(filePath)]
    : project.getSourceFiles();
  const classes: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    for (const cls of sourceFile.getClasses()) {
      classes.push({
        name: cls.getName() || "<anonymous>",
        kind: "class",
        location: {
          file: sourceFile.getFilePath().slice(repoPath.length + 1),
          line: cls.getStartLineNumber(),
        },
      });
    }
  }

  return { results: classes };
}

/**
 * Find all interfaces in a file or directory
 */
async function findInterfaces(
  project: Project,
  repoPath: string,
  filePath?: string
): Promise<ASTQueryOutput> {
  const sourceFiles = filePath
    ? [project.getSourceFileOrThrow(filePath)]
    : project.getSourceFiles();
  const interfaces: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    for (const iface of sourceFile.getInterfaces()) {
      interfaces.push({
        name: iface.getName() || "<anonymous>",
        kind: "interface",
        location: {
          file: sourceFile.getFilePath().slice(repoPath.length + 1),
          line: iface.getStartLineNumber(),
        },
      });
    }
  }

  return { results: interfaces };
}

/**
 * Find all type aliases in a file or directory
 */
async function findTypes(
  project: Project,
  repoPath: string,
  filePath?: string
): Promise<ASTQueryOutput> {
  const sourceFiles = filePath
    ? [project.getSourceFileOrThrow(filePath)]
    : project.getSourceFiles();
  const types: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    for (const typeAlias of sourceFile.getTypeAliases()) {
      types.push({
        name: typeAlias.getName() || "<anonymous>",
        kind: "type",
        location: {
          file: sourceFile.getFilePath().slice(repoPath.length + 1),
          line: typeAlias.getStartLineNumber(),
        },
      });
    }
  }

  return { results: types };
}

/**
 * Get function signature with parameter types
 */
async function getSignature(
  project: Project,
  repoPath: string,
  functionName: string
): Promise<ASTQueryOutput> {
  const sourceFiles = project.getSourceFiles();

  for (const sourceFile of sourceFiles) {
    const func = sourceFile.getFunction(functionName);
    if (func) {
      const signature = func.getSignature();
      if (!signature) continue;

      const parameters = signature.getParameters();
      const returnType = signature.getReturnType();

      // Extract parameter types from function declaration
      const paramTypes: string[] = [];
      for (const param of func.getParameters()) {
        const typeDecl = param.getTypeNode();
        paramTypes.push(typeDecl?.getText() || "unknown");
      }

      return {
        results: [
          {
            name: functionName,
            kind: "function",
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: func.getStartLineNumber(),
            },
            signature: signature.getDeclaration().getText(),
            parameters: parameters.map((p, i) => ({
              name: p.getName(),
              type: paramTypes[i] || "unknown",
              optional: p.isOptional(),
            })),
            returnType: returnType.getText(),
          },
        ],
      };
    }
  }

  return { results: [] };
}

/**
 * Resolve what properties a type contains
 */
async function resolveType(
  project: Project,
  repoPath: string,
  typeName: string
): Promise<ASTQueryOutput> {
  const sourceFiles = project.getSourceFiles();

  for (const sourceFile of sourceFiles) {
    // Try interface
    const interfaceDecl = sourceFile.getInterface(typeName);
    if (interfaceDecl) {
      const properties = interfaceDecl.getProperties();
      return {
        results: [
          {
            name: typeName,
            kind: "interface",
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: interfaceDecl.getStartLineNumber(),
            },
            properties: properties.map(p => ({
              name: p.getName(),
              type: p.getType().getText(),
            })),
          },
        ],
      };
    }

    // Try type alias
    const typeAlias = sourceFile.getTypeAlias(typeName);
    if (typeAlias) {
      const type = typeAlias.getType();
      const properties = type.getProperties();
      return {
        results: [
          {
            name: typeName,
            kind: "type",
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: typeAlias.getStartLineNumber(),
            },
            properties: properties.map(p => ({
              name: p.getName(),
              type: p.getTypeAtLocation(typeAlias).getText() || "unknown",
            })),
          },
        ],
      };
    }

    // Try class
    const classDecl = sourceFile.getClass(typeName);
    if (classDecl) {
      const properties = classDecl.getProperties();
      return {
        results: [
          {
            name: typeName,
            kind: "class",
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: classDecl.getStartLineNumber(),
            },
            properties: properties.map(p => ({
              name: p.getName(),
              type: p.getType().getText(),
            })),
          },
        ],
      };
    }
  }

  return { results: [] };
}

/**
 * Find references to a symbol
 */
async function getReferences(
  project: Project,
  repoPath: string,
  symbolName: string
): Promise<ASTQueryOutput> {
  const sourceFiles = project.getSourceFiles();
  const references: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);

    for (const identifier of identifiers) {
      if (identifier.getText() === symbolName) {
        references.push({
          name: symbolName,
          kind: "reference",
          location: {
            file: sourceFile.getFilePath().slice(repoPath.length + 1),
            line: identifier.getStartLineNumber(),
          },
        });
      }
    }
  }

  return { results: references };
}

/**
 * Find what implements an interface
 */
async function getImplementations(
  project: Project,
  repoPath: string,
  interfaceName: string
): Promise<ASTQueryOutput> {
  const sourceFiles = project.getSourceFiles();
  const implementations: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    for (const cls of sourceFile.getClasses()) {
      const implementsClause = cls.getImplements();
      for (const impl of implementsClause) {
        if (impl.getText() === interfaceName) {
          implementations.push({
            name: cls.getName() || "<anonymous>",
            kind: "class",
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: cls.getStartLineNumber(),
            },
          });
        }
      }
    }
  }

  return { results: implementations };
}

/**
 * Get all exports from a file
 */
async function findExports(
  project: Project,
  repoPath: string,
  filePath?: string
): Promise<ASTQueryOutput> {
  const sourceFiles = filePath
    ? [project.getSourceFileOrThrow(filePath)]
    : project.getSourceFiles();
  const exports: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    // Get exported functions, classes, interfaces
    for (const func of sourceFile.getFunctions()) {
      if (func.isExported()) {
        exports.push({
          name: func.getName() || "<anonymous>",
          kind: "function",
          location: {
            file: sourceFile.getFilePath().slice(repoPath.length + 1),
            line: func.getStartLineNumber(),
          },
        });
      }
    }

    for (const cls of sourceFile.getClasses()) {
      if (cls.isExported()) {
        exports.push({
          name: cls.getName() || "<anonymous>",
          kind: "class",
          location: {
            file: sourceFile.getFilePath().slice(repoPath.length + 1),
            line: cls.getStartLineNumber(),
          },
        });
      }
    }

    for (const iface of sourceFile.getInterfaces()) {
      if (iface.isExported()) {
        exports.push({
          name: iface.getName() || "<anonymous>",
          kind: "interface",
          location: {
            file: sourceFile.getFilePath().slice(repoPath.length + 1),
            line: iface.getStartLineNumber(),
          },
        });
      }
    }
  }

  return { results: exports };
}

/**
 * Find what interfaces extend another
 */
async function getExtensions(
  project: Project,
  repoPath: string,
  interfaceName: string
): Promise<ASTQueryOutput> {
  const sourceFiles = project.getSourceFiles();
  const extensions: ASTResult[] = [];

  for (const sourceFile of sourceFiles) {
    for (const iface of sourceFile.getInterfaces()) {
      const extendsClause = iface.getExtends();
      for (const ext of extendsClause) {
        if (ext.getText() === interfaceName) {
          extensions.push({
            name: iface.getName() || "<anonymous>",
            kind: "interface",
            location: {
              file: sourceFile.getFilePath().slice(repoPath.length + 1),
              line: iface.getStartLineNumber(),
            },
          });
        }
      }
    }
  }

  return { results: extensions };
}

// ============================================================================
// OUTPUT SCHEMA
// ============================================================================

const astQueryOutputSchema = z.object({
  results: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["function", "class", "interface", "type", "variable", "reference"]),
      location: z.object({
        file: z.string(),
        line: z.number(),
      }),
      signature: z.string().optional(),
      parameters: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
            optional: z.boolean(),
          })
        )
        .optional(),
      returnType: z.string().optional(),
      properties: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
          })
        )
        .optional(),
    })
  ),
});

// ============================================================================
// TOOL DEFINITION
// ============================================================================

/**
 * Create an ast_query tool
 *
 * Note: The tool requires a repoPath to be set in context before use.
 * This is typically done by the search_docs tool which manages repository cloning.
 */
export const createAstQueryTool = (options: { repoPath?: string } = {}) =>
  tool({
    description: `Query TypeScript AST to find and understand code structures.
This single tool handles all AST operations through the queryType parameter.

Use this tool to:
- Find functions, classes, interfaces, and type aliases
- Get function signatures with parameter types
- Resolve what properties a type/interface contains
- Find where symbols are used (references)
- Find what implements an interface
- Get all exports from a file

Query types:
- find_functions: Find all functions in a file/directory
- find_classes: Find all classes in a file/directory
- find_interfaces: Find all interfaces in a file/directory
- find_types: Find all type aliases in a file/directory
- find_exports: Get all exports from a file/directory
- get_signature: Get function signature with parameter types
- resolve_type: Resolve what properties a type contains
- get_references: Find where a symbol is used
- get_implementations: Find what implements an interface
- get_extensions: Find what interfaces extend another`,

    inputSchema: zodSchema(
      z.object({
        queryType: z.enum([
          "find_functions",
          "find_classes",
          "find_interfaces",
          "find_types",
          "find_exports",
          "get_signature",
          "resolve_type",
          "get_references",
          "get_implementations",
          "get_extensions",
        ]),
        target: z.string().describe(`
          What to query:
          - For find_*: file path or directory (use "." for current directory)
          - For get_signature: function name
          - For resolve_type: type name (e.g., "Tool", "UserData")
          - For get_references: symbol name to find references
          - For get_implementations: interface name
          - For get_extensions: base interface name
        `),
        file: z
          .string()
          .optional()
          .describe(`Specific file to search in (optional for directory queries)`),
      })
    ),

    outputSchema: zodSchema(astQueryOutputSchema),

    execute: async args => {
      // Get repo path from options or environment
      const repoPath = options.repoPath || process.cwd();

      const project = getOrCreateProject(repoPath);

      let result: ASTQueryOutput;
      switch (args.queryType) {
        case "find_functions":
          result = await findFunctions(project, repoPath, args.file);
          break;

        case "find_classes":
          result = await findClasses(project, repoPath, args.file);
          break;

        case "find_interfaces":
          result = await findInterfaces(project, repoPath, args.file);
          break;

        case "find_types":
          result = await findTypes(project, repoPath, args.file);
          break;

        case "find_exports":
          result = await findExports(project, repoPath, args.file);
          break;

        case "get_signature":
          result = await getSignature(project, repoPath, args.target);
          break;

        case "resolve_type":
          result = await resolveType(project, repoPath, args.target);
          break;

        case "get_references":
          result = await getReferences(project, repoPath, args.target);
          break;

        case "get_implementations":
          result = await getImplementations(project, repoPath, args.target);
          break;

        case "get_extensions":
          result = await getExtensions(project, repoPath, args.target);
          break;

        default:
          result = { results: [] };
      }

      return astQueryOutputSchema.parse(result);
    },
  });

/**
 * Default ast_query tool instance
 */
export const astQuery = createAstQueryTool();
