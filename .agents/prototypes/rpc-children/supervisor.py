#!/usr/bin/env python3
"""Disposable POSIX watchdog: separate lifetime fd, RPC relay, process-tree groups.
Linux subreaper prevents losing reparented descendants. Not a sandbox."""
import asyncio,ctypes,json,os,pathlib,signal,subprocess,sys,time
LOG=pathlib.Path(os.environ["PROTO_LIFECYCLE_LOG"])
def log(**kw):
 with LOG.open("a") as f:f.write(json.dumps({"source":"supervisor","time":time.time(),"pid":os.getpid(),**kw})+"\n")
def descendants():
 ps=subprocess.Popen(["ps","-eo","pid=,ppid=,pgid="],stdout=subprocess.PIPE,text=True)
 rows=[list(map(int,l.split())) for l in ps.communicate()[0].splitlines()]
 ids={os.getpid()}; changed=True
 while changed:
  changed=False
  for pid,ppid,pgid in rows:
   if ppid in ids and pid not in ids:ids.add(pid);changed=True
 return [(pid,ppid,pgid) for pid,ppid,pgid in rows if pid in ids and pid not in (os.getpid(),ps.pid)]
async def main():
 if sys.platform=="linux":
  rc=ctypes.CDLL(None).prctl(36,1,0,0,0) # PR_SET_CHILD_SUBREAPER
  if rc:raise RuntimeError("subreaper failed")
 p=await asyncio.create_subprocess_exec(*sys.argv[1:],stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,start_new_session=True)
 log(event="spawn",child=p.pid,args=sys.argv[1:])
 async def relay_out(stream,fd):
  while data:=await stream.read(65536):os.write(fd,data)
 async def relay_in():
  while data:=await asyncio.to_thread(os.read,0,65536):
   try:p.stdin.write(data);await p.stdin.drain()
   except (BrokenPipeError,ConnectionResetError):break
 async def lifetime():
  await asyncio.to_thread(os.read,3,1)
 tasks=[asyncio.create_task(relay_in()),asyncio.create_task(relay_out(p.stdout,1)),asyncio.create_task(relay_out(p.stderr,2))]
 await lifetime()
 start=time.monotonic(); before=descendants();log(event="lifetime-eof",tree=before)
 # Pi MCP and bash may each create their OWN process group.
 groups={r[2] for r in before};groups.discard(os.getpgrp())
 for pg in groups:
  try:os.killpg(pg,signal.SIGTERM)
  except ProcessLookupError:pass
 await asyncio.sleep(.3)
 for pg in groups|{r[2] for r in descendants()}:
  if pg==os.getpgrp():continue
  try:os.killpg(pg,signal.SIGKILL)
  except ProcessLookupError:pass
 await p.wait()
 for _ in range(20):
  try:
   while os.waitpid(-1,os.WNOHANG)[0]:pass
  except ChildProcessError:break
  await asyncio.sleep(.05)
 log(event="cleaned",remaining=descendants(),elapsed_ms=round((time.monotonic()-start)*1000,2))
 for t in tasks:t.cancel()
 # reader threads blocked on fd0 do not define lifetime.
 os._exit(0)
asyncio.run(main())
