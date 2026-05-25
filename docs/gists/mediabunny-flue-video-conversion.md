# Minimal Flue + Mediabunny video conversion sketch

This is a gist-ready sketch for a Flue agent that converts video with [Mediabunny](https://mediabunny.dev/), writes outputs to R2, and can start life on a pseudo-sandbox such as Just Bash / Cloudflare Shell before moving to a real sandbox.

Mediabunny notes:

- `mediabunny` reads, writes, and converts media files in TypeScript.
- The built-in `Conversion` API supports transmuxing, transcoding, trimming, resizing, rotation, cropping, compression, and audio conversion.
- Server-side conversion needs `@mediabunny/server`, which wraps NodeAV/FFmpeg bindings.
- That means real conversion wants Node/Bun/Deno with native dependencies, not a tiny Worker isolate.

The important Flue idea: **the sandbox is just a strategy**. Start with Just Bash / Cloudflare Shell for a fake or smoke conversion, then switch the `makeSandbox()` function to Cloudflare Sandbox, Daytona, E2B, Modal, etc. The rest of the agent can stay the same.

---

## `.flue/agents/video-convert.ts`

```ts
import type { FlueContext } from '@flue/sdk/client';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';

export const triggers = { webhook: true };

/**
 * Bind this in wrangler.jsonc:
 *
 * r2_buckets = [{ binding = "MEDIA_R2", bucket_name = "video-conversions" }]
 */
type R2BucketLike = {
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

const PayloadSchema = v.object({
  inputKey: v.string(),              // R2 key for the uploaded source video
  outputKey: v.string(),             // R2 key for the converted video
  format: v.optional(v.picklist(['mp4', 'webm'])),
  maxHeight: v.optional(v.number()),
  /**
   * Use "mock" with Just Bash / Cloudflare Shell while proving the Flue/R2 plumbing.
   * Use "real" only in a real Node-capable sandbox with mediabunny + @mediabunny/server installed.
   */
  mode: v.optional(v.picklist(['mock', 'real'])),
});

export default async function videoConvert({ init, env, payload, id }: FlueContext) {
  const args = v.parse(PayloadSchema, payload);
  const bucket = env.MEDIA_R2 as R2BucketLike | undefined;
  if (!bucket) throw new Error('MEDIA_R2 binding is required');

  const mode = args.mode ?? 'mock';
  const format = args.format ?? (args.outputKey.endsWith('.webm') ? 'webm' : 'mp4');

  /**
   * This is the only thing you need to swap to ship somewhere useful.
   *
   * During prototyping, Just Bash gives us a cheap pseudo-sandbox. It is great for
   * proving orchestration, R2 writes, payload validation, and result reporting.
   *
   * For real video conversion, replace this with a real sandbox connector:
   *
   *   - Cloudflare Sandbox / Cloudflare Containers
   *   - Daytona
   *   - E2B
   *   - Modal
   *   - local sandbox in GitHub Actions
   *
   * The agent contract stays the same: the sandbox receives a job and produces
   * an output artifact. R2 remains the durable input/output store.
   */
  const sandbox = makeJustBashPseudoSandbox();

  const agent = await init({
    id,
    sandbox,
    cwd: '/workspace',
    model: false, // Conversion is deterministic; no LLM needed for the worker step.
  });

  const session = await agent.session('convert');

  await session.shell('mkdir -p /workspace/in /workspace/out /workspace/scripts');

  const gatewayOrigin = env.MEDIA_GATEWAY_ORIGIN || 'https://media-r2.internal';
  const inputUrl = `${gatewayOrigin}/in/${encodeURIComponent(args.inputKey)}`;
  const outputUrl = `${gatewayOrigin}/out/${encodeURIComponent(args.outputKey)}`;

  if (mode === 'mock') {
    /**
     * Mock mode proves the whole Flue/R2 shape even when the sandbox is only
     * Just Bash / Cloudflare Shell and cannot run native video codecs.
     */
    const result = {
      ok: true,
      mode: 'mock',
      note: 'Pseudo-sandbox run. Swap makeJustBashPseudoSandbox() for a real Node-capable sandbox to transcode with Mediabunny.',
      inputKey: args.inputKey,
      outputKey: args.outputKey,
      format,
      maxHeight: args.maxHeight ?? null,
      wouldFetchFrom: inputUrl,
      wouldUploadTo: outputUrl,
      generatedAt: new Date().toISOString(),
    };

    const fakeConvertedBytes = new TextEncoder().encode(
      `MOCK ${format.toUpperCase()} for ${args.inputKey} at maxHeight=${args.maxHeight ?? 'original'}\n`,
    );
    await bucket.put(args.outputKey, fakeConvertedBytes, {
      httpMetadata: { contentType: format === 'webm' ? 'video/webm' : 'video/mp4' },
    });
    await bucket.put(args.outputKey.replace(/\.[^.]+$/, '.conversion.json'), JSON.stringify(result, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });

    return result;
  }

  /**
   * Real mode expects this sandbox to have Node and these packages installed:
   *
   *   npm install mediabunny @mediabunny/server
   *
   * In a real Cloudflare Sandbox image, bake those into the image. In GitHub
   * Actions/local sandbox, install them before running the agent.
   */
  await session.shell(`cat > /workspace/scripts/convert.mjs <<'EOF'
import { readFile, writeFile } from 'node:fs/promises';
import {
  ALL_FORMATS,
  Conversion,
  FilePathSource,
  FilePathTarget,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  WebMOutputFormat,
} from 'mediabunny';
import { registerMediabunnyServer } from '@mediabunny/server';

registerMediabunnyServer();

const inputUrl = process.env.INPUT_URL;
const outputUrl = process.env.OUTPUT_URL;
const format = process.env.FORMAT || 'mp4';
const maxHeight = process.env.MAX_HEIGHT ? Number(process.env.MAX_HEIGHT) : undefined;

if (!inputUrl || !outputUrl) throw new Error('INPUT_URL and OUTPUT_URL are required');

const inputPath = '/workspace/in/source';
const outputPath = format === 'webm' ? '/workspace/out/output.webm' : '/workspace/out/output.mp4';

const inputResponse = await fetch(inputUrl);
if (!inputResponse.ok) throw new Error(`Failed to fetch input: ${inputResponse.status} ${await inputResponse.text()}`);
await writeFile(inputPath, Buffer.from(await inputResponse.arrayBuffer()));

const input = new Input({
  source: new FilePathSource(inputPath),
  formats: ALL_FORMATS,
});

const output = new Output({
  format: format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
  target: new FilePathTarget(outputPath),
});

const conversion = await Conversion.init({
  input,
  output,
  video: maxHeight
    ? async (track) => ({
        codec: format === 'webm' ? 'vp9' : 'avc',
        height: Math.min(maxHeight, await track.getDisplayHeight()),
        bitrate: QUALITY_MEDIUM,
      })
    : {
        codec: format === 'webm' ? 'vp9' : 'avc',
        bitrate: QUALITY_MEDIUM,
      },
  audio: {
    codec: format === 'webm' ? 'opus' : 'aac',
  },
});

if (!conversion.isValid) {
  console.log(JSON.stringify({ ok: false, discardedTracks: conversion.discardedTracks }, null, 2));
  process.exit(2);
}

let progress = 0;
conversion.onProgress = (value) => {
  progress = value;
};

await conversion.execute();

// Simple gist version buffers the output. Production should stream the body.
const convertedBytes = await readFile(outputPath);
const uploadResponse = await fetch(outputUrl, {
  method: 'PUT',
  headers: { 'content-type': format === 'webm' ? 'video/webm' : 'video/mp4' },
  body: convertedBytes,
});
if (!uploadResponse.ok) throw new Error(`Failed to upload output: ${uploadResponse.status} ${await uploadResponse.text()}`);

console.log(JSON.stringify({ ok: true, format, outputPath, bytes: convertedBytes.byteLength, progress }, null, 2));
EOF`);

  const result = await session.shell('node /workspace/scripts/convert.mjs', {
    env: {
      INPUT_URL: inputUrl,
      OUTPUT_URL: outputUrl,
      FORMAT: format,
      MAX_HEIGHT: args.maxHeight ? String(args.maxHeight) : '',
    },
  });

  if (result.exitCode !== 0) {
    const failure = { ok: false, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    await bucket.put(args.outputKey.replace(/\.[^.]+$/, '.failure.json'), JSON.stringify(failure, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    });
    return failure;
  }

  const parsed = JSON.parse(result.stdout.trim().split('\n').at(-1) || '{}');
  await bucket.put(args.outputKey.replace(/\.[^.]+$/, '.success.json'), JSON.stringify(parsed, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return parsed;
}

function makeJustBashPseudoSandbox() {
  const fs = new InMemoryFs();
  return () => new Bash({
    fs,
    cwd: '/workspace',
    python: true,
    network: { dangerouslyAllowFullInternetAccess: true },
  });
}
```

---

## Outbound Worker / R2 gateway pattern

A real sandbox should not receive R2 credentials. Instead, the sandbox calls an internal host such as `https://media-r2.internal`, and Cloudflare's outbound Worker proxy intercepts that egress. The proxy has the R2 binding and enforces the policy.

The sandbox only sees:

```txt
GET https://media-r2.internal/in/<inputKey>
PUT https://media-r2.internal/out/<outputKey>
```

It never sees R2 credentials.

```ts
// Sketch: configure this on the Cloudflare Sandbox class, not inside the LLM prompt.
// The exact class name/binding depends on your Cloudflare Sandbox setup.
class VideoSandbox extends Sandbox {
  static outboundByHost = {
    'media-r2.internal': async (request: Request, env: Env, ctx: ExecutionContext) => {
      return handleMediaR2Gateway(request, env);
    },
  };
}

type Env = {
  MEDIA_R2: R2Bucket;
};

async function handleMediaR2Gateway(request: Request, env: Env) {
  const url = new URL(request.url);
  const [, direction, ...rest] = url.pathname.split('/');
  const key = decodeURIComponent(rest.join('/'));

  // Keep this policy narrow. In production, restrict prefixes per job/session.
  if (!key || key.includes('..')) return new Response('bad key', { status: 400 });

  if (request.method === 'GET' && direction === 'in') {
    const object = await env.MEDIA_R2.get(key);
    if (!object) return new Response('not found', { status: 404 });
    return new Response(object.body, {
      headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream' },
    });
  }

  if (request.method === 'PUT' && direction === 'out') {
    await env.MEDIA_R2.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
    });
    return new Response(JSON.stringify({ ok: true, key }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response('not found', { status: 404 });
}
```

Why this works:

1. The Flue Worker owns orchestration and validates the job.
2. The sandbox owns CPU-heavy conversion.
3. R2 owns durable input/output storage.
4. The outbound Worker owns secret-bearing egress.
5. Swapping Just Bash for a real sandbox changes execution power, not the Flue/R2 contract.

---

## Local verification

This repo includes a local test that shims R2 with a folder and uses Just Bash as the pseudo-sandbox:

```bash
pnpm run test:mediabunny:gist
```

The test writes a gist-ready result file:

```txt
docs/gists/mediabunny-flue-video-conversion.local-test-results.md
```

It verifies:

- generated fake input media is stored in the local R2 shim
- an outbound Worker-style `GET /in/<key>` reads from the shim
- an outbound Worker-style `PUT /out/<key>` writes to the shim
- a Just Bash pseudo-sandbox runs the mocked conversion step
- output and conversion metadata are written back through the R2-shaped contract

## Example payload

```json
{
  "inputKey": "uploads/demo.mov",
  "outputKey": "converted/demo-720p.mp4",
  "format": "mp4",
  "maxHeight": 720,
  "mode": "mock"
}
```

Switch to real conversion after replacing `makeJustBashPseudoSandbox()` with a real Node-capable sandbox:

```json
{
  "inputKey": "uploads/demo.mov",
  "outputKey": "converted/demo-720p.mp4",
  "format": "mp4",
  "maxHeight": 720,
  "mode": "real"
}
```

