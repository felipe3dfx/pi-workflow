# Corrective Review

Read this file in full before step 1 whenever the caller hands over the last reviewed head and its findings with their state.

A review is full unless its caller hands over the last reviewed head and its findings with their state; then it is corrective: it reads only the delta from that head, with its surrounding context and affected code, and carries those findings. Its axes follow the delta: all three when it changes behavior, Spec and Valuable Tests when it changes only tests, otherwise Spec; any delta fixing a Standards finding adds Standards. Valuable Tests keeps its behavior baseline at the fixed point. After a rebase, the review is full.
