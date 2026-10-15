"""Owned Linux PTY; simplified Pi TuiMainScreen renderer, NOT physical display."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
HERE = Path(__file__).resolve().parent
KEYS = [('reopen', b'\r'), ('older-detach', b'\x1b[5~'), ('collapse-expand', b'\x14'), ('newer-detached', b'\x1b[6~'), ('expand-collapse', b'\x14'), ('follow', b'f')]
def run(mode):
    with tempfile.TemporaryDirectory(prefix='fleet-integrated-pty-') as root:
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',40,55,0,0))
        process = subprocess.Popen(['node',str(HERE/'case.mjs'),mode,root,'pty'],stdin=slave,stdout=slave,stderr=subprocess.PIPE,env={'PATH':os.environ['PATH'],'HOME':root,'LANG':'C.UTF-8','TERM':'xterm-256color','PI_OFFLINE':'1'},start_new_session=True)
        os.close(slave)
        sent=[]; seen={}; buffer=b''; due=float('inf'); deadline=time.monotonic()+40
        try:
            while time.monotonic()<deadline:
                ready,_,_=select.select([master],[],[],0.01)
                if ready:
                    try: data=os.read(master,65536)
                    except OSError as e:
                        if e.errno==errno.EIO: break
                        raise
                    buffer=(buffer+data)[-100000:]
                    for m in re.finditer(rb'INTEGRATED_(\d+)_END',buffer): seen.setdefault(int(m[1]),time.monotonic_ns())
                if Path(root,'streaming').exists() and not sent: due=min(due,time.monotonic())
                if len(sent)<len(KEYS) and time.monotonic()>=due and (not sent or len(sent) in seen):
                    name,key=KEYS[len(sent)];sent.append({'seq':len(sent)+1,'action':name,'ns':time.monotonic_ns()});os.write(master,key);due=time.monotonic()+0.18
                if process.poll() is not None: break
            process.wait(timeout=4)
            assert process.returncode==0,process.stderr.read().decode()
            result=json.loads(Path(root,'result.json').read_text());events=result.pop('timing');probes=[]
            assert result.get('refused') is None
            assert len(sent)==6
            for s in sent:
                ev=next(e for e in events if e['type']=='write' and e['seq']==s['seq'])
                probes.append({'action':s['action'],'inputToWriteMs':(int(ev['ns'])-s['ns'])/1e6,'inputToPtyReadMs':(seen[s['seq']]-s['ns'])/1e6})
            actions=[e for e in events if e['type']=='action'];assert len(actions)==6
            assert actions[1]['follow'] is False and actions[-1]['follow'] is True
            assert actions[1]['anchor']==actions[2]['anchor'], 'toggle changed ordinal anchor'
            renders=[e for e in events if e['type']=='render'];assert all(e['entries']<=8 and e['residentBytes']<=196608 for e in renders)
            return {'result':result,'probes':probes,'actions':actions,'renders':renders}
        finally:
            try: os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait();os.close(master);process.stderr.close()
if __name__=='__main__':
    samples=[]
    for repeat in range(2):
        for mode in ['sdk','rpc']:
            samples.append({'repeat':repeat,'mode':mode,**run(mode)})
    print(json.dumps({'harness':'Pi TuiMainScreen/ProcessTerminal + Linux PTY; same bounded capture/read/render policy SDK/RPC; simplified renderer','samples':samples},indent=2))
