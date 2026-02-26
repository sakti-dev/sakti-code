import { Instance } from "@sakti-code/core/server";

export interface ProjectInfo {
  id: string | undefined;
  name: string | undefined;
  path: string | undefined;
  detectedBy: "packageJson" | "directory" | undefined;
  packageJson: unknown;
}

export async function getProjectInfo(directory?: string): Promise<ProjectInfo> {
  const buildResponse = (): ProjectInfo => ({
    id: Instance.project?.root,
    name: Instance.project?.name,
    path: Instance.project?.root,
    detectedBy: Instance.project?.packageJson ? "packageJson" : "directory",
    packageJson: Instance.project?.packageJson,
  });

  if (Instance.inContext) {
    await Instance.bootstrap();
    return buildResponse();
  }

  if (!directory) {
    throw new Error("Directory parameter required");
  }

  return Instance.provide({
    directory,
    async fn() {
      await Instance.bootstrap();
      return buildResponse();
    },
  }) as Promise<ProjectInfo>;
}

export interface ProjectListItem {
  id: string | undefined;
  name: string | undefined;
  path: string | undefined;
  source: "current";
  lastSeen: number;
}

export interface ProjectListResult {
  projects: ProjectListItem[];
}

export async function listProjects(): Promise<ProjectListResult> {
  const cwd = process.cwd();

  const buildResponse = (): ProjectListResult => ({
    projects: [
      {
        id: Instance.project?.root,
        name: Instance.project?.name,
        path: Instance.project?.root,
        source: "current",
        lastSeen: Date.now(),
      },
    ],
  });

  if (Instance.inContext) {
    await Instance.bootstrap();
    return buildResponse();
  }

  return Instance.provide({
    directory: cwd,
    async fn() {
      await Instance.bootstrap();
      return buildResponse();
    },
  }) as Promise<ProjectListResult>;
}
