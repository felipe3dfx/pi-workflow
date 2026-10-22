"""Assertions over captured real-binary evidence; does not invoke Pi or a model."""
import json,pathlib
P=pathlib.Path(__file__).resolve().parent
def read(name):return [json.loads(l) for l in (P/name).read_text().splitlines()]
q1=read("evidence-q1-cache-isolated.jsonl")
assert len(q1)==12
for r in q1:
 assert len(r["runs"])==5 and all(x["success"] and x["ms"]>0 and x["rss_KiB"]>0 for x in r["runs"])
print("Q1: 60 successful timed responses; all 12 cells have N=5 and RSS")
q4=read("evidence-q4.jsonl")
for r in [x for x in q4 if x["kind"]=="Q4"]:
 events=[json.loads(l) for l in r["mcp"].splitlines()]
 starts=[e["label"] for e in events if e["event"]=="start"]
 assert "global" in starts
 assert ("tracked-project" in starts)==(r["trust"]=="--approve")
 for e in events:
  assert e["cwd"]==r["cwd"]
  roots=e.get("message",{}).get("result",{}).get("roots")
  if roots:assert roots[0]["uri"]=="file://"+r["cwd"]
 assert any(e.get("message",{}).get("result",{}).get("roots") for e in events)
u=next(x for x in q4 if x["kind"]=="Q4-untracked")
assert u["parent_exists"] and not u["worktree_exists"] and not u["mcp"]
print("Q4: global + trusted-only project, exact cwd/roots, absent untracked config")
q2=read("evidence-q2-final.jsonl")
scenario=next(r["frame"]["out"] for r in q2 if r["kind"]=="channel" and r["frame"]["kind"]=="scenario")
assert scenario["ask"]["result"]["details"]["answer"]=="ACK"
assert scenario["guard"]["isError"] and scenario["blocked"]["isError"]
assert scenario["replaced"]["result"]["content"][0]["text"]=="authorized-replacement"
assert not scenario["reported"]["isError"]
events=next(r["events"] for r in q2 if r["kind"]=="rpc-events")
assert any(e["type"]=="agent_settled" and not e["aborted"] for e in events)
assert any(e["type"]=="message_end" and e["message"]["role"]=="assistant" and any(c.get("text")=="DONE" for c in e["message"]["content"]) for e in events)
assert len([r for r in q2 if r["kind"]=="channel-answer" and r["blocked_ms"]>=250])==2
print("Q2: real nested tool gates, consultations, report and DONE + settled")
q3=read("evidence-q3-final.jsonl")
rows=next(r["rows"] for r in q3 if r["kind"]=="lifecycle-raw")
for end in [r for r in q3 if r["kind"]=="parent-exit"]:
 states=[r for r in rows if r["event"]=="state" and r["pid"]==end["parent"]]
 assert [s["generation"] for s in states]==[1,2]
 assert len({s["state"]["data"]["sessionId"] for s in states})==1
 assert all(s["state"]["success"] and s["ping"]["success"] for s in states)
 assert any(r["event"]=="session_shutdown" and r.get("reason")=="reload" and r["pid"]==end["parent"] for r in rows)
 clean=next(r for r in rows if r["event"]=="cleaned" and r["pid"]==end["supervisor"])
 assert not clean["remaining"]
 tree=next(r["tree"] for r in rows if r["event"]=="lifetime-eof" and r["pid"]==end["supervisor"])
 assert len(tree)>=4 and len({x[2] for x in tree})>=3
print("Q3: same session/handles across real /reload; both Linux exit trees empty")
