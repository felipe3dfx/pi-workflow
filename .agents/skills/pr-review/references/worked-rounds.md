# Worked Rounds

A maintainer reference: two rounds of one fictional pull request, showing a demonstrated defect, a hypothetical demand the critique discards, and a justified decision that stays visible without being a defect. A run does not need it. No test is run and nothing is published in either round.

The consumer's own standards take precedence over this example's code wherever they speak.

## The change

The pull request adds a daily job that emails a renewal reminder for every active policy expiring within the next 30 days. The ticket says: "Send one reminder to each active policy whose expiry date falls within the next 30 days, both ends included." The diff also adds a decision record choosing to send the emails synchronously inside the job, where the repository usually enqueues outbound email. The repository's instructions set Spanish for pull-request reviews, so the drafts are in Spanish.

## Round 1, head `a1b2c3d`

Axis results before critique:

- Correctness: `renewals/jobs.py:42` filters `expires_on < today + timedelta(days=30)`, so a policy expiring on day 30 gets no reminder; the ticket includes both ends. The only test, `renewals/tests/test_jobs.py:18`, uses day 29.
- Correctness: two concurrent runs of the job could send duplicate reminders; add a distributed lock.
- Decisions: the new decision record sends email synchronously, departing from the repository's queue. It documents the reason (the queue's retries would resend an email the provider already accepted), the benefit (no duplicates), the cost (a slow provider delays the whole job), and the consequence (the job's duration grows with volume).

Critique:

- The boundary finding is kept as a **blocker**: the requirement line and the code contradict each other, and the effect is a missed reminder for a whole day's policies.
- The lock finding is **discarded**: the scheduler configuration runs the job once a day under its own single-instance setting, and the ticket asks for nothing about concurrency. The risk is hypothetical here, not rare-but-supported.
- The decision stays **visible** under Important decisions. It is justified and documented, not a defect; whether the delay is acceptable at the expected volume is the human reviewer's call.

Draft excerpt:

```markdown
### Bloqueantes

- **Recordatorio omitido el día 30** — `renewals/jobs.py:42`. Hecho: el filtro usa
  `<`, y el ticket exige incluir ambos extremos. Impacto: las pólizas que vencen el
  día 30 no reciben recordatorio. Cómo resolverlo: usar `<=` y cubrir el día 30 en
  `renewals/tests/test_jobs.py`. Clasificación: bloqueante porque incumple el
  requisito de forma demostrable.

### Descartados

- Bloqueo distribuido contra ejecuciones concurrentes: el scheduler ya ejecuta el job
  una vez al día con instancia única y el ticket no pide concurrencia.
```

Event: `REQUEST_CHANGES` on `a1b2c3d`.

## Round 2, head `d4e5f6a`

The delta since `a1b2c3d` changes the filter to `<=` and adds a day-30 case. The review verifies the prior blocker against the new head and reads only that delta and the job it touches; it does not reopen the rest of the change.

Draft excerpt:

```markdown
### Bloqueantes

Resuelto desde la revisión anterior: recordatorio omitido el día 30
(`renewals/jobs.py:42` ahora usa `<=`, cubierto en `renewals/tests/test_jobs.py:31`).

Ninguno pendiente.
```

The decision on synchronous sending stays under Important decisions, unchanged. Event: `APPROVE` on `d4e5f6a`.
