import * as path from 'node:path';
import { resolveSchema } from './resolver.js';
import { ArtifactGraph } from './graph.js';
import { detectCompleted } from './state.js';
import { resolveArtifactOutputs } from './outputs.js';
import { readChangeMetadata, resolveSchemaForChange } from '../../utils/change-metadata.js';
import { FileSystemUtils } from '../../utils/file-system.js';
import type { ChangeMetadata } from '../change-metadata/index.js';
import type { CompletedSet } from './types.js';

/**
 * Change context containing graph, completion state, and metadata.
 */
export interface ChangeContext {
  graph: ArtifactGraph;
  completed: CompletedSet;
  schemaName: string;
  changeName: string;
  changeDir: string;
  projectRoot: string;
  metadata?: ChangeMetadata;
}

export interface LoadChangeContextOptions {
  changeDir?: string;
}

/**
 * Status of a single artifact in the workflow.
 */
export interface ArtifactStatus {
  id: string;
  outputPath: string;
  status: 'done' | 'ready' | 'blocked';
  missingDeps?: string[];
}

export interface ArtifactPathSummary {
  outputPath: string;
  resolvedOutputPath: string;
  existingOutputPaths: string[];
}

/**
 * Formatted change status.
 */
export interface ChangeStatus {
  changeName: string;
  schemaName: string;
  changeRoot: string;
  artifactPaths: Record<string, ArtifactPathSummary>;
  isComplete: boolean;
  applyRequires: string[];
  artifacts: ArtifactStatus[];
}

/**
 * Loads change context combining graph and completion state.
 */
export function loadChangeContext(
  projectRoot: string,
  changeName: string,
  schemaName?: string,
  options: LoadChangeContextOptions = {}
): ChangeContext {
  const changeDir = FileSystemUtils.canonicalizeExistingPath(
    options.changeDir ?? path.join(projectRoot, '.sakti', 'changes', changeName)
  );

  const metadata = readChangeMetadata(changeDir, projectRoot) ?? undefined;
  const resolvedSchemaName = resolveSchemaForChange(changeDir, schemaName, projectRoot, {
    metadata: metadata ?? null,
  });

  const schema = resolveSchema(resolvedSchemaName, projectRoot);
  const graph = ArtifactGraph.fromSchema(schema);
  const completed = detectCompleted(graph, changeDir);

  return {
    graph,
    completed,
    schemaName: resolvedSchemaName,
    changeName,
    changeDir,
    projectRoot,
    ...(metadata ? { metadata } : {}),
  };
}

/**
 * Formats the status of all artifacts in a change.
 */
export function formatChangeStatus(
  context: ChangeContext
): ChangeStatus {
  const schema = resolveSchema(context.schemaName, context.projectRoot);
  const applyRequires = schema.apply?.requires ?? schema.artifacts.map(a => a.id);

  const artifacts = context.graph.getAllArtifacts();
  const ready = new Set(context.graph.getNextArtifacts(context.completed));
  const blocked = context.graph.getBlocked(context.completed);

  const artifactPaths: Record<string, ArtifactPathSummary> = {};
  const artifactStatuses: ArtifactStatus[] = artifacts.map(artifact => {
    artifactPaths[artifact.id] = {
      outputPath: artifact.generates,
      resolvedOutputPath: path.join(context.changeDir, artifact.generates),
      existingOutputPaths: resolveArtifactOutputs(context.changeDir, artifact.generates),
    };

    if (context.completed.has(artifact.id)) {
      return {
        id: artifact.id,
        outputPath: artifact.generates,
        status: 'done' as const,
      };
    }

    if (ready.has(artifact.id)) {
      return {
        id: artifact.id,
        outputPath: artifact.generates,
        status: 'ready' as const,
      };
    }

    return {
      id: artifact.id,
      outputPath: artifact.generates,
      status: 'blocked' as const,
      missingDeps: blocked[artifact.id] ?? [],
    };
  });

  const buildOrder = context.graph.getBuildOrder();
  const orderMap = new Map(buildOrder.map((id, idx) => [id, idx]));
  artifactStatuses.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
  const isComplete = context.graph.isComplete(context.completed);

  return {
    changeName: context.changeName,
    schemaName: context.schemaName,
    changeRoot: context.changeDir,
    artifactPaths,
    isComplete,
    applyRequires,
    artifacts: artifactStatuses,
  };
}
