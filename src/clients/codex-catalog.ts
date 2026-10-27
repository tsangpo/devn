import path from 'node:path';

import { privateDir } from '../files';
import { platform } from '../platform';
import type { Environment } from '../platform/types';
import { codexCommand } from './codex';
import type { CodexModel } from './codex-profile';
import { codexClaudeEnvironment } from './environment';
import { codexTelemetryArgs } from './telemetry';

export type CatalogSource = {
  id: string;
  name?: string;
  description?: string;
  context?: number;
  images?: boolean;
};

// Codex refuses catalog entries without its agent instructions and tool settings. Those
// come from the catalog bundled with the installed binary, never from the gateway.
export function bundledCodexCatalog(
  root: string,
  inherited: Environment,
  telemetry?: false,
): CodexModel[] {
  privateDir(path.join(root, 'codex'));
  const env = codexClaudeEnvironment(root, inherited);
  const argv = platform.resolveCommand(
    codexCommand,
    [...(telemetry === false ? codexTelemetryArgs : []), 'debug', 'models', '--bundled'],
    env,
  );
  let models: unknown;
  try {
    const result = Bun.spawnSync(argv, {
      env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: 15000,
    });
    if (result.exitCode !== 0) throw new Error();
    models = JSON.parse(result.stdout.toString()).models;
  } catch {
    throw new Error('Cannot read the Codex bundled model catalog. Update Codex and try again.');
  }
  const listed = Array.isArray(models)
    ? models.filter(
        (m: any) =>
          m &&
          typeof m.slug === 'string' &&
          typeof m.base_instructions === 'string' &&
          m.visibility === 'list',
      )
    : [];
  if (!listed.length)
    throw new Error(
      'The Codex bundled model catalog is empty or unsupported. Update Codex and try again.',
    );
  return listed.sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0));
}

// Gateway route IDs such as bedrock/global.openai.gpt-6.1-sol end with the bundled slug.
function match(id: string, bundled: CodexModel[]): CodexModel | undefined {
  return bundled
    .filter((m) => id === m.slug || id.endsWith(`/${m.slug}`) || id.endsWith(`.${m.slug}`))
    .sort((a, b) => b.slug.length - a.slug.length)[0];
}

export function codexCatalog(models: CatalogSource[], bundled: CodexModel[]): CodexModel[] {
  return models.map((model, index) => {
    const known = match(model.id, bundled);
    const entry: CodexModel = structuredClone(known || bundled[0]);
    // OpenAI-hosted tiers, search, experimental tools and upgrade prompts do not exist behind
    // the gateway, and non-OpenAI upstreams need the full Responses wire format.
    for (const field of [
      'service_tiers',
      'additional_speed_tiers',
      'availability_nux',
      'upgrade',
      'web_search_tool_type',
    ])
      delete entry[field];
    Object.assign(entry, {
      slug: model.id,
      visibility: 'list',
      priority: index + 1,
      supports_search_tool: false,
      use_responses_lite: false,
      experimental_supported_tools: [],
      ...(model.name ? { display_name: model.name } : known ? {} : { display_name: model.id }),
      ...(model.description
        ? { description: model.description }
        : known
          ? {}
          : { description: model.name || model.id }),
    });
    if (model.context) entry.context_window = entry.max_context_window = model.context;
    if (!known) {
      // Unknown models keep Codex's agent behavior but claim no OpenAI-specific capabilities.
      if (!model.context) {
        delete entry.context_window;
        delete entry.max_context_window;
      }
      delete entry.multi_agent_reasoning_effort;
      Object.assign(entry, {
        default_reasoning_level: null,
        supported_reasoning_levels: [],
        supports_reasoning_effort_updates: false,
        supports_image_detail_original: false,
        input_modalities: model.images === false ? ['text'] : ['text', 'image'],
      });
    }
    return entry;
  });
}
