/**
 * Build metadata helpers. Mirrors the api/indexer pattern so the explorer
 * participates in the same SHA-verification chain at deploy time.
 *
 * The Dockerfile takes GIT_SHA / BUILD_TIME / VERSION as build ARGs and sets
 * both server-side env vars (used here) and `NEXT_PUBLIC_*` variants (so the
 * UI can render the deployed commit). We read the server-side names because
 * /api/version is rendered on the server.
 */

export interface BuildInfo {
  gitSha: string;
  buildTime: string;
  version: string;
  nodeVersion: string;
}

export function readBuildInfo(env: Partial<NodeJS.ProcessEnv> = process.env): BuildInfo {
  return {
    gitSha: env.GIT_SHA || env.NEXT_PUBLIC_GIT_SHA || 'unknown',
    buildTime: env.BUILD_TIME || env.NEXT_PUBLIC_BUILD_TIME || 'unknown',
    version: env.VERSION || env.NEXT_PUBLIC_VERSION || env.npm_package_version || '0.0.0',
    nodeVersion: process.version,
  };
}

export interface VersionResponse extends BuildInfo {
  service: string;
  uptimeSec: number;
}

const startedAt = Date.now();

export function buildVersionResponse(
  service = 'lithosphere-explorer',
  info: BuildInfo = readBuildInfo(),
): VersionResponse {
  return {
    service,
    ...info,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  };
}
