import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { renderMarkdown, toggleChecklistLine } from './markdown';

test('renders Markdown and tags without allowing HTML or unsafe URLs', () => {
  const html = renderMarkdown('# Heading\n\n- **bold** #tag\n- [link](https://example.com)\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n`#code`', 'n1');
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /class="note-tag" data-tag="#tag"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /<code>#code<\/code>/);
  const image = renderMarkdown('![hello](https://example.com/image.png) ![bad](data:image/svg+xml,bad)', 'n1');
  assert.match(image, /<img src="https:\/\/example.com\/image.png" alt="hello">/);
  assert.doesNotMatch(image, /<img[^>]+data:/);
  assert.doesNotMatch(renderMarkdown('[#tag](https://example.com)', 'n1'), /<button/);
  assert.match(renderMarkdown('Visit https://example.com/path', 'n1'), /<a href="https:\/\/example.com\/path"[^>]*>https:\/\/example.com\/path<\/a>/);
  assert.doesNotMatch(renderMarkdown('`https://example.com/path`', 'n1'), /<a /);
});

test('checklists toggle only the selected source line', () => {
  const content = '- [ ] first\n- [x] second\n  - [ ] nested';
  const html = renderMarkdown(content, 'note"1');
  assert.match(html, /data-note-id="note&quot;1" data-line="0"/);
  assert.match(html, /data-line="1" checked/);
  assert.match(html, /data-line="2"/);
  assert.equal(toggleChecklistLine(content, 2, true), '- [ ] first\n- [x] second\n  - [x] nested');
  assert.equal(toggleChecklistLine(content, 4, true), null);
});
