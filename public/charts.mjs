/* Dashboard charts: five-band gauge, five coloured columns and a horizontal meter. Pure SVG strings, no libraries. Styled in styles.css. */
const esc = value => String(value ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const BANDS = ['var(--band-critical)','var(--band-degraded)','var(--band-fair)','var(--band-good)','var(--band-optimal)'];

/** Semicircle gauge in five bands. A null value is Pending: bands dimmed, no needle. */
export function gauge({value, max, label, ariaLabel}) {
  const cx=120, cy=118, r=92, w=20, pending=value==null;
  const pt=(a,rad)=>[cx+rad*Math.cos(Math.PI-a), cy-rad*Math.sin(Math.PI-a)];
  const arc=(a0,a1)=>{const [x0,y0]=pt(a0,r),[x1,y1]=pt(a1,r);return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;};
  const s=pending?0:Math.max(0,Math.min(max,value));
  let segs='';
  BANDS.forEach((color,i)=>{
    const a0=(i/5)*Math.PI+.012, a1=((i+1)/5)*Math.PI-.012, lit=!pending&&(s>(i*max)/5||i===0);
    segs+=`<path d="${arc(a0,a1)}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="butt" opacity="${lit?1:.22}"/>`;
  });
  let needle='';
  if(!pending){const na=(s/max)*Math.PI,[nx,ny]=pt(na,r+10),[bx,by]=pt(na,r-w-6);needle=`<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/>`;}
  return `<svg class="gauge" viewBox="0 0 240 140" role="img" aria-label="${esc(ariaLabel)}">${segs}${needle}<text x="${cx}" y="${cy-22}" text-anchor="middle" class="g-score${pending?' pending':''}">${pending?'Pending':esc(String(value))}</text><text x="${cx}" y="${cy-2}" text-anchor="middle" class="g-label">${esc(label)}</text><text x="${cx-r}" y="${cy+16}" text-anchor="middle" class="g-tick">0</text><text x="${cx+r}" y="${cy+16}" text-anchor="middle" class="g-tick">${max}</text></svg>`;
}

/** Five coloured columns, one per band. items: [{name, sub, value}] */
export function bandBars(items, ariaLabel) {
  const W=520, H=230, padB=44, top=24, bw=74, gap=(W-bw*items.length)/(items.length+1);
  const max=Math.max(1,...items.map(i=>i.value));
  let out='';
  items.forEach((it,i)=>{
    const x=gap+i*(bw+gap), hgt=it.value?Math.max(3,((H-padB-top)*it.value)/max):2, y=H-padB-hgt;
    out+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${hgt.toFixed(1)}" rx="${it.value?4:1}" fill="${BANDS[i]}"/><text x="${(x+bw/2).toFixed(1)}" y="${(y-7).toFixed(1)}" text-anchor="middle" class="bb-val">${it.value}</text><text x="${(x+bw/2).toFixed(1)}" y="${H-24}" text-anchor="middle" class="bb-name">${esc(it.name)}</text><text x="${(x+bw/2).toFixed(1)}" y="${H-8}" text-anchor="middle" class="bb-sub">${esc(it.sub)}</text>`;
  });
  return `<svg class="bandbars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ariaLabel)}">${out}</svg>`;
}

/** Horizontal meter. A null percentage draws an empty track. */
export function meter(pct) {
  const width=pct==null||!Number.isFinite(pct)?0:Math.max(0,Math.min(100,pct));
  return `<div class="meter"><i style="width:${width.toFixed(1)}%"></i></div>`;
}
