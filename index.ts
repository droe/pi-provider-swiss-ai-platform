/*
 * Pi provider extension for Swiss AI Platform by Swisscom.
 * Copyright (C) 2026 Daniel Roethlisberger <daniel@roe.ch>
 * https://github.com/droe/pi-provider-swiss-ai-platform
 */

import {
  type ApiKeyAuth,
  type ApiKeyCredential,
  type AuthInteraction,
  createProvider,
  type Model,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi, openAIResponsesApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Configuration
// =============================================================================

const PROVIDER_ID = "swiss-ai-platform";
const PROVIDER_NAME = "Swiss AI Platform";
const PRODUCT_URL = "https://api.swisscom.com/products/swiss-ai-platform";
const TOKEN_URL = "https://api.swisscom.com/products/oauth2/token";

const ENV_SUBSCRIPTION = "SWISS_AI_PLATFORM_SUBSCRIPTION";
const ENV_CLIENT_ID = "SWISS_AI_PLATFORM_CLIENT_ID";
const ENV_CLIENT_SECRET = "SWISS_AI_PLATFORM_CLIENT_SECRET";
const ENV_ACCESS_TOKEN = "SWISS_AI_PLATFORM_ACCESS_TOKEN";

/** Safety margin subtracted from the token lifetime reported by the gateway. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** e.g. subscription "all-models" -> ".../swiss-ai-platform/all-models/v1" */
const baseUrlFor = (subscription: string) => `${PRODUCT_URL}/${encodeURIComponent(subscription)}/v1`;

type SwissApi = "openai-completions" | "openai-responses";
type SwissModel = Model<SwissApi>;

/** Only some models support the Responses API, so chat completions is the default. */
const DEFAULT_API: SwissApi = "openai-completions";

interface ModelMetadata {
  name?: string;
  /** Streaming API for this model. Default: DEFAULT_API ("openai-completions"). */
  api?: SwissApi;
  /**
   * Keep the model out of pi entirely. Use it for models that cannot serve a
   * coding agent, e.g. text-to-speech, speech-to-text, embeddings or moderation.
   */
  hideModel?: boolean;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  /** USD per million tokens. */
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: SwissModel["thinkingLevelMap"];
  compat?: SwissModel["compat"];
}

/**
 * Curated capabilities per model id, keyed exactly as returned by /v1/models.
 * Model documentation by Swisscom:
 *
 * https://docs.cloud.swisscom.ch/guide/cloud-services/aip/use/inference-endpoints/
 * https://docs.cloud.swisscom.ch/guide/cloud-services/aip/models/overview
 *
 * Model availability status (GA, preview, deprecated) deliberately not tracked in a
 * structured way, as that info is too short-lived.
 *
 * Configuration may not be perfect, please submit issues or PRs with improvements.
 */
const MODEL_METADATA: Record<string, ModelMetadata> = {
  "google/gemma-4-31b-it": {
    name: "Gemma 4 31b",
    api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 256000,
  },
  "magpie-tts-multilingual": {
    // Disabled because Pi does not do text-to-speech.
    hideModel: true,
    name: "Magpie TTS Multilingual",
  },
  "meta/llama-3.1-8b-instruct": {
    // Disabled because the model does not seem to work with Pi.
    // Model deprecated, not worth fixing.
    hideModel: true,
    name: "Llama 3.1 8b instruct",
  },
  "meta/llama-4-scout-17b-16e-instruct": {
    // Disabled because tool calling does not seem to work.
    // Model deprecated, not worth fixing.
    hideModel: true,
    name: "Llama 4 Scout 17b 16e instruct",
    input: ["text", "image"],
    contextWindow: 131072,
  },
  "mistralai/mistral-small-4-119b-2603": {
    // FIXME Docs state that this model supports the responses API, but
    // responses API results in error 400 "'input_text' is not a valid
    // ChunkTypes".  Use completions until someone figures this one out.
    // FIXME [THINK]...[/THINK] tags are not recognised by Pi.
    name: "Mistral Small 4 119B 2603",
    //api: "openai-responses",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 256144,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
      max: null,
    },
    compat: {
      supportsDeveloperRole: false,
    },
  },
  "nvidia/llama-3.1-nemoguard-8b-content-safety": {
    // Disabled because Pi does not do content safety.
    hideModel: true,
    name: "Llama 3.1 Nemoguard 8b content safety",
  },
  "nvidia/llama-3.2-nv-embedqa-1b-v2": {
    // Disabled because Pi does not do text-to-embeddings.
    hideModel: true,
    name: "Llama 3.2 NV embedqa 1B v2",
  },
  "openai/gpt-oss-20b": {
    // FIXME Works, but performs very poorly with tool calling.
    // Should investigate root cause.
    hideModel: true,
    name: "GPT OSS 20B",
    input: ["text"],
    contextWindow: 131072,
  },
  "openai/gpt-oss-120b": {
    // Works, but performs very poorly with tool calling.
    // Model deprecated, not worth fixing.
    hideModel: true,
    name: "GPT OSS 120B",
    input: ["text"],
    contextWindow: 131072,
  },
  "openai/whisper-large-v3-turbo": {
    // Disabled because Pi does not do speech-to-text.
    hideModel: true,
    name: "Whisper Large V3 Turbo",
  },
  "qwen/qwen3.5-397b-a17b": {
    name: "Qwen 3.5 397B A17B",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: null,
    },
    compat: {
      thinkingFormat: "qwen",
      supportsDeveloperRole: false,
    },
  },
  "qwen/qwen3.6-35b-a3b": {
    // FIXME Docs state that this model supports the responses API, but
    // responses API results in "Error: OpenAI API error (429): 429
    // status code (no body)".  Use completions until someone figures
    // this one out.
    name: "Qwen 3.6 35B A3B",
    //api: "openai-responses",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    compat: {
      thinkingFormat: "qwen",
    },
  },
  "rednote-hilab/dots.ocr": {
    // Disabled because Pi does not do OCR.
    hideModel: true,
    name: "Rednote Hilab Dots OCR",
  },
  "swiss-ai/Apertus-v1.5-70B": {
    name: "Apertus 1.5 70B",
    api: "openai-responses",
    input: ["text", "image"],
    contextWindow: 262144,
  },
  "zai-org/glm-5.2-fp8": {
    name: "GLM 5.2 FP8 744B A40B",
    api: "openai-responses",
    reasoning: true,
    input: ["text"],
    contextWindow: 262144,
    thinkingLevelMap: {
      off: "none",
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: null,
      max: "max",
    },
  },
};

