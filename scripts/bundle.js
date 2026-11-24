const fs = require('fs');
const path = require('path');
const { gzipSync } = require('node:zlib');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

async function buildMarkup() {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src', 'ui', 'markup.js')],
    bundle: true,
    minify: true,
    write: false,
    outdir: dist,
    format: 'iife',
    conditions: ['production'],
    loader: { '.woff2': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' },
    logOverride: { 'empty-import-meta': 'silent' },
    plugins: [{
      name: 'inline-excalidraw-fonts',
      setup(build) {
        build.onLoad({ filter: /[\/]@excalidraw[\/]excalidraw[\/]dist[\/]prod[\/].*\.js$/ }, ({ path: file }) => ({
          contents: fs.readFileSync(file, 'utf8').replace(/\.\/fonts\/[\w/.-]+\.woff2/g, (font) => {
            // The full Xiaolai font set exceeds the host bundle limit. Use a local font when available.
            if (font.includes('/Xiaolai/')) return 'local:Xiaolai';
            return 'data:font/woff2;base64,' + fs.readFileSync(path.resolve(path.dirname(file), font)).toString('base64');
          }),
          loader: 'js',
        }));
      },
    }],
  });
  const css = result.outputFiles.find((file) => file.path.endsWith('.css')).text;
  const js = result.outputFiles.find((file) => file.path.endsWith('.js')).text;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:">
    <style>${css}
    body { margin: 0; height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); font: 14px system-ui; color: #242428; background: #f7f7fa; }
    header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #dedee5; }
    header button { font: inherit; padding: 6px 10px; cursor: pointer; }
    #status { flex: 1; }
    </style></head><body><header>
    <button id="close" type="button">Close</button><span id="status" role="status">Loading drawing…</span>
    <button id="add" type="button" disabled>Add to memo</button>
    </header><div id="root"></div><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

async function main() {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'plugin.ts')],
    bundle: true,
    outfile: path.join(dist, 'plugin.js'),
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    sourcemap: false,
    minify: false,
    define: { __MARKUP_DOCUMENT__: JSON.stringify(gzipSync(await buildMarkup()).toString('base64')) },
  });

  if (fs.statSync(path.join(dist, 'plugin.js')).size > 5 * 1024 * 1024) {
    throw new Error('plugin.js exceeds Super Productivity’s 5 MiB upload limit.');
  }

  for (const fileName of ['manifest.json', 'icon.svg', 'LICENSE-MEMOS', 'LICENSE-EXCALIDRAW']) {
    const source = path.join(root, fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dist, fileName));
    }
  }

  const indexHtml = path.join(root, 'src', 'ui', 'index.html');
  if (fs.existsSync(indexHtml)) {
    for (const [name, license] of [
      ['markdown-it', 'LICENSE'], ['linkify-it', 'LICENSE'], ['mdurl', 'LICENSE'],
      ['entities', 'LICENSE'], ['punycode.js', 'LICENSE-MIT.txt'], ['uc.micro', 'LICENSE.txt'],
      ['argparse', 'LICENSE'],
    ]) {
      fs.copyFileSync(path.join(root, 'node_modules', name, license), path.join(dist, `LICENSE-${name}`));
    }
    for (const name of ['react', 'react-dom']) {
      fs.copyFileSync(path.join(root, 'node_modules', name, 'LICENSE'), path.join(dist, `LICENSE-${name}`));
    }
    fs.copyFileSync(indexHtml, path.join(dist, 'index.html'));
  }

  console.log('Build complete: dist/ ready for Super Productivity plugin loader.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
