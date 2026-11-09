import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('../',import.meta.url);
test('Netlify publishes the browser app instead of Python sources',()=>{
  const path=new URL('netlify.toml',root);
  assert.ok(existsSync(path),'A Netlify publish directory is required');
  const config=readFileSync(path,'utf8');
  assert.match(config,/publish\s*=\s*"public"/);
  assert.match(config,/command\s*=\s*"node scripts\/check-web\.mjs"/);
  assert.ok(existsSync(new URL('public/index.html',root)),'The published root needs index.html');
  for(const f of ['app.py','engine.py','financials.py','test_app.py','.git']){
    assert.equal(existsSync(new URL('public/'+f,root)),false,`Do not publish ${f}`);
  }
});

test('The fixed cohort data reproduces all seeded draw counts',()=>{
  const data=JSON.parse(readFileSync(new URL('public/data/model.json',root),'utf8'));
  assert.equal(data.seed,20261031);
  assert.equal(data.n_sims,100000);
  assert.deepEqual(Object.keys(data.cases),['Tulsa','Omaha','Columbus']);
  for(const n of [9,10])for(const term of [12,24]){
    const paths=data.draws[`${n}_${term}`];
    assert.equal(paths.reduce((sum,x)=>sum+x.count,0),100000);
    assert.equal(paths.length,n**(term/12));
    assert.ok(paths.every(x=>x.indices.length===term/12&&x.indices.every(i=>i>=0&&i<n)));
  }
});
