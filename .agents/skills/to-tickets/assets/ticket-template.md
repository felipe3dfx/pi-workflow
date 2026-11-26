# Ticket Template

```md
## Título

<Comportamiento y valor de producto.>

**Como** <actor>, **quiero** <capacidad>, **para** <resultado>.

### Comportamiento

- **Dado** <contexto>, **cuando** <acción>, **entonces** <resultado observable>.

### Criterios de aceptación

- [ ] <Resultado observable y verificable>

### Demo

<Precondición → acción → evidencia observable.>

### Alcance

<Qué cubre este ticket, en una frase.>

### Fuera de alcance

- <Límite solo si puede confundirse.>
```

When the tracker playbook has a "Ticket Body and Agent Attachments" section, the block is the ticket body written under it. Acceptance criteria state a decided behavior in domain language, never by its decision code. Detail only an agent needs stays in the specification. A decision's source, and detail the specification lacks, go in an English agent file attached to the ticket under that section; that file is where the ticket cites its decisions' sources and holds what an implementer needs beyond the body.
