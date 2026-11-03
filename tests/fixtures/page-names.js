'use strict';
// Finds names the page's scripts use that nothing defines: a call to one is an error only when that
// button is pressed. Run with --expose-internals (Node's own copy of the acorn parser), it prints JSON:
// { missing: { "<dir>": { "<name>": "<first file>" } } }, or { unavailable: true } without a parser.
const fs = require('fs');
const path = require('path');

let acorn;
try { acorn = require('internal/deps/acorn/acorn/dist/acorn'); } catch { console.log(JSON.stringify({ unavailable: true })); process.exit(0); }

const APP = path.join(__dirname, '..', '..');
// What a browser gives every script. Anything else has to be defined by the page's own scripts.
const BROWSER = new Set(`window document navigator location history screen console localStorage sessionStorage
  fetch alert confirm prompt setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
  queueMicrotask structuredClone matchMedia getComputedStyle getSelection scrollTo scrollBy innerWidth innerHeight outerWidth outerHeight devicePixelRatio open close focus blur print
  addEventListener removeEventListener dispatchEvent atob btoa crypto performance speechSynthesis caches indexedDB visualViewport self top parent globalThis isSecureContext origin name
  Object Array String Number Boolean Symbol BigInt Function Math JSON Date RegExp Map Set WeakMap WeakSet WeakRef Promise Proxy Reflect Intl
  Error TypeError RangeError SyntaxError ReferenceError AggregateError undefined NaN Infinity isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape
  Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ArrayBuffer SharedArrayBuffer DataView Atomics TextEncoder TextDecoder
  URL URLSearchParams Blob File FileReader FormData Headers Request Response AbortController AbortSignal EventSource WebSocket XMLHttpRequest BroadcastChannel MessageChannel
  Event CustomEvent KeyboardEvent MouseEvent PointerEvent ClipboardItem DataTransfer ResizeObserver MutationObserver IntersectionObserver PerformanceObserver
  Element HTMLElement HTMLInputElement HTMLTextAreaElement HTMLImageElement HTMLCanvasElement HTMLVideoElement HTMLAnchorElement Node NodeList Text Range DOMParser DocumentFragment CSS CSSStyleSheet
  Image Audio AudioContext webkitAudioContext OffscreenCanvas createImageBitmap ImageBitmap Notification PushManager ServiceWorker Worker Option getSelection SpeechSynthesisUtterance SpeechRecognition webkitSpeechRecognition
  Highlight NodeFilter documentPictureInPicture scrollX scrollY pageXOffset pageYOffset
  desktop __REMOTE__ module arguments`.split(/\s+/));   // (desktop: from the desktop app, looked for first; __REMOTE__: filled in by the server; module: looked for first)
const NODE = new Set(`require module exports __dirname __filename process Buffer global globalThis console setTimeout clearTimeout setInterval clearInterval setImmediate clearImmediate queueMicrotask structuredClone
  fetch URL URLSearchParams AbortController AbortSignal TextEncoder TextDecoder Blob File FormData Headers Request Response WebSocket EventSource performance crypto navigator atob btoa
  Object Array String Number Boolean Symbol BigInt Function Math JSON Date RegExp Map Set WeakMap WeakSet WeakRef Promise Proxy Reflect Intl
  Error TypeError RangeError SyntaxError ReferenceError AggregateError undefined NaN Infinity isNaN isFinite parseInt parseFloat encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape
  Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array BigInt64Array BigUint64Array ArrayBuffer SharedArrayBuffer DataView Atomics
  arguments`.split(/\s+/));

function walk(node, visit, parent = null, key = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) for (const x of v) { if (x && typeof x.type === 'string') walk(x, visit, node, k); }
    else if (v && typeof v.type === 'string') walk(v, visit, node, k);
  }
}
// Every name a pattern binds: a, { a, b: c }, [a, ...b], a = 1.
function bound(p, add) {
  if (!p) return;
  if (p.type === 'Identifier') add(p.name);
  else if (p.type === 'ObjectPattern') for (const x of p.properties) bound(x.type === 'RestElement' ? x.argument : x.value, add);
  else if (p.type === 'ArrayPattern') for (const x of p.elements) bound(x, add);
  else if (p.type === 'RestElement') bound(p.argument, add);
  else if (p.type === 'AssignmentPattern') bound(p.left, add);
}
// files: what shares one set of global names (a page's scripts), or one module on its own.
function group(files, known) {
  const declared = new Set(), used = new Map();
  const add = n => declared.add(n);
  const scan = (text, file) => {
    const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    walk(ast, (n, parent, key) => {
      if (n.type === 'VariableDeclarator') bound(n.id, add);
      else if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') { if (n.id) add(n.id.name); n.params.forEach(p => bound(p, add)); }
      else if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') { if (n.id) add(n.id.name); }
      else if (n.type === 'CatchClause') bound(n.param, add);
      else if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed && n.left.object.type === 'Identifier' && ['window', 'self', 'globalThis'].includes(n.left.object.name)) add(n.left.property.name);
      else if (n.type === 'Identifier') {
        if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
        if (parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand) return;
        if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) return;
        if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return;
        if (parent.type === 'UnaryExpression' && parent.operator === 'typeof') return;
        if (!used.has(n.name)) used.set(n.name, `${file}:${n.loc ? n.loc.start.line : ''}`);
      }
    }, null, null);
  };
  for (const f of files) {
    const text = fs.readFileSync(path.join(APP, f), 'utf8');
    if (!f.endsWith('.html')) { scan(text, f); continue; }
    // A page's own inline scripts, and what it defines for the others.
    for (const m of text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) { try { scan(m[1], f); } catch { /* one the server fills in */ } }
    for (const m of text.matchAll(/\bid="([\w$-]+)"/g)) add(m[1]);   // (an element with an id is a global name too)
  }
  const missing = {};
  for (const [name, at] of used) if (!declared.has(name) && !known.has(name)) missing[name] = at;
  return missing;
}
const js = dir => fs.readdirSync(path.join(APP, dir)).filter(f => f.endsWith('.js')).map(f => path.join(dir, f));
const out = {
  ui: group([...js('ui'), 'index.html', 'theme.js'], BROWSER),
  'ui-lite': group([...js('ui-lite'), 'ui-lite/index.html'], BROWSER),
};
// The server's and the desktop app's own code: each file is a module with its own names.
for (const f of ['server.js', ...js('lib'), ...js('bin'), 'desktop/main.js', ...js('desktop/shell')]) out[f] = group([f], /aide-region-ui\.js$/.test(f) ? BROWSER : /preload\.js$/.test(f) ? new Set([...NODE, ...BROWSER]) : NODE);   // (the region selector is a renderer; a preload runs in the page)
for (const k of Object.keys(out)) if (!Object.keys(out[k]).length) delete out[k];
console.log(JSON.stringify({ missing: out }));
