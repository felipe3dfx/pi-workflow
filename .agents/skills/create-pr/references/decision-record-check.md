# Decision-Record Check

Read this file when the candidate adds or renames a decision record with a four-digit prefix, before the first effect.

When the candidate adds or renames a decision record with a four-digit prefix, check the combined target: capture the confirmed destination's commit OID and verify that no prefix or exact path in the candidate collides with one on that target. Bind the result to that OID and recheck it immediately before the push and before opening the pull request; a moved target invalidates it. A collision blocks publication and is reported; never renumber.
