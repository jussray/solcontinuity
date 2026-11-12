import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../front-door/worker.mjs';
const home = 'https://sol.foundercontrolroom.org';
test('SOL front door serves the blueprint triptych landing at root', async () => {
  for(const url of [home+'/',home+'/?utm_source=preview',home+'/index.html']){
    const r=await worker.fetch(new Request(url));
    assert.equal(r.status,200);
    const body=await r.text();
    assert.match(body, /Your future remembers/);
    assert.match(body, /where you left off/);
    assert.match(r.headers.get('Content-Security-Policy'),/script-src 'none'/);
    assert.match(r.headers.get('Content-Security-Policy'),/form-action 'none'/);
  }
});
test('SOL auth panels and evidence page are served as static previews', async () => {
  const signin=await worker.fetch(new Request(home+'/signin.html'));
  assert.equal(signin.status,200);
  assert.match(await signin.text(), /Welcome Back/);
  const signup=await worker.fetch(new Request(home+'/signup.html'));
  assert.equal(signup.status,200);
  assert.match(await signup.text(), /Create your account/);
  const evidence=await worker.fetch(new Request(home+'/evidence.html'));
  assert.equal(evidence.status,200);
  assert.match(await evidence.text(), /SolContinuity: application-layer continuity/);
});
test('SOL CSS loads separately and invalid routes cannot expose FCR', async () => {
  for(const path of ['/sol.css','/site.css']){
    const css=await worker.fetch(new Request(home+path));
    assert.equal(css.status,200,path);
    assert.match(css.headers.get('Content-Type'),/text\/css/);
  }
  for(const path of ['/api/overview','/admin','/login','/dashboard','/api/chief/runtime-proof']){
    const r=await worker.fetch(new Request(home+path));
    assert.equal(r.status,404,path);
  }
  assert.equal((await worker.fetch(new Request(home+'/',{method:'POST'}))).status,404);
});
test('hostname and route scope exclude Founder Control Room', async () => {
  assert.equal((await worker.fetch(new Request('https://foundercontrolroom.org/'))).status,404);
  const cfg=JSON.parse(readFileSync(new URL('../wrangler.front-door.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.routes[0].pattern,'sol.foundercontrolroom.org/*');
  assert.equal(cfg.name,'solcontinuity-public-site');
  assert.equal(cfg.preview_urls,false);
});
