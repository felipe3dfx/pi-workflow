# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/domain-modeling>

<https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/domain-modeling>

## Author or owner

Matt Pocock

## License or terms

MIT

## Notice

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Retrieved

2026-08-25, at commit `885e2ca4d842d139e9aef4e48d366c63cb1b8013`.

2026-10-01, release v1.3 at commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`.

2026-10-01, the glossary rename, following upstream `mattpocock/skills` commit `e484a8095543718ced436b9b49a8160ed4554000`.

## Material used

The activation boundary; terminology challenge, sharpening, scenario, and code-evidence practices; inline glossary updates; glossary constraints; and the three-part ADR offering gate from `SKILL.md`, `CONTEXT-FORMAT.md`, and `ADR-FORMAT.md`. From `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, the trigger on writing or editing the glossary or an ADR directly. From `e484a8095543718ced436b9b49a8160ed4554000`, the `GLOSSARY.md` and `GLOSSARY-MAP.md` names and `GLOSSARY-FORMAT.md`.

## Modifications

Grupo Ilao made authority reading supporting work rather than activation; delegated layout discovery, shell ownership, marker validation, and drift reporting to `setup-workflow`; fixed the validator handoff to the deterministic sibling path `../setup-workflow/scripts/setup_workflow.py`; added fail-closed resolved-contract checks and the fallback glossary region; added glossary evidence, conflict visibility, and impact scope; adopted one root `docs/adr/` namespace instead of Matt's context-local ADR directories; adopted the upstream `GLOSSARY.md` and `GLOSSARY-MAP.md` names without a path for the retired `CONTEXT.md` and `CONTEXT-MAP.md`; and added the accepted ADR lifecycle, prefix checks, preview, approval, and reporting contracts from ADRs 0009–0011.

## Approval

Internal reuse under the MIT license was approved through Grupo Ilao skills issue #22.
