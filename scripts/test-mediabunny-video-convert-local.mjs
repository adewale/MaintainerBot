import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { Bash, InMemoryFs } from 'just-bash';

const rootDisplay = '.tmp/mediabunny-local-r2';
const root = join(process.cwd(), rootDisplay);
const resultsPath = join(process.cwd(), 'docs', 'gists', 'mediabunny-flue-video-conversion.local-test-results.md');

class LocalFolderR2 {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  pathFor(key) {
    if (!key || key.includes('..')) throw new Error(`Unsafe R2 key: ${key}`);
    return join(this.rootDir, key);
  }

  async put(key, value, options = {}) {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await toBuffer(value));
    await writeFile(`${path}.metadata.json`, JSON.stringify({ httpMetadata: options.httpMetadata ?? {} }, null, 2));
  }

  async get(key) {
    const path = this.pathFor(key);
    try {
      const metadata = await readMetadata(path);
      return {
        body: Readable.toWeb(createReadStream(path)),
        httpMetadata: metadata.httpMetadata,
        async arrayBuffer() {
          const bytes = await readFile(path);
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
        async text() {
          return await readFile(path, 'utf8');
        },
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async readText(key) {
    return await readFile(this.pathFor(key), 'utf8');
  }

  async readBytes(key) {
    return await readFile(this.pathFor(key));
  }
}

async function readMetadata(path) {
  try {
    return JSON.parse(await readFile(`${path}.metadata.json`, 'utf8'));
  } catch {
    return { httpMetadata: {} };
  }
}

async function toBuffer(value) {
  if (typeof value === 'string') return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    const chunks = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new TypeError(`Unsupported put value: ${Object.prototype.toString.call(value)}`);
}

async function handleMediaR2Gateway(request, bucket) {
  const url = new URL(request.url);
  const [, direction, ...rest] = url.pathname.split('/');
  const key = decodeURIComponent(rest.join('/'));

  if (!key || key.includes('..')) return new Response('bad key', { status: 400 });

  if (request.method === 'GET' && direction === 'in') {
    const object = await bucket.get(key);
    if (!object) return new Response('not found', { status: 404 });
    return new Response(object.body, {
      headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream' },
    });
  }

  if (request.method === 'PUT' && direction === 'out') {
    await bucket.put(key, request.body, {
      httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
    });
    return new Response(JSON.stringify({ ok: true, key }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response('not found', { status: 404 });
}

function makeJustBashPseudoSandbox() {
  const fs = new InMemoryFs();
  return new Bash({
    fs,
    cwd: '/workspace',
    python: true,
    network: { dangerouslyAllowFullInternetAccess: true },
  });
}

async function runMockVideoConvert({ bucket, payload, gatewayOrigin }) {
  const format = payload.format ?? (payload.outputKey.endsWith('.webm') ? 'webm' : 'mp4');
  const bash = makeJustBashPseudoSandbox();
  const setup = await bash.exec('mkdir -p /workspace/in /workspace/out /workspace/scripts && echo sandbox-ok > /workspace/out/proof.txt && cat /workspace/out/proof.txt');
  assert.equal(setup.exitCode, 0);
  assert.equal(setup.stdout.trim(), 'sandbox-ok');

  const inputUrl = `${gatewayOrigin}/in/${encodeURIComponent(payload.inputKey)}`;
  const outputUrl = `${gatewayOrigin}/out/${encodeURIComponent(payload.outputKey)}`;
  const result = {
    ok: true,
    mode: 'mock',
    note: 'Pseudo-sandbox run. Swap makeJustBashPseudoSandbox() for a real Node-capable sandbox to transcode with Mediabunny.',
    inputKey: payload.inputKey,
    outputKey: payload.outputKey,
    format,
    maxHeight: payload.maxHeight ?? null,
    wouldFetchFrom: inputUrl,
    wouldUploadTo: outputUrl,
    generatedAt: new Date().toISOString(),
  };

  const fakeConvertedBytes = Buffer.from(`MOCK ${format.toUpperCase()} for ${payload.inputKey} at maxHeight=${payload.maxHeight ?? 'original'}\n`);
  await bucket.put(payload.outputKey, fakeConvertedBytes, {
    httpMetadata: { contentType: format === 'webm' ? 'video/webm' : 'video/mp4' },
  });
  await bucket.put(payload.outputKey.replace(/\.[^.]+$/, '.conversion.json'), JSON.stringify(result, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
  return result;
}

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const bucket = new LocalFolderR2(root);
const gatewayOrigin = 'https://media-r2.internal';

const inputKey = 'uploads/generated-demo.mov';
const outputKey = 'converted/generated-demo-720p.mp4';
const fakeInput = Buffer.concat([
  Buffer.from('FAKE-MOV\n'),
  Buffer.from(crypto.getRandomValues(new Uint8Array(128))),
]);
await bucket.put(inputKey, fakeInput, { httpMetadata: { contentType: 'video/quicktime' } });

const getResponse = await handleMediaR2Gateway(new Request(`${gatewayOrigin}/in/${encodeURIComponent(inputKey)}`), bucket);
assert.equal(getResponse.status, 200);
assert.equal(getResponse.headers.get('content-type'), 'video/quicktime');
assert.deepEqual(Buffer.from(await getResponse.arrayBuffer()), fakeInput);

const gatewayOutputKey = 'converted/gateway-smoke.mp4';
const gatewayBytes = Buffer.from('gateway converted bytes');
const putResponse = await handleMediaR2Gateway(new Request(`${gatewayOrigin}/out/${encodeURIComponent(gatewayOutputKey)}`, {
  method: 'PUT',
  headers: { 'content-type': 'video/mp4' },
  body: gatewayBytes,
}), bucket);
assert.equal(putResponse.status, 200);
assert.deepEqual(await bucket.readBytes(gatewayOutputKey), gatewayBytes);

const conversion = await runMockVideoConvert({
  bucket,
  gatewayOrigin,
  payload: { inputKey, outputKey, format: 'mp4', maxHeight: 720, mode: 'mock' },
});
assert.equal(conversion.ok, true);
assert.equal(conversion.outputKey, outputKey);
assert.match(await bucket.readText(outputKey.replace(/\.[^.]+$/, '.conversion.json')), /Pseudo-sandbox run/);
assert.match(String(await bucket.readBytes(outputKey)), /MOCK MP4/);

const resultMarkdown = `# Mediabunny Flue video conversion local test results

Generated: ${new Date().toISOString()}

## What was tested

- Local folder shim for R2: \`${rootDisplay}\`
- Fake generated input object: \`${inputKey}\`
- Outbound Worker-style gateway:
  - \`GET /in/<inputKey>\` reads from the local R2 shim
  - \`PUT /out/<outputKey>\` writes to the local R2 shim
- Just Bash pseudo-sandbox smoke run
- Mock conversion output written to the R2 shim
- Conversion metadata JSON written to the R2 shim

## Result

\`\`\`json
${JSON.stringify({ ok: true, conversion, root: rootDisplay, gatewayOutputKey }, null, 2)}
\`\`\`

## Files written

\`\`\`txt
${inputKey}
${gatewayOutputKey}
${outputKey}
${outputKey.replace(/\.[^.]+$/, '.conversion.json')}
\`\`\`

## Interpretation

This verifies the orchestration shape without native media codecs:

\`\`\`txt
Flue-style agent logic
  → pseudo-sandbox work step
  → R2-backed input/output contract
  → outbound Worker-style R2 gateway
\`\`\`

To perform real video conversion, replace the Just Bash pseudo-sandbox with a Node-capable sandbox image that has:

\`\`\`bash
npm install mediabunny @mediabunny/server
\`\`\`

No secret-bearing R2 credentials need to enter the sandbox; the outbound Worker gateway owns R2 access.
`;

await writeFile(resultsPath, resultMarkdown);
console.log(resultMarkdown);
