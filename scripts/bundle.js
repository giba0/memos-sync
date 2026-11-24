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

  for (const fileName of ['manifest.json', 'icon.svg', 'LICENSE-MEMOS']) {
    const source = path.join(root, fileName);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, path.join(dist, fileName));
    }
  }

  const indexHtml = path.join(root, 'src', 'ui', 'index.html');
  if (fs.existsSync(indexHtml)) {
    const markdown = await esbuild.build({
      entryPoints: [path.join(root, 'src', 'ui', 'markdown-entry.ts')],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: ['es2020'],
    });
    for (const [name, license] of [
      ['markdown-it', 'LICENSE'], ['linkify-it', 'LICENSE'], ['mdurl', 'LICENSE'],
      ['entities', 'LICENSE'], ['punycode.js', 'LICENSE-MIT.txt'], ['uc.micro', 'LICENSE.txt'],
      ['argparse', 'LICENSE'],
    ]) {
      fs.copyFileSync(path.join(root, 'node_modules', name, license), path.join(dist, `LICENSE-${name}`));
    }
    const icon = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8')
      .replace(/<\?xml[^?]*\?>\s*/, '')
      .replace(/<style>[\s\S]*?<\/style>/, '')
      .replace('role="img" aria-label="Memos"', 'aria-hidden="true" focusable="false"');
    const html = fs.readFileSync(indexHtml, 'utf8')
      .replace('<!-- MEMOS_LOGO -->', icon)
      .replace('<!-- MARKDOWN_SCRIPT -->', `<script>${markdown.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
    fs.writeFileSync(path.join(dist, 'index.html'), html);
  }

  console.log('Build complete: dist/ ready for Super Productivity plugin loader.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
