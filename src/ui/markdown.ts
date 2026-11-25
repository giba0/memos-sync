import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true });

markdown.validateLink = (url: string): boolean => {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
};

markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};

const renderImage = markdown.renderer.rules.image;
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const src = tokens[index].attrGet('src') || '';
  if (!/^https?:/i.test(src)) return markdown.utils.escapeHtml(tokens[index].content);
  return renderImage ? renderImage(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options);
};

markdown.renderer.rules.text = (tokens, index) => {
  const text = tokens[index].content;
  let linkDepth = 0;
  for (let i = 0; i < index; i++) {
    if (tokens[i].type === 'link_open') linkDepth++;
    if (tokens[i].type === 'link_close') linkDepth--;
  }
  if (linkDepth > 0) return markdown.utils.escapeHtml(text);
  let result = '';
  let offset = 0;
  const tags = /(^|\s)(#[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;
  for (const match of text.matchAll(tags)) {
    const tag = markdown.utils.escapeHtml(match[2]);
    result += markdown.utils.escapeHtml(text.slice(offset, match.index) + match[1]);
    result += `<button type="button" class="note-tag" data-tag="${tag}">${tag}</button>`;
    offset = match.index! + match[0].length;
  }
  return result + markdown.utils.escapeHtml(text.slice(offset));
};

markdown.core.ruler.push('memos_checkboxes', (state) => {
  for (let i = 0; i < state.tokens.length; i++) {
    const item = state.tokens[i];
    if (item.type !== 'list_item_open' || !item.map) continue;
    const inline = state.tokens[i + 2];
    if (inline?.type !== 'inline' || !inline.children?.length) continue;
    const text = inline.children[0];
    if (text.type !== 'text') continue;
    const match = /^\[([ xX])\](?:\s+|$)/.exec(text.content);
    if (!match) continue;
    text.content = text.content.slice(match[0].length);
    item.meta = { ...item.meta, checkbox: true, checked: match[1] !== ' ', line: item.map[0] };
  }
});

markdown.renderer.rules.list_item_open = (tokens, index, options, env: { noteId?: string }, renderer) => {
  const token = tokens[index];
  const open = renderer.renderToken(tokens, index, options);
  if (!token.meta?.checkbox) return open;
  const noteId = markdown.utils.escapeHtml(env.noteId || '');
  return `${open}<input type="checkbox" class="note-checkbox" aria-label="Toggle checklist item" data-note-id="${noteId}" data-line="${token.meta.line}"${token.meta.checked ? ' checked' : ''}> `;
};

export function renderMarkdown(content: string, noteId: string): string {
  return markdown.render(content, { noteId });
}

export function toggleChecklistLine(content: string, line: number, checked: boolean): string | null {
  if (!Number.isInteger(line) || line < 0) return null;
  const lines = content.split('\n');
  if (line >= lines.length) return null;
  const pattern = /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+\[)[ xX](\])/;
  if (!pattern.test(lines[line])) return null;
  lines[line] = lines[line].replace(pattern, `$1${checked ? 'x' : ' '}$2`);
  return lines.join('\n');
}
