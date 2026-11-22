// Tiny diagram DSL → (1) a real .excalidraw file (open/edit at excalidraw.com) and (2) a hand-drawn PNG via rough.js.
import { writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

export const C = {
  ink: '#1e1e1e',
  muted: '#5c5f66',
  violet: '#6741d9', violetBg: '#e5dbff',
  teal: '#0c8599', tealBg: '#c5f6fa',
  green: '#2b8a3e', greenBg: '#d3f9d8',
  red: '#c92a2a', redBg: '#ffe3e3',
  yellow: '#e67700', yellowBg: '#fff3bf',
  blue: '#1971c2', blueBg: '#d0ebff',
  gray: '#495057', grayBg: '#f1f3f5',
  white: '#ffffff',
};

export class Diagram {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.els = [];
  }
  box(x, y, w, h, o = {}) {
    this.els.push({ kind: 'box', x, y, w, h, stroke: o.stroke ?? C.ink, fill: o.fill ?? 'transparent', dashed: !!o.dashed, solid: !!o.solid, rounded: o.rounded ?? true, sw: o.sw ?? 2 });
    if (o.text) this.text(x + (o.pad ?? 18), y + (o.padTop ?? 16), o.text, { size: o.size ?? 22, color: o.color ?? C.ink, w: w - 2 * (o.pad ?? 18), font: o.font });
    return this;
  }
  ellipse(x, y, w, h, o = {}) {
    this.els.push({ kind: 'ellipse', x, y, w, h, stroke: o.stroke ?? C.ink, fill: o.fill ?? 'transparent', solid: !!o.solid, sw: o.sw ?? 2 });
    if (o.text) this.text(x + w / 2, y + h / 2 - (o.size ?? 24) * 0.62, o.text, { size: o.size ?? 24, color: o.color ?? C.ink, align: 'center', font: o.font ?? 'hand' });
    return this;
  }
  /** text: "\n" for new lines; lines starting with "# " are rendered bold/title-ish */
  text(x, y, text, o = {}) {
    this.els.push({ kind: 'text', x, y, text, size: o.size ?? 22, color: o.color ?? C.ink, align: o.align ?? 'left', font: o.font ?? 'hand', w: o.w });
    return this;
  }
  arrow(x1, y1, x2, y2, o = {}) {
    this.els.push({ kind: 'arrow', pts: o.via ? [[x1, y1], ...o.via, [x2, y2]] : [[x1, y1], [x2, y2]], stroke: o.stroke ?? C.ink, dashed: !!o.dashed, sw: o.sw ?? 2, both: !!o.both });
    if (o.label) {
      const mid = o.labelAt ?? [(x1 + x2) / 2, (y1 + y2) / 2 - (o.size ?? 19) * 1.5];
      this.text(mid[0], mid[1], o.label, { size: o.size ?? 19, color: o.labelColor ?? o.stroke ?? C.ink, align: o.align ?? 'center', font: o.font ?? 'hand' });
    }
    return this;
  }

  // ---------------------------------------------------------------- .excalidraw
  toExcalidraw() {
    let seed = 1000;
    const base = (extra) => ({
      id: 'el' + seed,
      angle: 0,
      strokeColor: C.ink,
      backgroundColor: 'transparent',
      fillStyle: 'hachure',
      strokeWidth: 2,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: seed++,
      version: 1,
      versionNonce: seed * 7,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      ...extra,
    });
    const out = [];
    for (const e of this.els) {
      if (e.kind === 'box' || e.kind === 'ellipse')
        out.push(
          base({
            type: e.kind === 'box' ? 'rectangle' : 'ellipse',
            x: e.x,
            y: e.y,
            width: e.w,
            height: e.h,
            strokeColor: e.stroke,
            backgroundColor: e.fill,
            fillStyle: e.solid ? 'solid' : 'hachure',
            strokeWidth: e.sw,
            strokeStyle: e.dashed ? 'dashed' : 'solid',
            roundness: e.kind === 'box' && e.rounded ? { type: 3 } : null,
          }),
        );
      else if (e.kind === 'text') {
        const lines = e.text.replace(/^# /gm, '').split('\n');
        const longest = Math.max(...lines.map((l) => l.length));
        const width = Math.max(10, longest * e.size * 0.52);
        out.push(
          base({
            type: 'text',
            x: e.align === 'center' ? e.x - width / 2 : e.x,
            y: e.y,
            width,
            height: lines.length * e.size * 1.25,
            strokeColor: e.color,
            text: lines.join('\n'),
            originalText: lines.join('\n'),
            fontSize: e.size,
            fontFamily: e.font === 'mono' ? 3 : 1,
            textAlign: e.align,
            verticalAlign: 'top',
            containerId: null,
            lineHeight: 1.25,
            autoResize: true,
          }),
        );
      } else if (e.kind === 'arrow') {
        const [x0, y0] = e.pts[0];
        const pts = e.pts.map(([x, y]) => [x - x0, y - y0]);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        out.push(
          base({
            type: 'arrow',
            x: x0,
            y: y0,
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
            strokeColor: e.stroke,
            strokeWidth: e.sw,
            strokeStyle: e.dashed ? 'dashed' : 'solid',
            points: pts,
            lastCommittedPoint: null,
            startBinding: null,
            endBinding: null,
            startArrowhead: e.both ? 'arrow' : null,
            endArrowhead: 'arrow',
            roundness: null,
          }),
        );
      }
    }
    return { type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: out, appState: { viewBackgroundColor: '#ffffff', gridSize: null }, files: {} };
  }

  // ---------------------------------------------------------------- PNG via rough.js
  async renderPng(path, root) {
    const rough = readFileSync(root + 'node_modules/roughjs/bundled/rough.js', 'utf8');
    const font = (f) => readFileSync(root + `node_modules/@fontsource/${f}`).toString('base64');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Hand;src:url(data:font/woff2;base64,${font('kalam/files/kalam-latin-400-normal.woff2')}) format('woff2');font-weight:400}
@font-face{font-family:Hand;src:url(data:font/woff2;base64,${font('kalam/files/kalam-latin-700-normal.woff2')}) format('woff2');font-weight:700}
@font-face{font-family:Title;src:url(data:font/woff2;base64,${font('caveat/files/caveat-latin-700-normal.woff2')}) format('woff2');font-weight:700}
html,body{margin:0;background:#fff}
</style></head><body><svg id="s" xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}"></svg>
<script>${rough}</script><script>
const els=${JSON.stringify(this.els)};
const svg=document.getElementById('s');const rc=rough.svg(svg);let seed=7;
const ns='http://www.w3.org/2000/svg';
const bg=document.createElementNS(ns,'rect');bg.setAttribute('width','100%');bg.setAttribute('height','100%');bg.setAttribute('fill','#fff');svg.appendChild(bg);
const opt=(e)=>({seed:seed++,roughness:1.1,bowing:1,stroke:e.stroke,strokeWidth:e.sw,fill:e.fill==='transparent'?undefined:e.fill,fillStyle:e.solid?'solid':'hachure',hachureGap:9,fillWeight:1.4,strokeLineDash:e.dashed?[10,8]:undefined});
for(const e of els){
  if(e.kind==='box'){
    if(e.rounded){const r=Math.min(18,e.w/6,e.h/6);const p='M'+(e.x+r)+' '+e.y+' L'+(e.x+e.w-r)+' '+e.y+' Q'+(e.x+e.w)+' '+e.y+' '+(e.x+e.w)+' '+(e.y+r)+' L'+(e.x+e.w)+' '+(e.y+e.h-r)+' Q'+(e.x+e.w)+' '+(e.y+e.h)+' '+(e.x+e.w-r)+' '+(e.y+e.h)+' L'+(e.x+r)+' '+(e.y+e.h)+' Q'+e.x+' '+(e.y+e.h)+' '+e.x+' '+(e.y+e.h-r)+' L'+e.x+' '+(e.y+r)+' Q'+e.x+' '+e.y+' '+(e.x+r)+' '+e.y+' Z';svg.appendChild(rc.path(p,opt(e)));}
    else svg.appendChild(rc.rectangle(e.x,e.y,e.w,e.h,opt(e)));
  } else if(e.kind==='ellipse'){svg.appendChild(rc.ellipse(e.x+e.w/2,e.y+e.h/2,e.w,e.h,opt(e)));}
  else if(e.kind==='arrow'){
    const o={...opt(e),fill:undefined};
    svg.appendChild(e.pts.length>2?rc.linearPath(e.pts,o):rc.line(e.pts[0][0],e.pts[0][1],e.pts[1][0],e.pts[1][1],o));
    const head=(a,b)=>{const ang=Math.atan2(b[1]-a[1],b[0]-a[0]);const L=16;for(const s of[-1,1]){const x=b[0]-L*Math.cos(ang+s*0.45),y=b[1]-L*Math.sin(ang+s*0.45);svg.appendChild(rc.line(b[0],b[1],x,y,{...o,strokeLineDash:undefined}));}};
    head(e.pts[e.pts.length-2],e.pts[e.pts.length-1]); if(e.both) head(e.pts[1],e.pts[0]);
  } else if(e.kind==='text'){
    const t=document.createElementNS(ns,'text');
    t.setAttribute('font-family',e.font==='mono'?'ui-monospace,Menlo,monospace':e.font==='title'?'Title':'Hand');
    t.setAttribute('font-size',e.size);t.setAttribute('fill',e.color);
    t.setAttribute('text-anchor',e.align==='center'?'middle':'start');
    e.text.split('\\n').forEach((line,i)=>{const ts=document.createElementNS(ns,'tspan');let l=line,bold=false;if(l.startsWith('# ')){l=l.slice(2);bold=true;}
      ts.setAttribute('x',e.x);ts.setAttribute('y',e.y+e.size*(1.0+i*1.3));if(bold){ts.setAttribute('font-weight','700');}ts.textContent=l;t.appendChild(ts);});
    svg.appendChild(t);
  }
}
document.title='done';
</script></body></html>`;
    const b = await chromium.launch();
    const p = await (await b.newContext({ viewport: { width: this.w, height: this.h }, deviceScaleFactor: 1.5 })).newPage();
    await p.setContent(html);
    await p.waitForFunction(() => document.title === 'done');
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    await p.screenshot({ path, fullPage: false });
    writeFileSync(path.replace(/\.png$/, '.svg'), await p.locator('#s').evaluate((s) => s.outerHTML));
    await b.close();
  }
}
