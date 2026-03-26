// Convert inline markdown to HTML
export function markdownToHtml(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Inline code: `text`
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  return html;
}

// Convert HTML back to markdown
export function htmlToMarkdown(element) {
  if (!element) return '';

  let md = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      md += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      const inner = htmlToMarkdown(node);

      if (tag === 'strong' || tag === 'b') {
        md += `**${inner}**`;
      } else if (tag === 'em' || tag === 'i') {
        md += `*${inner}*`;
      } else if (tag === 's' || tag === 'del' || tag === 'strike') {
        md += `~~${inner}~~`;
      } else if (tag === 'code') {
        md += `\`${inner}\``;
      } else {
        md += inner;
      }
    }
  }
  return md;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
