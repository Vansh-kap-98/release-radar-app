// Export the generated changelog as styled HTML (for pasting into
// a blog) or as plain text (for an email newsletter).
//
// Hand-rolled rather than using a markdown library: core/ must stay
// dependency-free so the GitHub Action can run it with no install step. That
// is safe here because we are not parsing arbitrary markdown — we generate it
// ourselves from a fixed prompt, so the grammar is a known, narrow subset:
// headings, unordered lists, bold, inline code and links.

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Applied AFTER escaping, so the tags we insert are the only live markup —
// changelog text ultimately derives from commit messages, which are untrusted.
function inlineToHtml(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function inlineToText(line) {
  return line
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

const STYLES = `body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6;max-width:44rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
h1,h2{border-bottom:1px solid #e5e5e5;padding-bottom:.3em}
h3{margin-top:1.5em}
code{background:#f4f4f5;padding:.15em .35em;border-radius:3px;font-size:.9em}
li{margin:.25em 0}
a{color:#0366d6}`;

function markdownToHtml(markdown, { fullDocument = false, title = "Release notes" } = {}) {
  const lines = String(markdown ?? "").split("\n");
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineToHtml(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`  <li>${inlineToHtml(escapeHtml(bullet[1]))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inlineToHtml(escapeHtml(line))}</p>`);
  }
  closeList();

  const body = out.join("\n");
  if (!fullDocument) return body;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function markdownToPlainText(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const out = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      // Collapse runs of blank lines — email clients render them unevenly.
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const text = inlineToText(heading[2]).trim();
      // Top-level headings get shouted so the hierarchy survives without
      // any markup at all; deeper ones stay as plain lines.
      out.push(heading[1].length <= 2 ? text.toUpperCase() : text);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      out.push(`- ${inlineToText(bullet[1]).trim()}`);
      continue;
    }

    out.push(inlineToText(line).trim());
  }

  return out.join("\n").trim() + "\n";
}

module.exports = { markdownToHtml, markdownToPlainText, escapeHtml };
