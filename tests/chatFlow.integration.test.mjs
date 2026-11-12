import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

const pause = () => new Promise(resolve => setTimeout(resolve, 100));
async function freePort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('text-only Ollama answers two turns with each prompt once and ordered conversation history', async () => {
  const requests = [];
  const ollama = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'text-only:7b' }] }));
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion'] }));
    if (req.url === '/api/chat') {
      requests.push(JSON.parse(raw));
      return res.end(JSON.stringify({ message: { content: `Odpowiedź ${requests.length}` } }));
    }
    res.writeHead(404).end('{}');
  });
  ollama.listen(0, '127.0.0.1');
  await once(ollama, 'listening');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'bastilla-chat-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DATA_DIR: dataDir,
      DEBIAN13_API_PORT: String(await freePort()),
      OLLAMA_BASE_URL: `http://127.0.0.1:${ollama.address().port}`, OLLAMA_MODEL: 'text-only:7b',
      GEMINI_API_KEY: '', SVL_OPERATOR_TOKEN: 'integration-test-token-with-32-characters' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  let ticket = '';
  const state = async () => (await fetch(`${base}/api/state`, { headers: { 'X-SVL-Session': ticket } })).json();
  try {
    let snapshot;
    for (let i = 0; i < 150; i++) {
      try {
        const login = await fetch(`${base}/api/auth/login`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'integration-test-token-with-32-characters' }) });
        ticket = (await login.json()).sessionTicket || '';
        snapshot = await state(); if (snapshot.sessions) break;
      } catch {}
      await pause();
    }
    assert.ok(snapshot?.sessions, 'backend starts');
    const sessionId = snapshot.sessions.find(s => !s.archived).id;
    for (const content of ['Mam na imię Jan.', 'Jak mam na imię?']) {
      const response = await fetch(`${base}/api/messages`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SVL-Session': ticket },
        body: JSON.stringify({ sessionId, content, target: 'Wszyscy' }) });
      assert.equal(response.status, 202);
      const accepted = await response.json();
      let reply;
      for (let i = 0; i < 150; i++) {
        reply = (await state()).messages.find(m => m.id === accepted.response.id);
        if (reply?.status === 'delivered' || reply?.status === 'failed') break;
        await pause();
      }
      assert.equal(reply.status, 'delivered');
      assert.equal(reply.provider, 'Ollama · text-only:7b');
    }
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].messages.slice(1), [{ role: 'user', content: 'Mam na imię Jan.' }]);
    assert.deepEqual(requests[1].messages.slice(-3), [
      { role: 'user', content: 'Mam na imię Jan.' },
      { role: 'assistant', content: 'Odpowiedź 1' },
      { role: 'user', content: 'Jak mam na imię?' },
    ]);
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    await new Promise(resolve => ollama.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  }
});
