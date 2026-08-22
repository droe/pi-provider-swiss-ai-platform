# Pi provider extension for Swiss AI Platform
Copyright (C) 2026, [Daniel Roethlisberger](//daniel.roe.ch/).  
https://github.com/droe/pi-provider-swiss-ai-platform  

Experimental Pi extension that registers a model provider for [Swiss AI
Platform][1] by Swisscom in partnership with NVIDIA, offered via Swisscom's API
platform [Digital Marketplace][2].

[1]: https://www.swisscom.ch/en/business/enterprise/offer/platforms-applications/data-driven-business/swiss-ai-platform.html
[2]: https://digital.swisscom.com/products/swiss-ai-platform/info

## Installation

```
pi install npm:pi-provider-swiss-ai-platform
```

## Configuration

Interactive configuration as usual: `/login` -> «Swiss AI Platform» prompts for
the subscription name, the Client ID and the Client Secret, verifies them
against the gateway and stores them in `~/.pi/agent/auth.json`.  Access tokens
are minted on demand and cached in memory until they expire.

Multiple configured subscriptions are not currently implemented.  Switching
subscription is another `/login`.

For headless use, the following environment variables can be set:

-   `SWISS_AI_PLATFORM_SUBSCRIPTION`
-   `SWISS_AI_PLATFORM_CLIENT_ID`
-   `SWISS_AI_PLATFORM_CLIENT_SECRET`

## Prerequisites

You need a Swiss AI Platform subscription, its technical name, and a matching
Client ID and Client Secret.

For the subscription name, in your subscription on Digital Marketplace, select
Documentation and check «Production Url».  The last path component is the
subscription name, e.g. `all-models` or `apertus-1.5-70b`.  Note that for
model-specific subscriptions, the subscription name is different from the model
identifier.

For the credentials, in your subscription on Digital Marketplace, select
«Credentials» and check the «OAuth 2.0 Credentials» section.

## Models

As of August 2026, the following models offered as part of Swiss AI Platform
work with Pi and show up in `/model` when using a subscription that includes
them:

  - `google/gemma-4-31b-it`
  - `mistralai/mistral-small-4-119b-2603`
  - `qwen/qwen3.5-397b-a17b`
  - `qwen/qwen3.6-35b-a3b`
  - `swiss-ai/Apertus-v1.5-70B`
  - `zai-org/glm-5.2-fp8`

See `MODEL_METADATA` in `index.ts` for metadata on all models, including hidden
models and why they have been hidden.  Feedback or patches to improve model
compatibility very welcome.

Models added more recently, i.e. models not included in `MODEL_METADATA` yet,
may or may not work, and likely need manual configuration in
`~/.pi/agent/models.json`.

## Implementation Details

Models are served over the OpenAI-compatible `/v1/chat/completions` API; only
some of them also support `/v1/responses`, so completions is the default and
`MODEL_METADATA.api` opts a model into the Responses API.  Authentication is an
OAuth 2.0 client-credentials grant (HTTP Basic client authentication).

The model catalog is pulled from `/v1/models` on model refresh and cached by Pi
in `~/.pi/agent/models-store.json`.  The endpoint returns ids only, so model
capabilities come from the curated `MODEL_METADATA` table in `index.ts`.
Unknown ids fall back to `DEFAULT_METADATA`; entries flagged `hideModel: true`
are dropped from the catalog.  Per-model overrides are still possible in
`~/.pi/agent/models.json`.

## Known Issues

-   Some models need a lot of handholding, e.g. for finding files in the
    current working directory, or for correct tool calling.  This might imply
    that the model is not called in the best way possible, or it might simply
    mean the model is bad at tool calling or instruction following.
-   Some models are disabled because they do not work for reasons that might be
    solvable.  See notes in `MODEL_METADATA` in `index.ts`.
-   Pi does not recognize the thinking tags for
    `mistralai/mistral-small-4-119b-2603`, unsure if this can be fixed with
    model metadata or if it would need updates to Pi proper.
-   Only supports a single subscription at the time, which is inconvenient when
    being subscribed to multiple single-model subscriptions.

## Disclaimer

This Pi extension is inofficial, neither provided by nor supported by Swisscom.
