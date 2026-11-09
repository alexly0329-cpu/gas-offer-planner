import {readFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const site=join(root,'public');
for(const file of ['index.html','app.mjs','styles.css','model.mjs','reports.mjs','data/model.json','vendor/jspdf.umd.min.js','vendor/jspdf-LICENSE.txt']){
  assert.ok(existsSync(join(site,file)),`Missing browser asset: ${file}`);
}
const html=readFileSync(join(site,'index.html'),'utf8');
assert.match(html,/<title>[^<]*Gas[^<]*Planner[^<]*<\/title>/i);
assert.match(html,/app\.mjs/);
assert.match(html,/jspdf\.umd\.min\.js/);
const data=JSON.parse(readFileSync(join(site,'data/model.json'),'utf8'));
assert.deepEqual(Object.keys(data.cases),['Tulsa','Omaha','Columbus']);
assert.equal(data.n_sims,100000);
for(const [key,paths] of Object.entries(data.draws)){
  assert.equal(paths.reduce((sum,path)=>sum+path.count,0),100000,`Invalid draw count: ${key}`);
}
function inspect(dir){
  for(const name of readdirSync(dir)){
    const path=join(dir,name);
    assert.ok(!name.startsWith('.'),`Do not publish hidden file: ${path}`);
    assert.ok(!/\.(py|toml|heic|env)$/i.test(name),`Do not publish private/source file: ${path}`);
    if(statSync(path).isDirectory())inspect(path);
  }
}
inspect(site);
console.log('Browser entrypoint, local assets, source-data boundaries and Netlify publish directory verified.');
