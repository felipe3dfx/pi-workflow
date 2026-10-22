#!/usr/bin/env python3
"""Standalone-binary probes. All mutable state is in an explicit mktemp root."""
import asyncio, json, os, pathlib, shutil, statistics, subprocess, sys, time
HERE=pathlib.Path(__file__).resolve().parent
PI="/home/felipe3dfx/.local/share/mise/installs/pi/1.4.0/pi/pi"
ROOT=pathlib.Path(sys.argv[1]); ROOT.mkdir(exist_ok=True)
LOG=[]
def record(kind, **kw):
 row={"kind":kind,**kw}; LOG.append(row); print(json.dumps(row),flush=True)
def git(cwd,*args):
 p=subprocess.run(["git",*args],cwd=cwd,capture_output=True,text=True,check=True)
 record("git",cwd=str(cwd),args=args,stdout=p.stdout,stderr=p.stderr)
class RPC:
 async def start(self,cwd,agent,extra=[],env={}):
  self.events=[]; self.responses={}; self.n=0; self.err=b""
  args=[PI,"--mode","rpc","--session-dir",str(agent/"sessions"),"--no-extensions","--no-skills","--no-prompt-templates",*extra]
  self.t=time.perf_counter()
  self.p=await asyncio.create_subprocess_exec(*args,cwd=cwd,env={**os.environ,"PI_CODING_AGENT_DIR":str(agent),**env},stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,start_new_session=True)
  self.reader=asyncio.create_task(self.read()); self.er=asyncio.create_task(self.stderr())
  self.args=args; return self
 async def read(self):
  while line:=await self.p.stdout.readline():
   try: m=json.loads(line)
   except Exception: record("NON_JSON",line=line.decode()); continue
   self.events.append(m)
   if m.get("type")=="response" and m.get("id") in self.responses: self.responses.pop(m["id"]).set_result(m)
 async def stderr(self): self.err=await self.p.stderr.read()
 async def call(self,typ,timeout=20,**kw):
  self.n+=1; id=str(self.n); f=asyncio.get_running_loop().create_future(); self.responses[id]=f
  self.p.stdin.write((json.dumps({"id":id,"type":typ,**kw})+"\n").encode()); await self.p.stdin.drain()
  return await asyncio.wait_for(f,timeout)
 async def close(self):
  self.p.stdin.close()
  try: await asyncio.wait_for(self.p.wait(),6)
  except asyncio.TimeoutError: os.killpg(self.p.pid,9); await self.p.wait()
  await self.reader; await self.er
  if self.err: record("stderr",pid=self.p.pid,text=self.err.decode(errors="replace"))
def agent(name):
 p=ROOT/name;p.mkdir(exist_ok=True);return p
def config(path,servers):
 path.parent.mkdir(exist_ok=True,parents=True);path.write_text(json.dumps({"mcpServers":servers}))
def server(label):
 return {"command":shutil.which("node"),"args":[str(HERE/"mcp-server.mjs")],"env":{"PROTO_MCP_LOG":str(ROOT/"mcp.log"),"PROTO_LABEL":label},"exposure":"direct"}
async def q4():
 repo=ROOT/"repo";repo.mkdir();git(repo,"init")
 config(repo/".pi/mcp.json",{"project":server("tracked-project")})
 git(repo,"add",".");git(repo,"-c","user.name=proto","-c","user.email=proto@example.invalid","-c","commit.gpgsign=false","commit","-m","fixture")
 wt=ROOT/"worktree";git(repo,"worktree","add",str(wt))
 a=agent("q4-agent");config(a/"mcp.json",{"global":server("global")})
 for trust in ["--approve","--no-approve"]:
  before=(ROOT/"mcp.log").read_text() if (ROOT/"mcp.log").exists() else ""
  r=await RPC().start(wt,a,[trust,"--extension","builtin:mcp"]); state=await r.call("get_state");await asyncio.sleep(1)
  record("Q4",trust=trust,pid=r.p.pid,cwd=str(wt),args=r.args,state=state,elapsed_ms=round((time.perf_counter()-r.t)*1000,2),mcp=(ROOT/"mcp.log").read_text()[len(before):]);await r.close()
 un=ROOT/"untracked-parent";un.mkdir();git(un,"init");(un/"tracked.txt").write_text("fixture")
 git(un,"add",".");git(un,"-c","user.name=proto","-c","user.email=proto@example.invalid","-c","commit.gpgsign=false","commit","-m","fixture")
 config(un/".pi/mcp.json",{"only_parent":server("untracked-parent")})
 uw=ROOT/"untracked-worktree";git(un,"worktree","add",str(uw))
 before=(ROOT/"mcp.log").read_text()
 r=await RPC().start(uw,agent("untracked-agent"),["--approve","--extension","builtin:mcp"]);await r.call("get_state");await asyncio.sleep(.6);await r.close()
 record("Q4-untracked",parent_exists=(un/".pi/mcp.json").exists(),worktree_exists=(uw/".pi/mcp.json").exists(),mcp=(ROOT/"mcp.log").read_text()[len(before):])
 return wt
async def q1(wt):
 for variant in ["bare","small","mcp"]:
  for cache in ["cold-agent","warm-agent"]:
   a=agent("bench-"+variant+"-"+cache)
   if variant=="mcp": config(a/"mcp.json",{"project":server("bench-global-shadowed")})
   async def one(i):
    aa=a if cache=="warm-agent" else agent("cold-"+variant+"-"+str(i))
    if variant=="mcp":config(aa/"mcp.json",{"project":server("bench-global-shadowed")})
    extra=["--approve","--extension","builtin:mcp"] if variant=="mcp" else ["--no-approve","--no-mcp"]
    if variant=="small":extra+=["--extension",str(HERE/"small.ts")]
    cache_dir=aa/"cache";cache_dir.mkdir(exist_ok=True)
    env={"TMPDIR":str(cache_dir),"XDG_CACHE_HOME":str(cache_dir),"JITI_CACHE_DIR":str(cache_dir/"jiti"),"BUN_RUNTIME_TRANSPILER_CACHE_PATH":str(cache_dir/"bun")}
    r=await RPC().start(wt,aa,extra,env);s=await r.call("get_state")
    elapsed=(time.perf_counter()-r.t)*1000
    rss=subprocess.check_output(["ps","-o","rss=","-p",str(r.p.pid)],text=True).strip()
    row={"i":i,"ms":round(elapsed,2),"rss_KiB":int(rss),"success":s["success"],"pid":r.p.pid}
    await r.close();return row
   if cache=="warm-agent": await one(-1)
   serial=[await one(i) for i in range(5)]
   concurrent=await asyncio.gather(*(one(i+5) for i in range(5)))
   for mode,rows in [("serial",serial),("concurrent-5",concurrent)]:
    record("Q1",variant=variant,cache=cache,mode=mode,runs=rows,median_ms=statistics.median(x["ms"] for x in rows),max_ms=max(x["ms"] for x in rows))
async def main():
 record("environment",binary=PI,version=subprocess.check_output([PI,"--version"],text=True).strip(),root=str(ROOT),node=subprocess.check_output(["node","--version"],text=True).strip())
 wt=await q4()
 if os.environ.get("Q1","1")=="1":await q1(wt)
 (ROOT/"results.json").write_text(json.dumps(LOG,indent=2))
if __name__=="__main__":asyncio.run(main())
