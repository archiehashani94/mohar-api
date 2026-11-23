import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/newsreader/opsz.css';
import './index.css';
import { App } from './App';
import { loadDemo } from './lib/chain';
import { initSession } from './lib/session';

// Serve bb.js's CRS from our own API (cached locally) instead of Aztec's CDN → proving works offline / on bad Wi-Fi.
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const m = /^https:\/\/crs\.aztec-(?:cdn\.foundation|labs\.com)\/([a-z0-9_]+\.dat)$/.exec(url);
  return realFetch(m ? `/api/crs/${m[1]}` : input, init);
};

loadDemo()
  .then(() => initSession())
  .then(() => createRoot(document.getElementById('root')!).render(<App />))
  .catch((e) => {
    document.getElementById('root')!.innerHTML = `<pre style="color:#ff5470;padding:24px">Could not load demo.json — run the seed script first.\n${e}</pre>`;
  });
