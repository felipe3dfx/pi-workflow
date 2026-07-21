# Packed acceptance and release procedure

## Acceptance boundary

Run the public acceptance command with either a newly created package or an already-created release candidate:

```bash
npm run check:acceptance
node scripts/check-acceptance.mjs --tarball /absolute/path/to/release-candidate.tgz
```

The command creates at most one tarball, computes its SHA-256 digest, validates the packed distribution, extracts it into a temporary directory, and executes `scripts/run-packed-acceptance.mjs` from that extraction. The runner imports workflow modules only below the extracted package root. It uses deterministic in-memory fakes for Engram, Linear, the Pi runtime seam, filesystem mutation, and model availability. It does not use live systems or invoke `npm publish`.

The evidence validator fails closed unless every required scenario has a terminal expected status and at least one non-blank assertion. It also requires the exact tarball digest and origin, the complete safety boundary, exact scenario names, and a canonical report digest.

## Scenario matrix

| Scenario | Verified packed behavior |
| --- | --- |
| `packed-skills` | Four public skills and the canonical Spanish QA/Product goldens are present. |
| `define-product` | Exact Owner approval, mismatch refusal before persistence, and Engram create-only CAS/read-back. |
| `deliver-ticket` | Intentional `PI_WORKFLOW_CAPABILITY_PENDING` refusal and blocked tools. |
| `qa-handoff` | Spanish body, Linear comment read-back, unchanged issue snapshot, exact-repeat idempotency, and caller/authority refusals. |
| `product-review` | Owner-selected Spanish body, Linear comment read-back, unchanged issue snapshot, exact-repeat idempotency, and digest/authority refusals. |
| `sync` | Conditional writes, settled idempotency, rollback/resume recovery, and unmanaged-collision refusal. |
| `status` | Read-only checks and summary-only output. |
| `doctor` | Read-only checks and secret redaction. |
| `least-privilege-profiles` | Exact model registry queries, minimal research/prototype/to-tickets profiles, and capability/model drift refusals. |

## Repository gates

`npm run check` runs repository formatting-independent lint checks, TypeScript checking, dependency analysis, focused-test protection, generated/resource guards, package and release validation, all tests, packed distribution validation, and packed acceptance. `prepublishOnly` delegates to this complete gate.

The packed distribution validator requires the acceptance runner, evidence validator, public acceptance command, Spanish golden files, release validator, and `RELEASE_NOTES.md` to be present in the tarball.

## Release contract

1. Update `package.json` to the intended version.
2. Update `RELEASE_NOTES.md` in professional-neutral Spanish. Preserve the exact ordered, non-empty sections `Migraciones`, `Sync requerido`, `Cambios de capacidades`, and `Rollback`.
3. Run `npm run check`.
4. Create a GitHub Release whose tag is exactly `v<package.json version>`.
5. Use the exact `RELEASE_NOTES.md` content as the GitHub Release body.
6. Publish the GitHub Release.

The publish workflow validates the event tag and body again, then runs `npm publish --provenance --access public`. Publication occurs only in that workflow; acceptance produces evidence but never publishes.