/** Applied to models returned by /v1/models that have no MODEL_METADATA entry. */
const DEFAULT_METADATA: Required<Pick<ModelMetadata, "reasoning" | "input" | "cost" | "contextWindow" | "maxTokens">> = {
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131_072,
  maxTokens: 16_384,
};

/** Models flagged with `hideModel` are never offered by this provider. */
const isHidden = (id: string) => MODEL_METADATA[id]?.hideModel === true;

// =============================================================================
// Gateway requests
// =============================================================================

interface AccessToken {
  access: string;
  /** Absolute expiry in ms, already reduced by TOKEN_EXPIRY_SKEW_MS. */
  expires: number;
}

async function errorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  try {
    const json = JSON.parse(body) as { message?: string; error_description?: string; error?: string };
    return json.message ?? json.error_description ?? json.error ?? body;
  } catch {
    return body;
  }
}

/** OAuth 2.0 client-credentials grant with HTTP Basic client authentication. */
async function requestAccessToken(clientId: string, clientSecret: string, signal?: AbortSignal): Promise<AccessToken> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    signal,
  });

  if (!response.ok) {
    throw new Error(`${PROVIDER_NAME} token request failed (${response.status}): ${await errorDetail(response)}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error(`${PROVIDER_NAME} token response contained no access_token`);

  return {
    access: data.access_token,
    expires: Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_EXPIRY_SKEW_MS,
  };
}

/** In-process token cache; promises are cached so concurrent requests share one grant. */
const tokenCache = new Map<string, Promise<AccessToken>>();

async function cachedAccessToken(clientId: string, clientSecret: string, signal?: AbortSignal): Promise<string> {
  const key = `${clientId}:${clientSecret}`;
  const pending = tokenCache.get(key);

  if (pending) {
    const token = await pending.catch(() => undefined);
    if (token && token.expires > Date.now()) return token.access;
  }

  const request = requestAccessToken(clientId, clientSecret, signal);
  tokenCache.set(key, request);
  try {
    return (await request).access;
  } catch (error) {
    tokenCache.delete(key);
    throw error;
  }
}

/** Model ids offered by one subscription. Doubles as the subscription check during login. */
async function fetchModelIds(subscription: string, token: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${baseUrlFor(subscription)}/models`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `${PROVIDER_NAME} model listing for subscription "${subscription}" failed (${response.status}): ${await errorDetail(response)}`,
    );
  }

  const payload = (await response.json()) as { data?: { id?: string }[] };
  return (payload.data ?? []).map((entry) => entry?.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

// =============================================================================
// Auth
// =============================================================================

/** Everything needed to reach one subscription: endpoint plus a way to get a token. */
interface Settings {
  subscription: string;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  source: string;
}

type EnvLookup = (name: string) => Promise<string | undefined> | string | undefined;

/**
 * Collect settings from the stored credential first, then the environment.
 * The subscription name is mandatory: without it there is no endpoint to call.
 */
async function lookupSettings(env: EnvLookup, credential?: ApiKeyCredential): Promise<Settings | undefined> {
  const stored = credential?.env ?? {};
  const subscription = stored[ENV_SUBSCRIPTION] ?? (await env(ENV_SUBSCRIPTION));

  const token = credential?.key ?? (await env(ENV_ACCESS_TOKEN));
  const clientId = stored[ENV_CLIENT_ID] ?? (await env(ENV_CLIENT_ID));
  const clientSecret = stored[ENV_CLIENT_SECRET] ?? (await env(ENV_CLIENT_SECRET));

  const origin = token
    ? credential?.key
      ? "stored access token"
      : ENV_ACCESS_TOKEN
    : clientId && clientSecret
      ? stored[ENV_CLIENT_ID]
        ? "stored client credentials"
        : `${ENV_CLIENT_ID}/${ENV_CLIENT_SECRET}`
      : undefined;
  if (!origin) return undefined;

  if (!subscription) {
    throw new Error(
      `No ${PROVIDER_NAME} subscription name — run /login ${PROVIDER_ID} or set ${ENV_SUBSCRIPTION}`,
    );
  }

  return { subscription, token, clientId, clientSecret, source: `${origin}, subscription "${subscription}"` };
}

async function accessTokenFor(settings: Settings, signal?: AbortSignal): Promise<string> {
  return settings.token ?? cachedAccessToken(settings.clientId!, settings.clientSecret!, signal);
}

const apiKeyAuth: ApiKeyAuth = {
  name: `${PROVIDER_NAME} subscription and client credentials`,

  /** Interactive setup started by /login: subscription name, Client ID, Client Secret. */
  async login(interaction: AuthInteraction): Promise<ApiKeyCredential> {
    const subscription = (
      await interaction.prompt({
        type: "text",
        message: "Subscription name (part of the API base URL, no default)",
        placeholder: "all-models",
      })
    ).trim();
    if (!subscription) throw new Error("A subscription name is required");

    const clientId = (
      await interaction.prompt({ type: "text", message: "Client ID", placeholder: "OAuth 2.0 client id" })
    ).trim();
    const clientSecret = (await interaction.prompt({ type: "secret", message: "Client Secret" })).trim();
    if (!clientId || !clientSecret) throw new Error("Client ID and Client Secret are required");

    // Verify credentials and subscription before storing; also primes the token cache.
    interaction.notify({ type: "progress", message: "Verifying client credentials..." });
    const token = await cachedAccessToken(clientId, clientSecret, interaction.signal);

    interaction.notify({ type: "progress", message: `Checking subscription "${subscription}"...` });
    const modelIds = (await fetchModelIds(subscription, token, interaction.signal)).filter((id) => !isHidden(id));
    interaction.notify({ type: "info", message: `${modelIds.length} usable model(s) in "${subscription}"` });

    return {
      type: "api_key",
      env: {
        [ENV_SUBSCRIPTION]: subscription,
        [ENV_CLIENT_ID]: clientId,
        [ENV_CLIENT_SECRET]: clientSecret,
      },
    };
  },

  async check({ ctx, credential }) {
    const settings = await lookupSettings((name) => ctx.env(name), credential).catch(() => undefined);
    return settings ? { type: "api_key", source: settings.source } : undefined;
  },

  async resolve({ ctx, credential }) {
    const settings = await lookupSettings((name) => ctx.env(name), credential);
    if (!settings) return undefined;

    return {
      auth: { apiKey: await accessTokenFor(settings), baseUrl: baseUrlFor(settings.subscription) },
      env: { [ENV_SUBSCRIPTION]: settings.subscription },
      source: settings.source,
    };
  },
};

// =============================================================================
// Model catalog
// =============================================================================

function toModel(id: string, baseUrl: string): SwissModel {
  const meta = MODEL_METADATA[id] ?? {};
  return {
    id,
    name: meta.name ?? id,
    api: meta.api ?? DEFAULT_API,
    provider: PROVIDER_ID,
    baseUrl,
    reasoning: meta.reasoning ?? DEFAULT_METADATA.reasoning,
    ...(meta.thinkingLevelMap ? { thinkingLevelMap: meta.thinkingLevelMap } : {}),
    input: meta.input ?? DEFAULT_METADATA.input,
    cost: meta.cost ?? DEFAULT_METADATA.cost,
    contextWindow: meta.contextWindow ?? DEFAULT_METADATA.contextWindow,
    maxTokens: meta.maxTokens ?? DEFAULT_METADATA.maxTokens,
    ...(meta.compat ? { compat: meta.compat } : {}),
  };
}

/** Throws on failure so pi keeps the previously stored catalog. */
async function fetchModels({ credential, signal }: RefreshModelsContext): Promise<readonly SwissModel[]> {
  const apiKeyCredential: ApiKeyCredential | undefined = credential?.type === "api_key" ? credential : undefined;
  const settings = await lookupSettings((name) => process.env[name], apiKeyCredential);
  if (!settings) {
    throw new Error(`No ${PROVIDER_NAME} credentials — run /login ${PROVIDER_ID} or set ${ENV_CLIENT_ID}/${ENV_CLIENT_SECRET}`);
  }

  const token = await accessTokenFor(settings, signal);
  const baseUrl = baseUrlFor(settings.subscription);

  return (await fetchModelIds(settings.subscription, token, signal))
    .filter((id) => !isHidden(id))
    .map((id) => toModel(id, baseUrl))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// =============================================================================
// Extension entry point
// =============================================================================

export default function (pi: ExtensionAPI) {
  pi.registerProvider(
    createProvider<SwissApi>({
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      // Per-credential endpoint; the subscription-specific URL comes from auth.
      baseUrl: PRODUCT_URL,
      auth: { apiKey: apiKeyAuth },
      models: [],
      fetchModels,
      // Second line of defence: also hides models restored from a stale catalog cache.
      filterModels: (models) => models.filter((model) => !isHidden(model.id)),
      // Per-model dispatch: completions for everything unless MODEL_METADATA says otherwise.
      api: {
        "openai-completions": openAICompletionsApi(),
        "openai-responses": openAIResponsesApi(),
      },
    }),
  );
}
