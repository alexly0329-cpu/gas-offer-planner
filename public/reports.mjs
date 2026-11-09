/* Anonymous PDFs: only controlled labels, calendar dates and finite numbers are rendered. */
const PENDING='Pending';
const COMPONENTS={supplier_fee:'Supplier fee',financing:'Financing',residual_risk:'Residual risk allowance',credit_allowance:'Credit allowance'};
const COLORS={ink:'#26242D',muted:'#64606F',lavender:'#EEE8FB',line:'#DAD1EB',paper:'#F9F7FE',white:'#FFFFFF'};
const finite=value=>{
 if(value===null||value===undefined||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))return null;
 if(typeof value!=='number'&&typeof value!=='string')return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
};
const fmt=(value,decimals=2,dollar=false)=>{
 const n=finite(value);return n===null?PENDING:(dollar?'$':'')+n.toLocaleString('en-US',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
};
const dateText=(value,monthOnly=false)=>{
 if(typeof value!=='string'||!(monthOnly?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}(?:-\d{2})?$/).test(value))return PENDING;
 const [year,month,day=1]=value.split('-').map(Number);
 const leap=year%4===0&&(year%100!==0||year%400===0);
 const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return year>=1&&month>=1&&month<=12&&day>=1&&day<=days[month-1]?value:PENDING;
};
const fullDate=value=>typeof value==='string'&&value.length===10?dateText(value):PENDING;
const daysText=value=>{const n=finite(value);return n!==null&&Number.isInteger(n)&&n>=0&&n<=365?n+' days':PENDING;};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const records=value=>Array.isArray(value)?value.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)).slice(0,24):[];

