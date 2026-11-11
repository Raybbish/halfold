// Compares two folders of screenshots pixel by pixel (no extra dependencies: the PNGs are decoded on a canvas in
// Playwright's browser). Writes a diff image for every pair that differs: changed pixels in red over a faded copy.
// usage: node tests/compare-shots.js <dirA> <dirB> <diffDir>
const fs = require('fs');
const path = require('path');
const pw = require('playwright');

async function compare(dirA, dirB, diffDir) {
  const names = fs.readdirSync(dirA).filter(n => n.endsWith('.png')).sort();
  fs.mkdirSync(diffDir, { recursive: true });
  const browser = await pw.chromium.launch(); const page = await browser.newPage();
  const rows = [];
  for (const n of names) {
    const fa = path.join(dirA, n), fb = path.join(dirB, n);
    if (!fs.existsSync(fb)) { rows.push({ name: n, missing: true }); continue; }
    const a = fs.readFileSync(fa), b = fs.readFileSync(fb);
    if (a.equals(b)) { rows.push({ name: n, diff: 0, total: null }); continue; }
    const r = await page.evaluate(async ([a, b]) => {
      const load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const px = img => { const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib), out = new OffscreenCanvas(w, h), ox = out.getContext('2d'), od = ox.createImageData(w, h);
      let diff = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 0; i < da.length; i += 4) {
        const same = da[i] === db[i] && da[i + 1] === db[i + 1] && da[i + 2] === db[i + 2];
        const p = i / 4, x = p % w, y = (p - x) / w;
        if (same) { const g = 255 - (255 - da[i]) * 0.25; od.data[i] = od.data[i + 1] = od.data[i + 2] = g; }
        else { diff++; od.data[i] = 230; od.data[i + 1] = 0; od.data[i + 2] = 0; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
        od.data[i + 3] = 255;
      }
      ox.putImageData(od, 0, 0);
      const blob = await out.convertToBlob({ type: 'image/png' }), buf = new Uint8Array(await blob.arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { diff, total: w * h, size: [ia.width, ia.height, ib.width, ib.height], box: diff ? [x0, y0, x1, y1] : null, png: btoa(s) };
    }, ['data:image/png;base64,' + a.toString('base64'), 'data:image/png;base64,' + b.toString('base64')]);
    if (r.diff) fs.writeFileSync(path.join(diffDir, n), Buffer.from(r.png, 'base64'));
    rows.push({ name: n, diff: r.diff, total: r.total, size: r.size, box: r.box });
  }
  await browser.close();
  return rows;
}

module.exports = { compare };

if (require.main === module) {
  const [a, b, d] = process.argv.slice(2);
  compare(a, b, d).then(rows => {
    for (const r of rows) console.log(r.missing ? `MISSING  ${r.name}` : `${r.diff ? 'DIFF' : 'SAME'}  ${r.name}${r.diff ? `  ${r.diff} px (${(r.diff / r.total * 100).toFixed(3)}%) in box ${JSON.stringify(r.box)} sizes ${JSON.stringify(r.size)}` : ''}`);
  });
}
