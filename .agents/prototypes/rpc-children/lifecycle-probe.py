import asyncio,json,os,pathlib,pty,signal,subprocess,sys,time,fcntl,termios,struct
from probe import ROOT,HERE,PI,agent,record
LOG=ROOT/"lifecycle.jsonl"
def rows():
 if not LOG.exists():return []
 return [json.loads(l) for l in LOG.read_text().splitlines()]
def wait(predicate,timeout=15):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if predicate(rows()):return
  time.sleep(.1)
 raise TimeoutError("event not seen; tail="+str(rows()[-5:]))
def run(mode):
 a=agent("lifecycle-"+mode); sock=str(ROOT/("life-"+mode+".sock"))
 master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack("HHHH",40,120,0,0))
 env={**os.environ,"TERM":"xterm-256color","PI_CODING_AGENT_DIR":str(a),"PROTO_SOCKET":sock,"PROTO_HERE":str(HERE),"PROTO_PI":PI,"PROTO_WORKTREE":str(ROOT/"worktree"),"PROTO_LIFECYCLE_LOG":str(LOG)}
 args=[PI,"--no-extensions","--no-skills","--no-prompt-templates","--no-approve","--extension",str(HERE/"parent.ts")]
 p=subprocess.Popen(args,cwd=ROOT/"worktree",env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
 os.close(slave)
 # Drain TUI bytes so PTY backpressure cannot masquerade as lifecycle failure.
 import threading
 output=bytearray()
 def drain():
  try:
   while b:=os.read(master,65536):output.extend(b)
  except OSError:pass
 threading.Thread(target=drain,daemon=True).start()
 def send(cmd):os.write(master,(cmd+"\r").encode());record("tui-command",mode=mode,pid=p.pid,command=cmd)
 wait(lambda rr:any(r.get("event")=="session_start" and r.get("pid")==p.pid for r in rr))
 time.sleep(.7);send("/fleet-start")
 wait(lambda rr:any(r.get("event")=="started" and r.get("pid")==p.pid for r in rr))
 time.sleep(1)
 send("/fleet-state");wait(lambda rr:any(r.get("event")=="state" and r.get("pid")==p.pid for r in rr))
 send("/reload")
 wait(lambda rr:any(r.get("event")=="load" and r.get("generation")==2 and r.get("pid")==p.pid for r in rr))
 time.sleep(.7);send("/fleet-state")
 wait(lambda rr:any(r.get("event")=="state" and r.get("generation")==2 and r.get("pid")==p.pid for r in rr))
 start=time.monotonic()
 if mode=="normal":send("/fleet-quit")
 else:os.kill(p.pid,signal.SIGKILL);record("kill",pid=p.pid,signal="SIGKILL")
 p.wait(timeout=15)
 supervisor=next(r["supervisor"] for r in rows() if r.get("event")=="started" and r.get("pid")==p.pid)
 wait(lambda rr:any(r.get("event")=="cleaned" and r.get("pid")==supervisor for r in rr))
 record("parent-exit",mode=mode,parent=p.pid,returncode=p.returncode,elapsed_ms=round((time.monotonic()-start)*1000,2),supervisor=supervisor)
 (ROOT/("tui-"+mode+".log")).write_bytes(output)
 os.close(master)
for mode in ["normal","sigkill"]:run(mode)
record("lifecycle-raw",rows=rows())
