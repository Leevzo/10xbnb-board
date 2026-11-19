// Loads the newest page every time it is opened, whatever copy the phone kept.
// It asks the shelf for each file's current tag and loads the file by that tag.
// A home-screen icon keeps the page alive in the background, so opening it again
// only resumes the old copy. Each time the page comes back into view it asks
// again, and if the shelf holds a newer page it reloads into it.

async function tag(file) {
  try {
    const res = await fetch(`${file}?t=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    return (res.headers.get('etag') || res.headers.get('last-modified') || '').replace(/[^a-z0-9]/gi, '');
  } catch { return ''; }
}

const [css, js] = await Promise.all([tag('./july.css'), tag('./july.js')]);
const sheet = document.createElement('link');
sheet.rel = 'stylesheet';
sheet.href = `./july.css?v=${css}`;
await new Promise((done) => {
  sheet.onload = done;
  sheet.onerror = done;
  document.head.append(sheet);
});
import(`./july.js?v=${js}`);

// The page's stamp at the foot of the list, so a phone can say which copy it runs.
const stamp = document.createElement('p');
stamp.className = 'build';
stamp.textContent = `page ${(js || 'unknown').slice(-6)} · 11-18`;
document.body.append(stamp);

let asking = false;
async function newer() {
  if (asking || document.visibilityState !== 'visible') return;
  asking = true;
  const [c, j] = await Promise.all([tag('./july.css'), tag('./july.js')]);
  asking = false;
  // A line being typed is never thrown away; the next return will reload.
  if (document.activeElement?.dataset?.hold && document.activeElement.value) return;
  if ((j && j !== js) || (c && c !== css)) location.reload();
}

document.addEventListener('visibilitychange', newer);
window.addEventListener('pageshow', (event) => { if (event.persisted) newer(); });
window.addEventListener('focus', newer);
