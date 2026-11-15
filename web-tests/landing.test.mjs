import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PLACES,projectPoint,statePath,initLandingMap} from '../public/landing-map.mjs';

test('city focus uses the correct state and geographic coordinates',()=>{
 const states=JSON.parse(readFileSync(new URL('../public/data/states.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.values(PLACES).map(p=>p.state),['Oklahoma','Nebraska','Ohio']);
 for(const place of Object.values(PLACES)){
  const state=states.find(s=>s.name===place.state);
  assert.ok(state);
  const [x,y]=projectPoint(place.coordinates,place.bounds);
  assert.ok(x>0&&x<1280&&y>0&&y<800);
  assert.match(statePath(state.geometry,place.bounds),/^M.*Z$/);
 }
 assert.deepEqual(projectPoint([-100,40],[-110,30,-90,50]),[640,400]);
});

test('slow boundaries do not block city selection or reset a selected, locked region',async()=>{
 const element=()=>({style:{},dataset:{},attributes:{},listeners:{},innerHTML:'',
  setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,fn){this.listeners[k]=fn;},querySelectorAll(){return [];}});
 const nodes=Object.fromEntries(['aerial','imagery-status','map-lines','map','map-label','hero-region','hero-note','map-status'].map(id=>[id,element()]));
 const buttons=['US','Tulsa','Omaha','Columbus'].map(region=>Object.assign(element(),{dataset:{region}}));
 const originalDocument=globalThis.document,originalFetch=globalThis.fetch;
 let release,chosen;
 globalThis.document={getElementById:id=>nodes[id],querySelectorAll:()=>buttons};
 globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});
 try{
  const map=initLandingMap(city=>{chosen=city;});
  assert.equal(typeof map.showRegion,'function','controls must initialize without waiting for boundaries');
  buttons[2].listeners.click();
  map.setLocked(true);
  assert.equal(chosen,'Omaha');
  release({ok:true,json:async()=>JSON.parse(readFileSync(new URL('../public/data/states.json',import.meta.url),'utf8'))});
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(nodes['map'].attributes['aria-label'],/Nebraska/);
  assert.match(nodes['map-lines'].innerHTML,/<path/);
  assert.equal(buttons[2].attributes['aria-pressed'],'true');
  assert.equal(buttons[2].disabled,true);
  buttons[1].listeners.click();
  assert.equal(chosen,'Omaha');
 }finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
  globalThis.fetch=originalFetch;
 }
});

test('the map projection matches the satellite image extent at both corners',()=>{
 const bounds=[-129,16.375,-64,57];
 assert.deepEqual(projectPoint([-129,57],bounds),[0,0]);
 assert.deepEqual(projectPoint([-64,16.375],bounds),[1280,800]);
 assert.equal((bounds[2]-bounds[0])/(bounds[3]-bounds[1]),1280/800);
 for(const {bounds:b} of Object.values(PLACES))assert.equal((b[2]-b[0])/(b[3]-b[1]),1280/800);
});
