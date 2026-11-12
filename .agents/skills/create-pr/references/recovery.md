# Recovery

Read this file in full after a failure, cancellation, concurrent change, or uncertain provider result, before any further effect.

After a failure, cancellation, concurrent change, or uncertain provider result, stop mutating. Preserve local commits and completed effects. Reconcile authoritative repository, provider, and tracker state, identify each completed operation, and never retry or duplicate an uncertain effect. Resume only a still-valid approved plan. Recovery that rewrites history, rolls back, or destroys anything needs its own approved plan under consumer policy.
