// Design and wording rules for the dashboard. Run: node tools/check-design.mjs
// Fails (exit 1) when a rule is broken, so it can be run before every push.
import { readFileSync } from "node:fs";
const file = new URL("../public/index.html", import.meta.url);
const src = readFileSync(file, "utf8");
const css = src.slice(src.indexOf("<style>"), src.indexOf("</style>"));
const rootEnd = css.indexOf("}", css.indexOf(":root{"));
const body = css.slice(rootEnd);
const script = src.slice(src.indexOf("<script>"), src.lastIndexOf("</script>"));
const problems = [];
const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

// 1. Type scale: font sizes come from the --fs-* tokens, never raw px (outside :root).
for (const m of body.matchAll(/font(?:-size)?:[^;}]*?\b\d+(?:\.\d+)?px(?!\s*\/)[^;}]*/g)) {
  const raw = m[0].replace(/\/\s*\d+(?:\.\d+)?px/g, ""); // line-height in px is fine
  if (/\b\d+(?:\.\d+)?px/.test(raw.replace(/^font(?:-size)?:/, ""))) problems.push(`CSS uses a raw font size (use a --fs-* token): "${m[0].trim()}"`);
}
for (const m of script.matchAll(/style="[^"]*font-size:\s*\d+px[^"]*"/g)) problems.push(`Inline style sets a raw font size: ${m[0]}`);

// 2. Controls: buttons in templates use a shared control class.
const OK = /class="[^"]*\b(btn|lnk|tog|dotbtn|ddb|chip|ih|flag|aix|tag|opt)\b/;
for (const m of script.matchAll(/<button(?![^>]*\bclass=)[^>]*>/g)) {
  const before = script.slice(Math.max(0, m.index - 200), m.index);
  if (!/class="segv"/.test(before)) problems.push(`Button without a control class (line ~${lineOf(script, m.index)}): ${m[0].slice(0, 80)}`);
}
for (const m of script.matchAll(/<button[^>]*\bclass="([^"]*)"[^>]*>/g)) if (!OK.test(`class="${m[1]}"`)) problems.push(`Button class "${m[1]}" isn't a shared control style (btn, lnk, tog…)`);

// 3. Wording: dates as Oct-23, quarters as Q3/26 and Q4/26-Q1/27, in all fixed text and data.
const strings = [...script.matchAll(/"([^"\\]|\\.)*"|`([^`\\]|\\.)*`/g)].map((m) => m[0]).filter((s) => !/RegExp|\\b|\(\?:/.test(s));
const MON = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
for (const s of strings) {
  if (new RegExp(`\\b\\d{1,2}\\s+${MON}\\b`).test(s) || new RegExp(`\\b${MON}[a-z]*\\.?\\s+\\d{1,2}\\b(?!\\d)`).test(s)) problems.push(`Date not in Mon-DD form: ${s.slice(0, 90)}`);
  if (/\bQ[1-4][\s-]20\d{2}\b|\bQ[1-4]\d{2}-Q[1-4]\d{2}\b|\bQ[1-4]\/\d{2}\s*[–—]\s*Q/.test(s)) problems.push(`Quarter not in Q3/26 form: ${s.slice(0, 90)}`);
}

if (problems.length) { console.log(`Design check: ${problems.length} problem(s)\n- ` + problems.join("\n- ")); process.exit(1); }
console.log("Design check passed.");
