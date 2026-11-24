import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../front-door/worker.mjs';
function parse(html){const m=html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);assert.ok(m);return JSON.parse(m[1]);}
test('SOL technical evidence page has stable identity and no draft route',async()=>{const r=await worker.fetch(new Request('https://sol.foundercontrolroom.org/evidence.html'));assert.equal(r.status,200);const g=parse(await r.text());assert.deepEqual(g,parse(readFileSync(new URL('../evidence.html',import.meta.url),'utf8')));assert.equal(g['@id'],'https://sol.foundercontrolroom.org/#application');assert.equal(g.publisher['@id'],'https://www.jussco.company/#organization');assert.equal((await worker.fetch(new Request('https://sol.foundercontrolroom.org/discovery/project.json'))).status,404);assert.equal((await worker.fetch(new Request('https://sol.foundercontrolroom.org/evidence.html',{method:'POST'}))).status,404);});
