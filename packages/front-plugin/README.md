# Overturn for Front

Front plugin that captures what the AI drafted, what the agent sent, and why, as a replayable Overturn case.

## Behavior
- Detects draft-sized reply box inserts (`Draft inserted · N words`).
- Reason picker (`reason_pack`, claims/support) + optional note; honors `require_reason`.
- On send, posts `POST /v1/capture` with `source: "front"` and `externalId: "fr:<conversation id>"`.
- Never blocks send on capture failures (logs/surfaces in panel).

## Development
```bash
pnpm --filter @overturn-ai/front-plugin test
pnpm --filter @overturn-ai/front-plugin build
```

Payout/claim note (if maintainer supports crypto): EVM/Base/Polygon/BEP20 `0xE4BECfd60D9917946292E0d535081Dd005117069`, Solana `2LAnF7EeCeGSeHn1Pvu8onnX9CiHAjJwAHBE1pXdYKbp`.
