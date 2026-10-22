import asyncio,json,os,pathlib,shutil,sys,time
from probe import RPC,ROOT,HERE,agent,record
async def main():
 frames=[]
 async def client(reader,writer):
  while line:=await reader.readline():
   m=json.loads(line); frames.append(m); record("channel",frame=m)
   if m.get("kind") in ["ask_parent","authorize"]:
    t=time.perf_counter();await asyncio.sleep(.25)
    answer="ACK" if m["kind"]=="ask_parent" else "allow"
    writer.write((json.dumps({"id":m["id"],"answer":answer})+"\n").encode());await writer.drain()
    record("channel-answer",answer=answer,blocked_ms=round((time.perf_counter()-t)*1000,2))
 sock=str(ROOT/"tools.sock"); srv=await asyncio.start_unix_server(client,sock)
 a=agent("tools-agent")
 r=await RPC().start(ROOT/"worktree",a,["--approve","--extension",str(HERE/"child.ts")],{"PROTO_SOCKET":sock})
 record("state",response=await r.call("get_state"))
 record("deterministic-command",response=await r.call("prompt",message="/prototype-check"))
 await asyncio.sleep(1)
 if not any(m.get("kind")=="scenario" for m in frames):
  await r.close()
  # Copy auth only to isolated scratch, never print contents.
  auth=pathlib.Path.home()/".pi/agent/auth.json"
  if auth.exists():
   shutil.copy2(auth,a/"auth.json");record("auth-copy",source=str(auth),target=str(a/"auth.json"))
   r=await RPC().start(ROOT/"worktree",a,["--approve","--extension",str(HERE/"child.ts")],{"PROTO_SOCKET":sock})
   record("model-state",response=await r.call("get_state"))
   record("model-prompt",response=await r.call("prompt",message="Call prototype_scenario exactly once with {}. Then reply only DONE."))
   deadline=time.monotonic()+90
   while not any(m.get("type")=="agent_settled" for m in r.events) and time.monotonic()<deadline:await asyncio.sleep(.1)
   record("rpc-events",events=r.events)
   record("messages",response=await r.call("get_messages"))
 await r.close();srv.close();await srv.wait_closed()
 record("summary",scenario=any(m.get("kind")=="scenario" for m in frames))
asyncio.run(main())
