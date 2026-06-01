const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

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
  });

  for (const fileName of ['manifest.json', 'icon.svg']) {
    const source = path.join(root, fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dist, fileName));
    }
  }

  const indexHtml = path.join(root, 'src', 'ui', 'index.html');
  if (fs.existsSync(indexHtml)) {
    fs.copyFileSync(indexHtml, path.join(dist, 'index.html'));
  }

  console.log('Build complete: dist/ ready for Super Productivity plugin loader.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
