import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadCase,buildOffer} from '../public/model.mjs';
import {evaluate,makeEntry,totals,isIncomplete,bookCsv,monthlyCsv,csvCell,sampleEntries,SAMPLE_INPUTS,BOOK_HEADERS,MONTHLY_HEADERS,AMOUNT_KEYS} from '../public/book.mjs';
const data=JSON.parse(readFileSync(new URL('../public/data/model.json',import.meta.url)));
const lines=text=>text.trimEnd().split('\n');

/** Same inputs the guided steps start with: costs, payment terms and credit all still pending. */
const pendingInputs=(over={})=>({customer:'Pending offer',city:'Tulsa',term:12,demand_basis:'benchmark',annual_gas:6100,weather_pct:20,margin:.2,
  costs:{fuel_pct:null,fuel_basis:null,supplier_fee:null,financing:null,residual_risk:null,credit_allowance:null},customer_days:null,supplier_days:null,credit_format:'amounts',
  amounts:Object.fromEntries(AMOUNT_KEYS.map(k=>[k,null])),ratios:{current_ratio:null,debt_ebitda:null,interest_coverage:null},unsecured_limit:null,additional_exposure:null,
  credit_reviewed:false,payment_delay_days:0,curve:null,market_source:'',market_date:'',commercial:{delivery_point:'',quote_valid_until:null,delivery_confirmed:false},...over});

test('three examples use the Tulsa 2027 curve with different volumes and margins',()=>{
  const entries=sampleEntries(data);
  assert.equal(entries.length,3);assert(entries.every(e=>e.example&&e.row.city==='Tulsa'&&e.row.term===12));
  assert.equal(new Set(entries.map(e=>e.row.annual_mmbtu)).size,3);
  assert.equal(new Set(entries.map(e=>e.row.margin_per)).size,3);
  const curve=loadCase(data,'Tulsa',12).market_curve;
  for(const e of entries){assert.equal(e.inputs.curve,null,'bundled reference curve');assert.equal(e.monthly.length,curve.length);
    assert.deepEqual(e.monthly.map(m=>m.hh),curve.map(r=>r.forward_usd_mmbtu));
    assert(!isIncomplete(e.row),e.row.customer+' is complete');}
});

test('book row matches the offer the guided steps would show',()=>{
  const inputs=pendingInputs(),entry=makeEntry(data,inputs,{id:'x'});
  const offer=buildOffer(loadCase(data,'Tulsa',12),null,{annual_gas:6100,weather_pct:20,margin:.2,costs:inputs.costs});
  assert.equal(entry.row.price,offer.fixed_price);assert.equal(entry.row.price.toFixed(4),'3.0171');
  assert.equal(entry.row.price_partial,true);assert.equal(entry.row.margin_total,offer.contribution);assert.equal(entry.row.margin_per,.2);
  assert.equal(entry.row.annual_mmbtu,offer.volume);
  assert.deepEqual(makeEntry(data,inputs,{id:'y'}).row,entry.row,'reopening and re-saving gives the same figures');
  assert.equal(evaluate(data,inputs).offer.fixed_price,offer.fixed_price);
});

test('24-month offers report annual volume, not term volume',()=>{
  const curve=[...loadCase(data,'Tulsa',12).market_curve,...Array.from({length:12},(_,i)=>({month:`2028-${String(i+1).padStart(2,'0')}`,forward_usd_mmbtu:3.5,basis_usd_mmbtu:-.2}))];
  const entry=makeEntry(data,pendingInputs({term:24,curve}),{id:'t'});
  const offer=buildOffer(loadCase(data,'Tulsa',24),curve,{});
  assert.equal(entry.row.annual_mmbtu,offer.volume/2);assert.equal(entry.monthly.length,24);
});

test('totals add up when every offer is complete',()=>{
  const entries=sampleEntries(data),t=totals(entries);
  const sum=key=>entries.reduce((a,e)=>a+e.row[key],0);
  assert.equal(t.count,3);assert.equal(t.incomplete,0);
  assert.equal(t.annual_mmbtu.value,sum('annual_mmbtu'));assert.equal(t.margin_total.value,sum('margin_total'));assert.equal(t.exposure.value,sum('exposure'));
  assert(t.exposure.value>0);assert([t.annual_mmbtu,t.margin_total,t.exposure].every(x=>x.pending===0));
});

