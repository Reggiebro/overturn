# Overturn for Intercom

Canvas Kit inbox app that captures what the AI drafted, what the agent sent, and why, as a replayable Overturn case.

## Behavior
- Detects draft-sized composer inserts (`Draft inserted · N words`).
- Distinguishes Fin/assist drafts vs human-written replies when origin is known: tags `draft:ai` for assists, `draft:manual` for human-typed drafts; otherwise origin tag.
- Reason picker (`reason_pack`, support default) + optional note; honors `require_reason`.
- On send, posts `POST /v1/capture` with `source: "intercom"` and `externalId: "ic:<conversation id>"`.
- Never blocks send on Overturn failures.

## Development
```bash
pnpm --filter @overturn-ai/intercom-app test
pnpm --filter @overturn-ai/intercom-app build
```

Payout/claim note (if maintainer supports crypto): EVM/Base/Polygon/BEP20 `0xE4BECfd60D9917946292E0d535081Dd005117069`, Solana `2LAnF7EeCeGSeHn1Pvu8onnX9CiHAjJwAHBE1pXdYKbp`.
