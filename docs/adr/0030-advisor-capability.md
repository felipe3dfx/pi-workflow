# ADR 0030: Advisor capability and its selection default

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Feature brief: [advisor](../features/advisor.md).

Supersedes: ADR-0009, only its clause that a selection missing a harness capability is invalid, and only for the advisor. ADR-0012, only so that its single command entrypoint does not cover choosing the advisor model.

Amends: ADR-0025, only to add the advisor tool to its closed list of harness tools exempt from contextual classification. ADR-0015, only to add consulting the advisor to what the parent keeps in `orchestrator` while the advisor tool is offered.

The advisor is a harness capability that Configure seats or unseats with the others. It occupies the overlay, for `/workflow:advisor`, and the message stream, for its card. With no selection file, it is on, like every harness capability. A selection that names every other harness capability but not the advisor is valid and reads the advisor as on; every other value it holds is kept. A selection missing any other harness capability stays invalid, as ADR 0009 decides.

The advisor's model and thinking level are not part of the selection. `/workflow:advisor` chooses them and stores them in their own file in the agent directory, as `/workflow:models` does for model profiles outside `/workflow:config`; `/workflow:models` and model profiles do not carry them. The advisor never inherits the session model: while it is seated without a valid chosen model, its tool is not offered, so reading a missing key as on changes nothing until the operator chooses a model.

The advisor tool is exempt from contextual classification although it reaches an external service: it sends the parent's context to the advisor's provider, the same kind of egress as the parent's own model call, which authorization does not classify, possibly to a different provider, and it acts on no file or process. An advisor model that runs its own tools, such as a bridged model, is an accepted risk of the operator's model choice. In `orchestrator`, consulting the advisor stays with the parent, because it is not work a child session can do for it.

## Considered Options

- Refuse a selection without the advisor, as ADR 0009 decides. Rejected: Configure does not open on a refused selection, so every existing install would stay locked out until the operator deletes the file and loses its other values.
- Let Configure repair a refused selection. Rejected: it changes the approved Configure guide for one capability.
- Read a missing advisor as off. Rejected: it adds a Configure step with no behavior gain, because the tool needs a model anyway.
- Read a missing advisor as on. Chosen, as a deviation from the no-backward-compatibility principle that the developer accepted.
- Choose the advisor model inside the Configure guide. Rejected: a model catalog needs a stacked picker screen, which amends ADR 0009's single-list guide.

## Consequences

The tolerance covers the advisor alone; a later capability needs its own decision. The next apply writes the advisor key, after which the file is complete again.
