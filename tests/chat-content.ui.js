'use strict';
const { sleep } = require('./browser');
const demo = require('./demo');

module.exports = [{
  name: 'chat content layout',
  async run(t) {
    const b = await t.open({ width: 1920, height: 1100 });
    await b.eval(`ChatUI.open({ sessionId: ${JSON.stringify(demo.ID['s-bard'])} }); return 1`);
    await sleep(800);
    await b.eval(`
      document.getElementById('chat').classList.add('focus');
      const feed = document.getElementById('cFeed'); feed.innerHTML = '';
      const picture = (w, h, color) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h);
        return c.toDataURL('image/png');
      };
      const wide = picture(1600, 240, '#4b6879'), tall = picture(300, 1200, '#78645b'), small = picture(32, 32, '#53735e');
      renderItem(feed, { kind: 'user', text: 'Keep the whole screenshot visible, with a frame that fits. ' .repeat(5), images: [{ src: wide }, { src: tall }, { src: small }] }, false);
      renderItem(feed, { kind: 'assistant', blocks: [{ type: 'text', text: 'A readable explanation should wrap without restricting wider outputs. '.repeat(12) + '\\n\\n' + '\\u0060'.repeat(3) + 'js\\nconst image = { fit: "contain", preserveAspectRatio: true };\\n' + '\\u0060'.repeat(3) }] }, false);
      const turn = lastTurnOf('claude');
      addPic(turn, { src: wide }, 'looked', 'Wide screenshot'); addPic(turn, { src: tall }, 'made', 'Tall image');
      turn.insertAdjacentHTML('beforeend', genImage({ id: 'layout-image', src: tall, status: 'done', prompt: 'Tall generated image' }, false));
      turn.querySelector('.md').insertAdjacentHTML('beforeend', '<p><span class="mdimg"><button type="button" class="thumb md-pic" data-full="' + wide + '"><img src="' + wide + '" alt="Wide inline screenshot"></button><span class="mdimg-cap">A caption for the inline picture</span></span></p>');
      C.ctxWarned.main = false; setCtx('main', { used: 932000, max: 1000000, autoAt: 967000 });
      for (const el of feed.children) el.style.contentVisibility = 'visible';
      for (const img of feed.querySelectorAll('img')) { img.loading = 'eager'; await img.decode(); }
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return 1;
    `);
    const inspect = () => b.eval(`
      const f = document.getElementById('cFeed'), fr = f.getBoundingClientRect();
      const pictures = [...f.querySelectorAll('.imgs .thumb,.pic-b,.md-pic,.gen-img')].map(e => {
        const img = e.querySelector('img'), a = e.getBoundingClientRect(), r = img.getBoundingClientRect();
        const scale = r.width / img.naturalWidth, fit = getComputedStyle(img).objectFit;
        return { frame: [a.width, a.height], image: [r.width, r.height],
          hugs: Math.abs(a.width - r.width) <= 4 && Math.abs(a.height - r.height) <= 4,
          whole: Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) < .03 && fit === 'contain',
          inside: a.left >= fr.left - 1 && a.right <= fr.right + 1, scale };
      });
      const copy = f.querySelector('.ctx-warn-copy').getBoundingClientRect(), action = f.querySelector('.ctx-warn > button').getBoundingClientRect();
      const p = f.querySelector('.md > p'), code = f.querySelector('.md > .code');
      return { pictures, width: innerWidth, scroll: document.scrollingElement.scrollWidth,
        gap: action.top >= copy.bottom ? action.top - copy.bottom : action.left - copy.right,
        prose: p.getBoundingClientRect().width, available: p.parentElement.clientWidth, code: code && code.getBoundingClientRect().width,
        gallery: [...f.querySelectorAll('.pics .pic')].map(e => e.getBoundingClientRect().width) };
    `);
    let r = await inspect();
    t.check('wide, tall and tiny attachments, inline pictures and generated images keep their full proportions', r.pictures.length === 7 && r.pictures.every(x => x.whole), r);
    t.check('picture frames hug their previews instead of leaving empty strips', r.pictures.every(x => x.hugs), r.pictures);
    t.check('small attachments are not enlarged', r.pictures[2].scale <= 1.01, r.pictures[2]);
    t.check('paragraphs wrap while code blocks keep the available width', r.code >= r.available - 2 && r.code > r.prose + 20, r);
    t.check('the context action is separated from its explanation', r.gap >= 15, r);
    await b.clickOn('.imgs .thumb');
    t.check('a sent screenshot still opens at full size with a useful label', await b.eval(`const l = document.getElementById('cLight'); return !l.hidden && Gallery.list[Gallery.i].cap === 'Attached image 1'`));
    await b.esc();
    t.check('closing a picture returns focus to its thumbnail', await b.eval(`return document.activeElement === document.querySelector('.imgs .thumb')`));

    for (const size of [{ width: 390, height: 844, ui: 100, text: 100 }, { width: 320, height: 700, ui: 100, text: 100 }, { width: 1200, height: 900, ui: 125, text: 140 }]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
      await b.eval(`Look.set({ ui: ${size.ui}, text: ${size.text} }); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return 1`);
      r = await inspect();
      t.check(`${size.width}px, UI ${size.ui}%, text ${size.text}%: images stay whole and the page fits`, r.pictures.every(x => x.whole && x.inside && x.hugs) && r.scroll <= r.width + 1, r);
      t.check(`${size.width}px: warning copy and action keep their gap`, r.gap >= 15, r);
      if (size.width <= 390) t.check(`${size.width}px: screenshot galleries use the available column`, r.gallery.every(w => w >= 230), r.gallery);
    }
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['studio-light', 'studio-dark', 'paper', 'midnight', 'sage', 'gold', 'garnet', 'crema']) {
      await b.eval(`Look.set({ theme: ${JSON.stringify(theme)}, mode: ${JSON.stringify(['studio-light', 'paper'].includes(theme) ? 'light' : 'dark')}, ui: 100, text: 100 }); return 1`);
      r = await inspect();
      t.check(`${theme}: image frames and context action fit`, r.pictures.every(x => x.hugs && x.whole && x.inside) && r.gap >= 15 && r.scroll <= r.width + 1, r);
    }
  },
}];