export function createProposalPdf(snapshot={}, {internal=false}={}){
 const JsPDF=globalThis.jspdf?.jsPDF||globalThis.window?.jspdf?.jsPDF;
 if(!JsPDF)throw new Error('The local PDF library is not available. Reload the page and try again.');
 const s=object(snapshot),customer=!internal;
 const doc=new JsPDF({unit:'pt',format:'letter',compress:false,putOnlyUsedFonts:true});
 doc.setProperties({title:customer?'Natural gas proposal':'Internal gas financial review',subject:'Estimated HVAC manufacturing profile - monthly gas blocks',author:'Gas planning report',creator:'Gas planning report',keywords:'Natural gas, estimated operating profile'});
 const M=42,W=528;let y=45,pageNumber=0;
 function text(value,x,at,size=10,color=COLORS.ink){doc.setFont('helvetica','normal');doc.setFontSize(size);doc.setTextColor(color);doc.text(String(value),x,at);}
 function page(first=false){
  if(pageNumber)doc.addPage();pageNumber++;y=45;
  if(first){doc.setFillColor(COLORS.paper);doc.rect(0,0,612,792,'F');}
  doc.setFillColor(COLORS.lavender);doc.roundedRect(523,24,47,20,10,10,'F');
  doc.setFontSize(8);doc.setTextColor(COLORS.ink);doc.text(String(pageNumber).padStart(2,'0'),546.5,37,{align:'center'});
  doc.setDrawColor(COLORS.line);doc.setLineWidth(.5);doc.line(M,762,570,762);
  text('NATURAL GAS ESTIMATE / NOT AN EXECUTABLE SUPPLIER QUOTE',M,775,6.5,COLORS.muted);
  doc.setFontSize(6.5);doc.text('PRIVATE IDENTIFIERS OMITTED',570,775,{align:'right'});
 }
 function p(value,{size=9.5,color=COLORS.ink,after=8,width=W,leading=size*1.35}={}){
  doc.setFont('helvetica','normal');doc.setFontSize(size);doc.setTextColor(color);
  const lines=doc.splitTextToSize(String(value),width);
  doc.text(lines,M,y+size,{lineHeightFactor:leading/size});y+=lines.length*leading+after;
 }
 function kicker(value){p(value,{size:8,color:COLORS.muted,after:14});}
 function title(value){p(value,{size:29,leading:33,after:12});}
 function heading(value){p(value,{size:13.5,leading:17,after:7});}
 function table(rows,widths,{size=8.7,padding=6,minHeight=22}={}){
  rows.forEach((row,index)=>{
   doc.setFont('helvetica','normal');doc.setFontSize(size);
   const lines=row.map((value,i)=>doc.splitTextToSize(String(value),widths[i]-padding*2));
   const h=Math.max(minHeight,...lines.map(a=>a.length*size*1.22+padding*2));
   if(index===0){doc.setFillColor(COLORS.lavender);doc.rect(M,y,W,h,'F');}
   let x=M;doc.setTextColor(COLORS.ink);
   lines.forEach((a,i)=>{doc.text(a,x+padding,y+padding+size,{lineHeightFactor:1.22});x+=widths[i];});
   doc.setDrawColor(COLORS.line);doc.setLineWidth(.35);doc.line(M,y+h,M+W,y+h);y+=h;
  });y+=10;
 }
 function hero(status,meaning){
  doc.setFillColor(COLORS.ink);doc.rect(M,y,W,86,'F');
  text('PRICE / USD PER MMBtu',M+16,y+23,9,COLORS.white);text(fmt(s.price,4,true),M+16,y+64,34,COLORS.white);
  text(status,M+245,y+23,10,COLORS.white);
  doc.setFontSize(9.5);doc.setTextColor(COLORS.white);
  doc.text(doc.splitTextToSize(meaning,267),M+245,y+43,{lineHeightFactor:1.3});y+=100;
 }
 const city={Tulsa:'Tulsa',Omaha:'Omaha',Columbus:'Columbus, Ohio','Columbus, Ohio':'Columbus, Ohio'}[s.city]||PENDING;
 const months=records(s.months),longTerm=s.term===24||months.length>12,term=[12,24].includes(s.term)?s.term:null;
 const existing=['Existing stress','Existing-offer stress','Existing offer stress'].includes(s.mode),blockLabel=existing?'Agreed':'Proposed';
 const components=object(s.additional_components),credit=object(s.credit),ratios=object(credit.ratios),risk=object(s.risk),financial=object(s.financials),inputs=object(financial.inputs),readiness=object(s.readiness);
 const price=finite(s.price),missing=Array.isArray(s.missing_inputs)?s.missing_inputs:[];
 const complete=price!==null&&!missing.length&&finite(s.fuel_adder)!==null&&Object.keys(COMPONENTS).every(key=>finite(components[key])!==null);
 const status=price===null?'Price unavailable':complete?'Cost assumptions complete':'Partial subtotal';
 const weather=finite(s.weather_pct)===null?PENDING:fmt(s.weather_pct,1)+'%';
 const fuel=finite(s.fuel_pct),fuelBasis={receipts:'percentage of receipts',customer:'percentage of customer deliveries'}[s.fuel_basis];
 const fuelKnown=fuel!==null&&fuel>=0&&!!fuelBasis&&(s.fuel_basis!=='receipts'||fuel<100);
 const score=finite(credit.score),scoreText=Number.isInteger(score)&&score>=0&&score<=6?score+' / 6':PENDING;
 const strong=credit.collateral_required===false&&score===6&&(!credit.review_flags||Array.isArray(credit.review_flags)&&credit.review_flags.length===0);
 const decision=credit.collateral_required===true?'Payment protection required: agree collateral or prepayment. Review missing or invalid inputs.':strong?'Ratio screen passes; confirm the exposure-based credit limit and any protection gap.':'Pending - complete credit review and agree payment protection.';
 const context=()=>{p('HVAC manufacturer - estimated operating profile',{size:10,after:5});p(`${city} / ${term?term+' months':PENDING} / ${dateText(s.delivery_start,true)} to ${dateText(s.delivery_end,true)}`,{size:8.5,color:COLORS.muted,after:15});};
 page(true);kicker('GAS PLANNING / ESTIMATED OPERATING PROFILE');title(customer?'Your gas proposal':'Internal financial review');context();
 hero(customer&&complete?'Indicative estimate':status,customer?(complete?'Review the price and conditions before agreement.':'The estimate is incomplete. Confirm outstanding items before agreement.'):(complete?'The amount includes supplied cost assumptions. Confirm inputs before using it.':'Known costs and target margin are included. Pending costs still need an input.'));
 table([[blockLabel+' monthly blocks / MMBtu','Fixed-block subtotal / USD'],[fmt(s.volume,1),fmt(s.block_value,2,true)]],[264,264],{size:10,padding:9,minHeight:29});
 heading('01 / What this means');p("You buy fixed monthly gas blocks. Usage above or below each block settles at that month's regional index. The subtotal is price times the blocks; it is not the full customer bill.",{after:8});
 if(customer){
  p('Utility delivery, transportation, taxes and any unconfirmed charges are outside this subtotal. Confirm final included items and the delivery point before commitment.',{size:8.7,color:COLORS.muted,after:14});
  heading('02 / Terms to confirm');
  table([['Term','Status'],['Customer payment after month-end invoice',daysText(inputs.customer_days)],['Quote valid until',fullDate(s.quote_valid_until)],['Market valuation date',dateText(s.market_as_of)],['Delivery point and matching regional index',readiness.delivery_confirmed===true?'Confirmation recorded':PENDING],['Payment terms and protection',readiness.credit_reviewed===true?'Review recorded; final terms need agreement':PENDING]],[285,243],{size:8.8,padding:6,minHeight:25});
  heading('03 / What happens next');p('Confirm the monthly schedule, payment arrangements, final price and delivery terms. This is an estimated proposal for discussion, not an executable supplier quote.',{after:8});
  p('Estimated operating profile. Check demand and weather assumptions against customer records. The regional price reference must match the agreed delivery route. Internal names and source notes are omitted.',{size:8.3,color:COLORS.muted,after:0});
  for(let year=0;year<(longTerm?2:1);year++){
   page();kicker('MONTHLY SCHEDULE / '+(longTerm?'YEAR '+(year+1):'DELIVERY PERIOD'));title(blockLabel+' monthly blocks');
   p('Fixed quantities for each month. Differences between actual use and these blocks settle at the matching regional index.',{after:16});
   const rows=months.slice(year*12,year*12+12).map(r=>[dateText(r.month,true),fmt(r.block_mmbtu,1)]);
   table([['Delivery month',blockLabel+' block / MMBtu'],...(rows.length?rows:[[PENDING,PENDING]])],[264,264],{size:10,padding:8,minHeight:29});
   p('MMBtu is a unit of gas energy. Displayed quantities are rounded; calculations use full precision. This schedule is subject to the final agreement.',{size:8.8,color:COLORS.muted,after:0});
  }
 }else{
  p('Modeled customer usage: '+fmt(s.expected_usage,1)+' MMBtu. Market as of: '+dateText(s.market_as_of)+'.',{size:8.5,color:COLORS.muted,after:11});
  heading('02 / How the price is built');
  table([['Component','USD / MMBtu'],['Henry Hub + regional basis, weighted by monthly blocks',fmt(s.commodity,4,true)],['Procurement fuel adder',fmt(s.fuel_adder,4,true)],...Object.entries(COMPONENTS).map(([key,label])=>[label,fmt(components[key],4,true)]),['Target margin before unmodeled costs',fmt(s.margin,4,true)]],[390,138],{size:8.5,padding:4,minHeight:20});
  const demandLabel={benchmark:'Benchmark annual gas use',user_total:'User-entered annual gas use'}[s.demand_basis];
  p((demandLabel?demandLabel+': '+fmt(s.reference_annual_gas,0)+' MMBtu.':'Annual gas use basis: Pending.')+' Customer meter records have not been supplied.',{size:8.3,color:COLORS.muted,after:5});
  p(existing?'Existing-offer stress: price, blocks and original costs remain frozen. Usage is stressed at '+weather+' HDD versus history.':'New offer: '+weather+' HDD versus history reprices quantity and monthly cost weights. Reference HDD: '+fmt(s.weather_reference_hdd,0)+'.',{size:8.3,color:COLORS.muted,after:0});
  page();kicker('UNDERSTAND THE LIMITS / COMPLETE THE INPUTS');title('Protection and next steps');
  heading('03 / Monthly hedge check');
  table([['Base-commodity Monte Carlo','Result'],['Matched monthly P95 loss / USD',fmt(risk.available===true?risk.loss_p95:null,2,true)],['Without hedges: P95 shortfall / USD',fmt(risk.available===true?risk.unhedged_loss_p95:null,2,true)],['P95 component premium / USD per MMBtu',fmt(risk.available===true?risk.risk_premium:null,4,true)]],[390,138],{size:9,padding:5,minHeight:23});
  p(risk.available===true?fmt(risk.n_sims,0)+' seeded draws from '+fmt(risk.n_unique_years,0)+' paired annual source years. P95 component premium = P95 loss / blocks.':'Risk result Pending. Complete monthly market inputs and source history are required.',{size:8.5,color:COLORS.muted,after:7});
  p('Only modeled commodity exposure cancels when customer blocks, both price components and monthly indexed deviations match. This measures change in gross contribution before unmodeled costs; it does not price remaining supplier risk.',{after:7});
  p('Daily/monthly mismatch, fuel, execution, fees, financing and credit remain outside the simulation. Full supplier risk remains unpriced unless an allowance is supplied.',{size:8.4,color:COLORS.muted,after:13});
  heading('04 / Credit ratios and payment protection');
  table([['Current ratio','Debt / EBITDA','EBIT / interest','Score'],[fmt(ratios.current_ratio),fmt(ratios.debt_ebitda),fmt(ratios.interest_coverage),scoreText]],[132,132,132,132],{size:9,padding:6});
  p(decision,{after:6});
  p('Analyst-chosen heuristic: 0-2 points per ratio. Strong means current ratio at least 1.5, debt/EBITDA at most 2 and EBIT/interest at least 4. Only 6/6 with no flags passes the ratio screen. It does not estimate default probability, a default premium or collateral approval.',{size:8.4,color:COLORS.muted,after:13});
  heading('05 / Before you use this estimate');
  p('1. Confirm every monthly market price, the delivery route, matching regional index and valuation date.',{size:8.6,after:6});
  p('2. Confirm fuel, fees, financing and risk/credit allowances. Pending means unknown, not zero.',{size:8.6,after:6});
  p('3. Complete financials and agree payment terms, approved exposure limits and any payment protection.',{size:8.6,after:6});
  p('4. Check customer demand, weather assumptions, instrument availability and contract terms before commitment.',{size:8.6,after:12});
  heading('06 / Glossary');p('MMBtu: gas energy. HDD: heating degree days, a measure of cold weather. Basis: regional price difference from Henry Hub. P95: the 95th percentile of modeled loss, not a guaranteed maximum.',{size:8.6,color:COLORS.muted,after:0});
  page();kicker('INTERNAL ONLY / REVENUE, COST AND CASH');title('Financial plan');
  table([['Full-term budget','USD'],['Customer revenue',fmt(financial.revenue,2,true)],['Budgeted supplier costs',fmt(financial.cost,2,true)],['Budgeted contribution',fmt(financial.contribution,2,true)],['Peak operating funding',fmt(financial.operating_funding,2,true)],['Funding with selected payment delay',fmt(financial.delayed_funding,2,true)]],[390,138],{size:8.5,padding:4,minHeight:20});
  p('Break-even block price: '+fmt(financial.break_even_price,4,true)+' / MMBtu. Customer payment: '+daysText(inputs.customer_days)+'; supplier payment: '+daysText(inputs.supplier_days)+' after month-end invoice. Payment-delay stress: '+daysText(inputs.payment_delay_days)+'.',{size:8.2,color:COLORS.muted,after:6});
  p('Budgeted expenses and reserves are not net income. Cash starts at zero and follows payment dates. Daily hedge collateral and future price-driven cash settlements are outside this operating cash plan.',{size:8.2,color:COLORS.muted,after:9});
  heading('Budget by quarter');
  const quarters=new Map();for(const row of records(financial.months)){
   const month=dateText(row.month,true);if(month===PENDING)continue;
   const key=month.slice(0,4)+' Q'+Math.ceil(Number(month.slice(5))/3);
   if(!quarters.has(key))quarters.set(key,[]);quarters.get(key).push(row);
  }
  const quarterRows=[...quarters].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>[key,...['revenue','total_cost','contribution'].map(k=>rows.length===3&&rows.every(r=>finite(r[k])!==null)?fmt(rows.reduce((sum,r)=>sum+finite(r[k]),0),2,true):PENDING)]);
  table([['Period','Revenue / USD','Costs / USD','Contribution / USD'],...(quarterRows.length?quarterRows:[[PENDING,PENDING,PENDING,PENDING]])],[102,142,142,142],{size:8.2,padding:4,minHeight:19});
  heading('Payment protection / estimated coverage');
  table([['Peak billed receivables','Total exposure','Unsecured limit used','Protection gap'],[fmt(financial.peak_receivables,2,true),fmt(financial.exposure,2,true),fmt(financial.effective_unsecured_limit,2,true),fmt(financial.protection_gap,2,true)]],[132,132,132,132],{size:8.2,padding:4,minHeight:22});
  p('Exposure uses base payment terms and adds billed receivables to the entered additional unbilled/close-out exposure. The gap subtracts the permitted unsecured limit. It is an estimate for review, not collateral approval; a strong score is not an unlimited credit line.',{size:8.1,color:COLORS.muted,after:6});
  p('Observed: NOAA weather and historical Henry Hub spot records. Estimated demand uses 60% steady / 40% weather-sensitive gas. The 6,100 MMBtu benchmark rounds a median of 14 assessment records, not a representative regional average. Bundled Tulsa basis is a route proxy with an indirectly corroborated date.',{size:8.1,color:COLORS.muted,after:6});
  const checks=[['Cost inputs','cost_complete'],['Market date','market_dated'],['Delivery/index','delivery_confirmed'],['Quote validity','quote_valid'],['Payment timing','payment_terms'],['Credit review','credit_reviewed']];
  p('Commercial checks: '+checks.map(([label,key])=>label+': '+(readiness[key]===true?'recorded':PENDING)).join('; ')+'.',{size:8.1,color:COLORS.muted,after:5});
  p('Demand validation: Pending. Match monthly customer bills and dates to weather before claiming forecast accuracy. Cost completeness alone does not make a firm quote.',{size:8.1,color:COLORS.muted,after:0});
  for(let year=0;year<(longTerm?2:1);year++){
   page();kicker('MONTHLY APPENDIX / '+(longTerm?'YEAR '+(year+1):'DELIVERY SCHEDULE'));title('Monthly detail');
   p(fuelKnown?'Fixed monthly blocks are customer deliveries. Both hedge totals cover the same fuel-inclusive procurement quantity. Same gas volume, two price components; do not add the legs or fuel again.':'Fixed monthly blocks. Customer-block hedges only: each price component covers the same block. Same gas volume; do not add the legs. Fuel execution quantities: Pending.',{after:8});
   p(fuelKnown?'Fuel: '+fmt(fuel)+'% as '+fuelBasis+'. Receipts: gross = q / (1 - f). Customer deliveries: gross = q * (1 + f).':'Fuel percentage / convention: Pending. Additional fuel execution quantity is unknown.',{size:8.4,color:COLORS.muted,after:12});
   const group=months.slice(year*12,year*12+12),rows=group.map(r=>[dateText(r.month,true),fmt(r.block_mmbtu,1),fmt(fuelKnown?r.hh_hedge_mmbtu:r.block_mmbtu,1),fmt(fuelKnown?r.basis_hedge_mmbtu:r.block_mmbtu,1),fmt(r.hh_reference,4,true),fmt(r.basis_reference,4,true)]);
   table([['Month','Customer block MMBtu','Henry Hub '+(fuelKnown?'total':'block')+' MMBtu','Regional basis '+(fuelKnown?'total':'block')+' MMBtu','HH reference USD/MMBtu','Basis reference USD/MMBtu'],...(rows.length?rows:[[PENDING,PENDING,PENDING,PENDING,PENDING,PENDING]])],[72,87,90,93,93,93],{size:8.2,padding:5,minHeight:21});
   const example=group.find(r=>dateText(r.month,true)!==PENDING&&finite(r.block_mmbtu)>0&&finite(r.hh_reference)!==null&&finite(r.basis_reference)!==null);
   if(example){
    const q=finite(example.block_mmbtu),index=finite(example.hh_reference)+finite(example.basis_reference),actual=finite(example.modeled_use_mmbtu);
    heading('Worked example / '+dateText(example.month,true));
    p('Block: '+fmt(q)+' MMBtu. Entered reference index: '+fmt(index,4,true)+' per MMBtu (Henry Hub + basis).',{size:8.4,color:COLORS.muted,after:4});
    p('Reference cost: '+fmt(q*index,2,true)+' of base commodity, before fuel, fees and margin.',{size:8.4,color:COLORS.muted,after:4});
    if(actual!==null)p('Modeled usage: '+fmt(actual)+' MMBtu. Deviation: '+fmt(actual-q)+' MMBtu. Value at the reference index: '+fmt((actual-q)*index,2,true)+'.',{size:8.4,color:COLORS.muted,after:4});
    p('This is not a forecast of the settlement index.',{size:8.4,color:COLORS.muted,after:7});
   }else p('Worked example: Pending. Supply a monthly block and both reference prices.',{size:8.4,color:COLORS.muted,after:10});
   p('Figures are rounded for display; calculations use full precision. Actual execution, instruments and lot sizes require confirmation; this table is not an exchange order.',{size:8.4,color:COLORS.muted,after:12});
   heading('Method and sources');
   p('NOAA historical HDD and EIA Henry Hub spot-price histories are paired by whole year and centered on the entered curve; regional basis is fixed. Two-year terms independently resample annual blocks. These histories are not forward quotes. Only Tulsa 2027 has a bundled complete curve; other cities and 2028 need separate monthly prices.',{size:8.4,color:COLORS.muted,after:7});
   p('Identifiers and freeform notes are omitted. No customer forecasting accuracy is asserted. Estimated operating profile. Educational estimate only. No trade is placed.',{size:8.4,color:COLORS.muted,after:0});
  }
 }
 return new Uint8Array(doc.output('arraybuffer'));
}

export function downloadProposal(snapshot,{internal=false}={}){
 const bytes=createProposalPdf(snapshot,{internal});
 const blob=new Blob([bytes],{type:'application/pdf'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
 anchor.href=url;anchor.download=internal?'estimated-hvac-gas-internal-review.pdf':'estimated-hvac-gas-proposal.pdf';
 document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 return bytes;
}
