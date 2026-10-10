const fs = require('node:fs');
const path = require('node:path');
const demo = require('./demo');
const { sleep } = require('./browser');

module.exports = [
  {
    name: 'project-art',
    async run(t) {
      const b = await t.open({ demo: false });
      const p = demo.projects.find(x => x.name === 'Starfall Tavern'), cwd = p.cwd;
      const chosen = `${cwd}\\custom-emblem.png`, pic = fs.readFileSync(path.join(__dirname, '../crest.webp'));
      let picked = null, output = null, sendCount = 0, lastRequest = null;
      const info = () => ({ cwd, banner: null, crest: picked, crestPicked: !!picked, docs: [], images: [chosen, ...(output ? [output] : [])].map(f => ({ path: f, name: f.split('\\').pop(), rel: f.split('\\').pop(), size: pic.length, mtime: Date.now(), depth: 0 })), today: { docs: 0, images: 1 } });
      await b.intercept('*/api/*', async (url, method, data) => {
        const u = new URL(url);
        if (u.pathname === '/api/project/info' && u.searchParams.get('cwd') === cwd) return { body: info() };
        if (u.pathname === '/api/project/crest-result') return { body: { image: info().images.find(im => im.name === u.searchParams.get('name')) || null } };
        if (u.pathname === '/api/project/crest') { lastRequest = JSON.parse(data); picked = lastRequest.path; return { body: info() }; }
        if (u.pathname === '/api/image' && u.searchParams.get('cwd') === cwd) return { type: 'image/webp', body: pic };
        if (u.pathname === '/api/chat/send') sendCount++;
        return null;
      });
      await demo.install(b); await b.eval('location.reload(); return 1'); await sleep(3000);
      await b.eval(`await go('folder', ${JSON.stringify(cwd)}); return 1`);
      await sleep(600); // The project-to-page view transition must finish before a real click.
      await b.clickOn('[data-project-crest]'); await sleep(300);
      t.check('the project has a crest dialog with an editable image brief', await b.eval(`return !!document.getElementById('crestDlg')?.open && !!document.getElementById('crestDirection') && !document.querySelector('[data-crest-make]').disabled`));
      await t.shot(b, 'dialog');
      await b.clickOn('.crest-option'); await sleep(300);
      t.check('choosing an image uses the crest route and leaves the banner alone', picked === chosen && lastRequest.cwd === cwd && await b.eval(`return S.worlds[${JSON.stringify(cwd)}].banner === null`));
      await b.clickOn('[data-crest-make]'); await sleep(300);
      if (await b.eval(`return !!document.getElementById('confirmDlg')?.open`)) { await b.clickOn('#cfYes'); await sleep(700); }
      const drafted = await b.eval(`return { text: cText.value, pending: JSON.parse(localStorage.getItem('crest-pending-v1') || '{}'), open: ChatUI.isOpen() }`);
      t.check('Codex receives an editable prompt with a unique output filename, without sending it', drafted.open && /Make a finished square project crest/.test(drafted.text) && /Keep existing crests/.test(drafted.text) && sendCount === 0 && !!drafted.pending[cwd], drafted);
      output = `${cwd}\\${drafted.pending[cwd].name}`;
      await b.eval('await ProjectArt.check(); return 1');
      t.check('when that exact image is saved it becomes the crest and the watch ends', picked === output && await b.eval(`return !JSON.parse(localStorage.getItem('crest-pending-v1') || '{}')[${JSON.stringify(cwd)}] && !!document.querySelector('#cCrest img')`));
      await b.eval(`await ProjectArt.open(${JSON.stringify(cwd)}); return 1`); await b.clickOn('[data-crest-pick=""]');
      t.check('automatic selection can be restored without deleting artwork', picked === null);
      await b.esc();
      await b.eval(`S.codex.signedIn = false; await ProjectArt.open(${JSON.stringify(cwd)}); return 1`);
      t.check('signed-out users can choose pictures but cannot start generation', await b.eval(`return document.querySelector('[data-crest-make]').disabled && !document.querySelector('.crest-option').disabled`));
      await b.esc();
      const phone = await t.open({ width: 390, height: 844, mobile: true });
      await phone.eval(`await ProjectArt.open(${JSON.stringify(cwd)}); return 1`);
      t.check('the crest dialog fits a phone', await phone.eval(`return crestDlg.getBoundingClientRect().right <= innerWidth && crestDlg.scrollWidth <= crestDlg.clientWidth + 1`));
      await t.shot(phone, 'phone');
      await phone.eval(`Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); return 1`);
      await phone.clickOn('[data-crest-make]'); await sleep(300);
      if (await phone.eval(`return !!document.getElementById('confirmDlg')?.open`)) { await phone.clickOn('#cfYes'); await sleep(700); }
      t.check('a phone can prepare the crest without secure-context UUID APIs', await phone.eval(`return ChatUI.isOpen() && /Make a finished square project crest/.test(cText.value) && Object.keys(JSON.parse(localStorage.getItem('crest-pending-v1') || '{}')).length > 0`));
    },
  },
  {
    name: 'scene-depth',
    async run(t) {
      const b = await t.open();
      for (const theme of ['isekai', 'highfantasy', 'dungeon']) {
        for (const mode of ['dark', 'light']) {
          await b.eval(`Look.set({ theme: '${theme}', mode: '${mode}' }); return 1`); await sleep(1300);
          const layer = await b.eval(`const w = document.querySelector('.an-depth-wrap'); return { base: !!w?.querySelector('.an-paint'), layer: !!w?.querySelector('.an-depth-front')?.naturalWidth, count: document.querySelectorAll('.an-depth-wrap').length }`);
          t.check(`${theme} ${mode}: the foreground loads once around the painting and its live lights`, layer.base && layer.layer && layer.count === 1, layer);
          await t.shot(b, `${theme}-${mode}`);
        }
      }
      await b.eval(`Look.set({ theme: 'isekai', mode: 'dark' }); return 1`); await sleep(1100);
      await b.eval(`const hero = document.querySelector('.hero'), r = hero.getBoundingClientRect(); hero.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: r.right - 10, clientY: r.bottom - 10 })); return 1`); await sleep(450);
      t.check('pointer movement shifts the two planes by different small amounts', await b.eval(`const w = document.querySelector('.an-depth-wrap'); return !!w.querySelector('.an-scene').style.transform && w.querySelector('.an-scene').style.transform !== w.querySelector('.an-depth-front').style.transform`));
      await b.send('Performance.enable');
      await b.eval(`document.querySelector('.hero').dispatchEvent(new PointerEvent('pointerleave')); return 1`); await sleep(700);
      const metrics = async () => { const r = await b.send('Performance.getMetrics'); return Object.fromEntries(r.result.metrics.map(x => [x.name, x.value])); };
      const before = await metrics(); await sleep(2600); const after = await metrics(), seconds = after.Timestamp - before.Timestamp;
      t.check('the layered scene settles without per-frame layout or restyling', (after.LayoutCount - before.LayoutCount) / seconds < 6 && (after.RecalcStyleCount - before.RecalcStyleCount) / seconds < 12, { layouts: (after.LayoutCount - before.LayoutCount) / seconds, styles: (after.RecalcStyleCount - before.RecalcStyleCount) / seconds });
      await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(400);
      t.check('reduced motion stops both depth planes', await b.eval(`return [...document.querySelectorAll('.an-depth-wrap > *')].every(el => getComputedStyle(el).transform === 'none')`));
      const phone = await t.open({ width: 390, height: 844, mobile: true });
      for (const theme of ['isekai', 'highfantasy', 'dungeon']) {
        await phone.eval(`Look.set({ theme: '${theme}', mode: 'dark' }); return 1`); await sleep(1000);
        t.check(`${theme}: the phone keeps the full scene and readable counts`, await phone.eval(`const w = document.querySelector('.an-depth-wrap'), art = w?.closest('.hero-art'), read = art?.querySelector('.ie-win,.ha-read'); return w?.getBoundingClientRect().height > 150 && read?.getBoundingClientRect().bottom <= art.getBoundingClientRect().bottom + 1 && document.scrollingElement.scrollWidth <= innerWidth + 1 && !w.querySelector('.an-scene').style.transform`));
        await t.shot(phone, `${theme}-phone`);
      }
    },
  },
];
