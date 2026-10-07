export const HOST_DISCONNECT_GUARD_SCRIPT = String.raw`
import json, os, signal, subprocess, sys, threading, time

raw=sys.stdin.buffer.readline(131073)
if not raw.endswith(b'\n'): sys.exit(125)
payload=json.loads(raw)
prompt=payload.get('prompt') if isinstance(payload,dict) else None
if not isinstance(prompt,str): sys.exit(125)
child=subprocess.Popen(sys.argv[1:],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)

def stop_child():
 if child.poll() is not None: return
 try: os.killpg(child.pid,signal.SIGTERM)
 except ProcessLookupError: return
 time.sleep(1)
 try: os.killpg(child.pid,signal.SIGKILL)
 except ProcessLookupError: pass

def watch_stdin():
 try:
  while os.read(sys.stdin.fileno(),4096): pass
 except OSError: pass
 stop_child()

threading.Thread(target=watch_stdin,daemon=True).start()
try:
 child.stdin.write(prompt.encode('utf-8'))
 child.stdin.close()
 while True:
  data=os.read(child.stdout.fileno(),65536)
  if not data: break
  while data: data=data[os.write(sys.stdout.fileno(),data):]
 code=child.wait()
except BaseException:
 stop_child()
 child.wait()
 raise
sys.exit(code)
`;

export function guardDockerExecArgs(args) {
  if (args[0] !== 'exec' || args[1] !== '-i' || args[2] !== '--user' || args[3] !== 'hermes' || !args[4]) throw new TypeError('expected a Hermes docker exec command');
  return [...args.slice(0, 5), 'python3', '-u', '-c', HOST_DISCONNECT_GUARD_SCRIPT, ...args.slice(5)];
}

export function guardPrompt(prompt) {
  return `${JSON.stringify({ prompt })}\n`;
}
