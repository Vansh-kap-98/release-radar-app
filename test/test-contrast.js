// Guards the design system's colour contrast.
//
// Every foreground/background pair the UI actually uses must clear WCAG AA
// (4.5:1) in BOTH themes. Checked against the tokens rather than a running
// browser so it needs no DOM and no dependencies, like the rest of test/.
//
// Converts oklch -> oklab -> linear sRGB -> gamma sRGB -> relative luminance,
// because the palette is authored in oklch and lightness there is perceptual,
// not photometric: two colours with the same oklch L can have very different
// contrast against the same background.
const fs = require("fs");
const path = require("path");
const raw = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
const css = raw.split("\r").join("");

function block(sel) {
  // Last matching block wins, same as the cascade.
  const re = new RegExp(sel.replace(/\./g, "\\.") + "\\s*\\{([\\s\\S]*?)\\n\\}", "g");
  let m, last = null;
  while ((m = re.exec(css))) last = m[1];
  return last || "";
}
function tokens(sel) {
  const out = {};
  for (const m of block(sel).matchAll(/(--[\w-]+):\s*(oklch\([^)]*\))\s*;/g)) out[m[1]] = m[2];
  return out;
}
function parseOklch(s) {
  const p = s.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  return { L: +p[1], C: +p[2], h: +p[3] };
}
function oklchToSrgb({ L, C, h }) {
  const hr = (h * Math.PI) / 180, a = C * Math.cos(hr), b2 = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b2;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b2;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b2;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(c * 255)));
  });
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (f, b) => {
  const x = lum(f), y = lum(b);
  const hi = Math.max(x, y), lo = Math.min(x, y);
  return (hi + 0.05) / (lo + 0.05);
};

const light = tokens(":root");
const dark = tokens(".dark");

const PAIRS = [
  ["foreground", "background"], ["foreground", "card"], ["foreground", "muted"],
  ["muted-foreground", "background"], ["muted-foreground", "card"], ["muted-foreground", "muted"],
  ["subtle-foreground", "card"],
  ["primary-foreground", "primary"], ["accent-foreground", "accent"],
  ["accent", "card"], ["accent", "accent-surface"], ["accent", "range-bg"],
  ["success", "success-surface"], ["success", "card"],
  ["warning", "warning-surface"], ["warning", "card"],
  ["danger", "danger-surface"], ["danger", "card"],
  ["info", "info-surface"], ["info", "card"],
  ["cat-feat", "cat-feat-bg"], ["cat-fix", "cat-fix-bg"], ["cat-breaking", "cat-breaking-bg"],
  ["cat-docs", "cat-docs-bg"], ["cat-chore", "cat-chore-bg"],
];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

const AA = 4.5;

for (const [name, set] of [["light", light], ["dark", dark]]) {
  console.log(`-- ${name} theme --`);
  check(`${name}: palette parsed`, Object.keys(set).length > 20, Object.keys(set).length);

  for (const [fg, bg] of PAIRS) {
    const f = set["--" + fg], b = set["--" + bg];
    if (!f || !b) {
      check(`${name}: ${fg} on ${bg} — tokens exist`, false, "missing token");
      continue;
    }
    const r = ratio(oklchToSrgb(parseOklch(f)), oklchToSrgb(parseOklch(b)));
    check(`${name}: ${fg} on ${bg}`, r >= AA, `${r.toFixed(2)}:1 (needs ${AA}:1)`);
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
