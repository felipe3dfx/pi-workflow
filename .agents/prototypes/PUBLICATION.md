# Fleet research publication

These four directories are accepted reference-only research. They are not an implementation base, an Approved Prototype UI Contract, or production guarantees. The governing feature and specification are in `docs/features/fleet-transcript-history.md` and `docs/specs/fleet-transcript-history.md`.

Before publication, the repository comment gate removed redundant narration from 15 JavaScript/Python fixture files. No executable statements, measured workloads, captured results or functional decisions changed. The surviving comments record external transport/ownership or persistence constraints. Executable-source comparison against the pre-publication copies and fresh checks validate this editorial transformation.

The experimental reports, measurements, RED outputs, historical source manifests and preservation logs remain byte-identical to their research-stage versions. Their line numbers and SHA-256 values describe those earlier snapshots. Commands using `preserved-before.sha256`, `preserved-after.sha256` or historical `source.sha256` can therefore report differences for the comment-cleaned files; those historical manifests were deliberately not rewritten to manufacture agreement.

For the published candidate, use:

```sh
sha256sum -c .agents/prototypes/published.sha256
```

`published.sha256` covers every file in these research directories and this notice, excluding itself. Evidence-generation commands should redirect to temporary destinations rather than replace accepted JSON files. Review the individual reports for genuine unsupported cases, cold-cache limits, fake-provider boundaries, partial coverage and synchronous-spool caveats.

No provider credentials or real session transcripts are included. Recorded local paths, fixture process identifiers and runtime timings are research provenance, not portable dependencies.
