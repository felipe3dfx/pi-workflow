# Glossary Format

The resolved domain authority is a glossary, not a specification, scratch pad, or implementation record.

```md
# {Context Name}

{One or two sentences describing this context and why it exists.}

## Language

**Order**:
A one- or two-sentence definition of what the term is.
_Avoid_: Purchase, transaction
```

- Choose one canonical word when synonyms name the same concept; list useful alternatives under `_Avoid_`.
- Keep definitions to one or two sentences and define what the concept is, not what it does.
- Include context-specific concepts only. General programming concepts do not belong.
- Group terms under subheadings when natural clusters emerge; otherwise use one flat list.
- For a multi-context layout, invoke and consume `setup-workflow`'s context-map validator for the current invocation. Select a contextual glossary only when explicit current-invocation evidence yields exactly one validated entry; zero matches blocks and multiple matches require the user's choice. A `CONTEXT-MAP.md` routes authority; it is not a glossary, and topic wording or proximity never selects one of its entries.
- In the shared fallback, the content between the authority markers in `docs/agents/domain.md` is the authority: change `Authority state: absent (fallback-required)` to `present (fallback-established)` when adding the first term, then preserve everything outside that region. A map-available or root-selected state makes this region non-authoritative.
