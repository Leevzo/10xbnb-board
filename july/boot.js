// Loads the newest page every time it is opened, whatever copy the phone kept.
// It asks the shelf for each file's current tag and loads the file by that tag.

async function tag(file) {
  try {
    const res = await fetch(file, { method: 'HEAD', cache: 'no-cache' });
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