test('Pending rule: one incomplete offer makes that total Pending, never zero, and is counted',()=>{
  const entries=[...sampleEntries(data),makeEntry(data,pendingInputs(),{id:'p'})];
  const incomplete=entries.at(-1).row;
  assert.equal(incomplete.exposure,null);assert.equal(incomplete.credit_result,null);assert.equal(incomplete.valid_until,null);assert(isIncomplete(incomplete));
  const t=totals(entries);
  assert.equal(t.exposure.value,null);assert.equal(t.exposure.pending,1);assert.equal(t.exposure.count,4);assert.equal(t.incomplete,1);
  assert.notEqual(t.annual_mmbtu.value,null,'columns with no Pending value still total');
  assert.equal(t.annual_mmbtu.value,entries.reduce((a,e)=>a+e.row.annual_mmbtu,0));
  assert.equal(t.margin_total.value,entries.reduce((a,e)=>a+e.row.margin_total,0));
  const second=totals([...entries,makeEntry(data,pendingInputs({customer:'Another'}),{id:'q'})]);
  assert.equal(second.exposure.pending,2);assert.equal(second.incomplete,2);
  assert.equal(totals([]).count,0);
});

test('book CSV has the agreed headers, a total row and Pending for unknowns',()=>{
  const entries=[...sampleEntries(data),makeEntry(data,pendingInputs(),{id:'p'})],out=lines(bookCsv(entries));
  assert.equal(out[0],BOOK_HEADERS.map(csvCell).join(','));
  assert.deepEqual(BOOK_HEADERS,['Customer label','Example','City','Term (months)','Annual MMBtu','Offer price ($/MMBtu)','Price status','Margin ($, full term)','Margin ($/MMBtu)','Credit result','Peak credit exposure ($)','Quote valid until']);
  assert.equal(out.length,1+4+1);
  const pending=out[4].split(','),total=out.at(-1).split(',');
  assert.equal(pending[1],'No');assert.equal(pending[6],'Partial subtotal');
  assert.deepEqual([pending[9],pending[10],pending[11]],['Pending','Pending','Pending']);
  assert(out[1].includes(',Yes,'));assert(total[0].startsWith('Total (4 offers)'));
  assert.equal(total[10],'Pending','exposure total stays Pending, not 0');
});

test('monthly CSV has the agreed headers and one row per offer per month',()=>{
  const entries=[...sampleEntries(data),makeEntry(data,pendingInputs(),{id:'p'})],out=lines(monthlyCsv(entries));
  assert.deepEqual(MONTHLY_HEADERS,['Customer label','Example','Month','Block MMBtu','Henry Hub ($/MMBtu)','Basis ($/MMBtu)','Revenue ($)','Cost ($)','Contribution ($)']);
  assert.equal(out[0],MONTHLY_HEADERS.map(csvCell).join(','));assert.equal(out.length,1+4*12);
  const last=out.at(-1).split(',');assert.equal(last[2],'2027-12');assert.deepEqual(last.slice(6),['Pending','Pending','Pending']);
  const firstExample=out[1].split(',');assert.equal(firstExample[1],'Yes');assert(Number(firstExample[6])>0);
});

test('CSV cells are quoted and guarded against spreadsheet formulas',()=>{
  assert.equal(csvCell('=SUM(A1)'),"'=SUM(A1)");assert.equal(csvCell('@x'),"'@x");assert.equal(csvCell('a,b'),'"a,b"');assert.equal(csvCell('say "hi"'),'"say ""hi"""');
  assert.equal(csvCell(null),'Pending');assert.equal(csvCell(NaN),'Pending');assert.equal(csvCell(0),'0');assert.equal(csvCell(1/3),'0.333333');
});

test('example labels carry no real company names',()=>{
  for(const inputs of SAMPLE_INPUTS)assert.match(inputs.customer,/^Example [ABC]: /);
});
