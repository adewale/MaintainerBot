# Mediabunny Flue video conversion local test results

Generated: 2026-05-25T00:32:07.176Z

## What was tested

- Local folder shim for R2: `.tmp/mediabunny-local-r2`
- Fake generated input object: `uploads/generated-demo.mov`
- Outbound Worker-style gateway:
  - `GET /in/<inputKey>` reads from the local R2 shim
  - `PUT /out/<outputKey>` writes to the local R2 shim
- Just Bash pseudo-sandbox smoke run
- Mock conversion output written to the R2 shim
- Conversion metadata JSON written to the R2 shim

## Result

```json
{
  "ok": true,
  "conversion": {
    "ok": true,
    "mode": "mock",
    "note": "Pseudo-sandbox run. Swap makeJustBashPseudoSandbox() for a real Node-capable sandbox to transcode with Mediabunny.",
    "inputKey": "uploads/generated-demo.mov",
    "outputKey": "converted/generated-demo-720p.mp4",
    "format": "mp4",
    "maxHeight": 720,
    "wouldFetchFrom": "https://media-r2.internal/in/uploads%2Fgenerated-demo.mov",
    "wouldUploadTo": "https://media-r2.internal/out/converted%2Fgenerated-demo-720p.mp4",
    "generatedAt": "2026-05-25T00:32:07.175Z"
  },
  "root": ".tmp/mediabunny-local-r2",
  "gatewayOutputKey": "converted/gateway-smoke.mp4"
}
```

## Files written

```txt
uploads/generated-demo.mov
converted/gateway-smoke.mp4
converted/generated-demo-720p.mp4
converted/generated-demo-720p.conversion.json
```

## Interpretation

This verifies the orchestration shape without native media codecs:

```txt
Flue-style agent logic
  → pseudo-sandbox work step
  → R2-backed input/output contract
  → outbound Worker-style R2 gateway
```

To perform real video conversion, replace the Just Bash pseudo-sandbox with a Node-capable sandbox image that has:

```bash
npm install mediabunny @mediabunny/server
```

No secret-bearing R2 credentials need to enter the sandbox; the outbound Worker gateway owns R2 access.
