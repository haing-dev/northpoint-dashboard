// Dashboard API for Cloudflare Pages Functions.
// Storage: KV namespace bound as DASH (keys: live, draft, ops, history, issues:live, issues:draft).
// Who can edit: emails in ADMIN_EMAILS (comma separated), identified by Cloudflare Access. Empty = anyone with the link.
// AI (optional): secret ANTHROPIC_API_KEY. AI_MODEL overrides the model.
// Email (optional): secret RESEND_API_KEY and variable MAIL_FROM; otherwise sends are logged only.

const DEFAULT_MODEL = "claude-sonnet-5-5";

const J = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });

function who(request, env) {
  const email = (request.headers.get("cf-access-authenticated-user-email") || "").toLowerCase();
  const admins = (env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const setup = admins.length === 0;
  return { email, admin: setup || (!!email && admins.includes(email)), setup };
}

const verLabel = (n) => { n = Math.max(1, +n || 1); const a = Math.floor((n - 1) / 10) + 1, b = (n - 1) % 10; return "v" + a + (b ? "." + b : ""); };
const read = (env, key) => env.DASH.get(key, "json");
function histMeta(history, live) {
  const list = (history || []).map(({ version, at, by, note }) => ({ version, at, by, note }));
  if (live && live.version && !list.some((x) => x.version === live.version)) list.unshift({ version: live.version, at: live.publishedAt, by: live.publishedBy || "", note: "" });
  return list.sort((a, b) => b.version - a.version);
}
const write = (env, key, value) => env.DASH.put(key, JSON.stringify(value));
const valid = (d) => !!(d && d.commercial && d.operations);

async function hashOf(d) {
  if (!d) return "";
  const { version, publishedAt, publishedBy, ...rest } = d;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rest)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function issuesState(env, which, data) {
  const c = await read(env, "issues:" + which);
  if (!c) return null;
  return { ...c, stale: c.hash !== (await hashOf(data)) };
}

// Clean up a pasted key: stray spaces, line breaks, quotes or a "Bearer " prefix are common copy-paste leftovers.
const cleanKey = (env) => String(env.ANTHROPIC_API_KEY || "").replace(/\s+/g, "").replace(/^["']+|["']+$/g, "").replace(/^Bearer/i, "");
function aiHeaders(env) {
  const key = cleanKey(env);
  const h = { "anthropic-version": "2023-06-01", "content-type": "application/json" };
  if (key.startsWith("sk-ant-oat")) { h.authorization = "Bearer " + key; h["anthropic-beta"] = "oauth-2025-04-20"; } // OAuth-style token
  else h["x-api-key"] = key;
  return h;
}

async function claude(env, system, user, maxTokens) {
  const r = await fetch(env.AI_BASE_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: aiHeaders(env),
    body: JSON.stringify({ model: env.AI_MODEL || DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`AI service returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0 || z < a) throw new Error("AI reply wasn't in the expected format.");
  return JSON.parse(text.slice(a, z + 1));
}

const ISSUES_SYSTEM = `You support the Value Capture Office of a platform business. You review the data behind the President's dashboard and list the issues the President should know about beyond the escalation cards already shown.
Focus on: figures that disagree between sources or owners, missing or shared owners, stale updates, totals or weights that don't add up or rest on unchecked assumptions, cost trends and cost to serve versus the margin target (costModel holds the NorthPoint deal-model drivers and the revenue per account for each offer), delivery steps that are blocked or have no update, deadlines at risk, and headline text that the figures no longer support.
Rules: use only the data given; cite the actual figures and dates; leave out anything the escalation cards or the On Track box (highlights) already cover (same topic, project, row or figure), even if you would phrase it differently; be concise and specific; no speculation.
Write quarters as Q3/26 and ranges as Q4/26-Q1/27.
Reply with JSON only, no prose, in this shape:
{"issues":[{"title":"max 8 words","issue":"what is wrong, max 30 words, with figures","impact":"why it matters, max 25 words","next":"who should do what by when, max 25 words","severity":"high|medium|low","category":"Data reporting|Commercial|Cost|Delivery|Ownership","rowIds":["ids of rows or projects from the data; use cm-margin for the deal margin"],"owners":["role names that appear in the data"]}]}
Return 3 to 6 issues, most severe first.`;

const EMAIL_SYSTEM = `You draft follow-up emails for the Value Capture Office. The emails go to senior leaders who own figures or projects on the President's dashboard.
Use exactly this structure, in plain text:
Dear <first names of the recipients> and <team> team,

Ahead of the next leadership review on <review date>, we would like to flag the following issues:
(If the topic is a data submission rather than a leadership-review item, adapt this line, for example: "As part of the data collection for the <cut-off> reporting cut-off, we would like to flag the following:")

1. <Issue 1 title>
   1. Explanation: <full sentence with the actual figures, e.g. "The current Q3-2026 booking revenue, based on the Finance booking log, is $41M, which is $19M (32%) below the plan of $60M.">
   2. Impact: <full sentence on what this means for the plan or the review>
   3. Action: <full sentence starting with "Please", saying exactly what is needed>

2. <Issue 2 title>
   1. Explanation: ...
   2. Impact: ...
   3. Action: ...

Please let us know your latest update by <reply-by date>. Please reach out to us if there's any question.

Best,
<sender>
Rules: one numbered issue per distinct issue given; never repeat the same point in two issues (merge them instead); write complete, plain sentences, not fragments; use only the facts and figures given; no filler.
Write quarters as Q3/26 and ranges as Q4/26-Q1/27.
Reply with JSON only: {"subject":"...","body":"..."} where body is plain text with \\n line breaks.`;

const SUGGEST_SYSTEM = `You keep the wording on the President's dashboard in line with the latest figures, for the Value Capture Office.
You get the dashboard data and the current text of the On Track box (highlights), the escalation cards and each project's key blocker (keyNote).
Rewrite each text so every figure, percentage, date and claim matches the data exactly. Keep the same topic, order, tone and length (each field under 30 words). If a statement is no longer true, change it to what the data now shows. Don't invent facts, names or dates that aren't in the data.
Write quarters as Q3/26 and ranges as Q4/26-Q1/27.
Reply with JSON only, no prose, in this shape:
{"highlights":[{"id":1,"good":"...","risk":"...","next":"..."}],"escalations":[{"id":1,"issue":"...","impact":"...","next":"..."}],"keyNotes":[{"id":"project id","text":"..."}]}`;

async function numHash(d) {
  // Hash of the figures only, so rewriting the text doesn't trigger another rewrite.
  const ops = (d.operations || []).map(({ keyNote, ...p }) => p);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ c: d.commercial, k: d.cost, o: ops, m: d.meta, e: (d.escalations || []).map((e) => e.id), h: (d.highlights || []).map((g) => g.id) })));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// Keep the wording people wrote when the page format is upgraded: the On Track box and escalation cards
// (and which of their fields were edited by hand) are carried over from the previous live version.
// House style (applied on edit, on load, on publish, to AI text and to emails):
//   quarters  Q3/26, ranges Q4/26-Q1/27;  dates  Oct-23 (month-day, no weekday, no year).
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONRE = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const DOWRE = "(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\\s+)?";
const monOf = m => MON3.find(x => m.startsWith(x)) || m.slice(0, 3);
const DATE_A = new RegExp("\\b" + DOWRE + "(\\d{1,2})(?:st|nd|rd|th)?\\s+" + MONRE + "\\.?(?:,?\\s+20\\d{2})?\\b", "g");
const DATE_B = new RegExp("\\b" + DOWRE + MONRE + "\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+20\\d{2})?", "g");
function normDates(s){
  if(typeof s !== "string" || !/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(s)) return s;
  return s.replace(DATE_A, (m, d, mon) => `${monOf(mon)}-${String(d).padStart(2, "0")}`)
          .replace(DATE_B, (m, mon, d) => +d >= 1 && +d <= 31 ? `${monOf(mon)}-${String(d).padStart(2, "0")}` : m);
}
function normPeriods(t, cur){
  if(typeof t !== "string") return t;
  let s = t;
  if(/q\s*[1-4]/i.test(s)){
    s = s.replace(/\b[Qq]\s*([1-4])(?:\s*[-\/'’]\s*(?:FY)?|\s+(?=20\d{2}\b)|\s*FY\s?|(?=\d{2}\b))(?:20)?(\d{2})\b/g, "Q$1/$2");
    s = s.replace(/(Q[1-4]\/\d{2})\s*(?:–|—|-|to|until|through)\s*(Q[1-4]\/\d{2})/gi, "$1-$2");
    if(cur) s = s.replace(new RegExp("\\bQ" + cur.q + "\\b(?![\\/\\d'’-])", "g"), `Q${cur.q}/${cur.y}`); // a bare current quarter gets its year
  }
  return normDates(s);
}
function curQuarter(d){ const m = String((d && d.meta && d.meta.asOf) || "").match(/^(\d{4})-(\d{2})/); return m ? { q: Math.ceil(+m[2] / 3), y: m[1].slice(2) } : null; }
function normDeep(x, cur){ if(typeof x === "string") return normPeriods(x, cur); if(Array.isArray(x)) return x.map(v => normDeep(v, cur)); if(x && typeof x === "object"){ const o = {}; for(const k in x) o[k] = normDeep(x[k], cur); return o; } return x; }
function periodFix(d) { return normDeep(d, curQuarter(d)); }
function carryText(old, cur, base) {
  if (!valid(old) || !valid(cur)) return cur;
  const out = JSON.parse(JSON.stringify(cur));
  out.manual = out.manual || {};
  const copy = (listName, fields) => (out[listName] || []).forEach((x, i) => {
    const oi = (old[listName] || []).findIndex((y) => y.id === x.id), o = oi >= 0 ? old[listName][oi] : null; if (!o) return;
    const om = old.manual || {}, hasFlags = Object.keys(om).some((k) => k.startsWith("d:highlights.") || k.startsWith("d:escalations."));
    const b0 = base && (base[listName] || []).find((y) => y.id === x.id);
    fields.forEach((f) => {
      if (typeof o[f] !== "string" || !o[f]) return;
      if (b0 && x[f] !== b0[f]) return; // changed again since the reset: keep the newer text
      if (hasFlags ? !om[`d:${listName}.${oi}.${f}`] : (b0 && o[f] === b0[f])) return; // only carry text someone wrote by hand
      x[f] = o[f]; out.manual[`d:${listName}.${i}.${f}`] = true;
    });
  });
  copy("highlights", ["title", "good", "risk", "next"]);
  copy("escalations", ["title", "issue", "impact", "next"]);
  return out;
}
// One-off data fix: FY-2026 recognized revenue is still reported by Head of Sales from a spreadsheet (the issue); amber reporting flag.
function patchRevenue(d) {
  if (!valid(d)) return d;
  (d.commercial || []).forEach((s) => (s.rows || []).forEach((r) => {
    if (r.id !== "rev-fy") return;
    const v = r.owners && r.owners[0] && "value" in r.owners[0] ? r.owners[0].value : 95;
    r.owners = [{ role: "Head of Sales", source: "Spreadsheet (Head of Sales)", value: v }]; r.owner = 0; r.ownerWarn = true;
    r.risk = { ...(r.risk || {}), reporting: "amber" };
    r.tips = { ...(r.tips || {}), reporting: { text: "Reported by Head of Sales from a spreadsheet; Finance should own this figure" } };
  }));
  return d;
}
async function migrateRevenue(env) {
  if (await env.DASH.get("migr:revfy-sales")) return;
  const [live, draft] = await Promise.all([read(env, "live"), read(env, "draft")]);
  if (!valid(live)) return;
  await Promise.all([write(env, "live", patchRevenue(live)), valid(draft) ? write(env, "draft", patchRevenue(draft)) : null, env.DASH.put("migr:revfy-sales", new Date().toISOString())]);
}
async function migrateText(env) {
  if (await env.DASH.get("migr:text-13")) return;
  const [arch, live, draft, history] = await Promise.all([read(env, "archive-schema-12"), read(env, "live"), read(env, "draft"), read(env, "history")]);
  if (!arch || !valid(arch.live) || !valid(live) || (live.schema || 0) < 13) return;
  const baseEntry = (history || []).find((x) => x.note === "Q3 tracker extract"), base = baseEntry && baseEntry.snapshot;
  const fixedLive = periodFix(carryText(arch.live, live, base));
  const newLive = { ...fixedLive, version: Math.max(live.version || 1, arch.live.version || 1) + 1, publishedAt: new Date().toISOString(), publishedBy: "format update" };
  const newDraft = periodFix(carryText(arch.live, valid(draft) ? draft : live, base));
  const h = (history || []).filter((x) => x.version !== newLive.version);
  h.unshift({ version: newLive.version, at: newLive.publishedAt, by: "format update", note: "Card text restored after format update", snapshot: newLive });
  if (!h.some((x) => x.version === arch.live.version)) h.push({ version: arch.live.version, at: arch.live.publishedAt, by: arch.live.publishedBy || "", note: "Before format update", snapshot: arch.live });
  await Promise.all([write(env, "live", newLive), write(env, "draft", newDraft), write(env, "history", h.slice(0, 40)), env.DASH.put("migr:text-13", new Date().toISOString())]);
}

function compact(d) {
  // Keep the payload small and readable for the model.
  return JSON.stringify({ asOf: d.meta && d.meta.asOf, header: d.header, highlights: d.highlights, escalations: d.escalations, commercial: d.commercial, cost: d.cost, costModel: d.costModel, operations: d.operations, footnote: d.footnote, today: new Date().toISOString().slice(0, 10) });
}

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path || []).join("/");
  const method = request.method;

  if (!env.DASH) return J({ error: "Storage isn't connected. Add a KV binding named DASH and redeploy." }, 503);

  const me = who(request, env);
  const mail = { enabled: !!(env.RESEND_API_KEY && env.MAIL_FROM), from: env.MAIL_FROM || "" };
  const ai = { enabled: !!env.ANTHROPIC_API_KEY };
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  if (path === "state" && method === "GET") {
    try { await migrateText(env); } catch (e) { /* keep serving even if the one-off carry-over fails */ }
    try { await migrateRevenue(env); } catch (e) { /* same */ }
    const live = await read(env, "live");
    const liveIssues = valid(live) ? await issuesState(env, "live", live) : null;
    if (!me.admin) return J({ me, ai, live, issues: { live: liveIssues, draft: null } });
    const [draft, ops, history] = await Promise.all([read(env, "draft"), read(env, "ops"), read(env, "history")]);
    const draftIssues = valid(draft) ? await issuesState(env, "draft", draft) : null;
    return J({ me, mail, ai, live, draft, ops, history: histMeta(history, live), issues: { live: liveIssues, draft: draftIssues } });
  }

  if (path === "ai/check" && method === "GET") {
    // Diagnostics without revealing the key: what Cloudflare passed in and what the AI service answers.
    const raw = String(env.ANTHROPIC_API_KEY || ""), key = cleanKey(env);
    const out = { keyPresent: !!raw, keyLength: key.length, keyStart: key.slice(0, 10), hadSpacesOrQuotes: raw !== key, keyType: key.startsWith("sk-ant-oat") ? "oauth token" : key.startsWith("sk-ant-api") ? "API key" : "unrecognised format", model: env.AI_MODEL || DEFAULT_MODEL, endpoint: env.AI_BASE_URL || "https://api.anthropic.com/v1/messages" };
    if (!raw) return J({ ...out, result: "No ANTHROPIC_API_KEY reaches the site. Add it under Settings > Variables and Secrets for Production, then redeploy." });
    try {
      const r = await fetch(out.endpoint, { method: "POST", headers: aiHeaders(env), body: JSON.stringify({ model: out.model, max_tokens: 5, messages: [{ role: "user", content: "Say ok" }] }) });
      out.status = r.status; out.answer = (await r.text()).slice(0, 300);
      out.result = r.ok ? "AI works." : r.status === 401 ? "The AI service rejected the key." : r.status === 404 ? "Key accepted, but the model name wasn't found; set AI_MODEL." : r.status === 429 ? (out.keyType === "oauth token" ? "Key accepted, but requests are refused (429). This is a sign-in token for a Claude account, not an API key; use an API key (sk-ant-api…) instead." : "Key accepted, but the rate limit is reached (429); try again later or raise the limit.") : "See status and answer.";
    } catch (e) { out.result = "Couldn't reach the AI service: " + String(e.message || e); }
    return J(out);
  }

  if (path === "ai/issues" && method === "POST") {
    const b = await body();
    const which = b.which === "draft" && me.admin ? "draft" : "live";
    if (!ai.enabled) return J({ error: "AI isn't connected. Add the ANTHROPIC_API_KEY secret." }, 501);
    const data = await read(env, which);
    if (!valid(data)) return J({ error: "No data yet." }, 404);
    const hash = await hashOf(data);
    const cached = await read(env, "issues:" + which);
    if (cached && cached.hash === hash && !b.force) return J({ ...cached, stale: false });
    try {
      const out = normDeep(await claude(env, ISSUES_SYSTEM, "Dashboard data:\n" + compact(data), 1800), curQuarter(data));
      const items = (out.issues || []).slice(0, 8).map((x) => ({
        title: String(x.title || "").slice(0, 120), issue: String(x.issue || x.detail || "").slice(0, 400), impact: String(x.impact || "").slice(0, 300), next: String(x.next || "").slice(0, 300),
        severity: ["high", "medium", "low"].includes(x.severity) ? x.severity : "medium",
        category: String(x.category || "").slice(0, 40), rowIds: (x.rowIds || []).map(String).slice(0, 10), owners: (x.owners || []).map(String).slice(0, 6),
      }));
      const res = { hash, at: new Date().toISOString(), items, stale: false };
      await write(env, "issues:" + which, res);
      return J(res);
    } catch (e) {
      return J({ error: String(e.message || e) }, 502);
    }
  }

  if (!me.admin) return J({ error: "Only dashboard admins can make changes." }, 403);

  if (path === "init" && method === "POST") {
    const existing = await read(env, "live");
    const b0 = await request.clone().json().catch(() => ({}));
    if (valid(existing) && (existing.schema || 0) >= ((b0.live && b0.live.schema) || 0)) return J({ error: "The dashboard is already set up." }, 409);
    const b = await body();
    if (!valid(b.live)) return J({ error: "Missing dashboard data." }, 400);
    if (existing) await write(env, "archive-schema-" + (existing.schema || 1), { live: existing, at: new Date().toISOString() }); // keep the old-format data
    const oldHist = existing ? ((await read(env, "history")) || []) : [];
    if (valid(existing)) { b.live = periodFix(carryText(existing, b.live)); b.live.version = (existing.version || 1) + 1; b.live.publishedAt = new Date().toISOString(); b.live.publishedBy = "format update"; }
    const draft = valid(existing) ? b.live : (valid(b.draft) ? b.draft : b.live);
    const ops = (await read(env, "ops")) || b.ops || {};
    const history = [{ version: b.live.version || 1, at: b.live.publishedAt || new Date().toISOString(), by: b.live.publishedBy || "", note: existing ? "Format update; card text kept" : "Q3 tracker extract", snapshot: b.live }, ...oldHist.filter((x) => x.version !== b.live.version)].slice(0, 40);
    await Promise.all([write(env, "live", b.live), write(env, "draft", draft), write(env, "ops", ops), write(env, "history", history)]);
    return J({ live: b.live, draft, ops, history: histMeta(history, b.live), issues: { live: null, draft: null } });
  }

  if (path === "draft" && method === "PUT") {
    const b = await body();
    if (!valid(b.draft)) return J({ error: "Missing draft." }, 400);
    await write(env, "draft", b.draft);
    return J({ ok: true });
  }

  if (path === "ops" && method === "PUT") {
    const b = await body();
    if (!b.ops || typeof b.ops !== "object") return J({ error: "Missing settings." }, 400);
    b.ops.outbox = (b.ops.outbox || []).slice(0, 500);
    await write(env, "ops", b.ops);
    return J({ ok: true });
  }

  if (path === "publish" && method === "POST") {
    const b = await body();
    if (!valid(b.draft)) return J({ error: "Missing draft." }, 400);
    b.draft = periodFix(b.draft);
    const prev = await read(env, "live");
    const history = (await read(env, "history")) || [];
    if (valid(prev) && !history.some((x) => x.version === prev.version)) history.unshift({ version: prev.version, at: prev.publishedAt, by: prev.publishedBy || "", note: "", snapshot: prev });
    const live = { ...b.draft, version: ((prev && prev.version) || 0) + 1, publishedAt: new Date().toISOString(), publishedBy: me.email || "admin" };
    history.unshift({ version: live.version, at: live.publishedAt, by: live.publishedBy, note: "", snapshot: live });
    const kept = history.slice(0, 40);
    const writes = [write(env, "live", live), write(env, "draft", live), write(env, "history", kept)];
    const di = await read(env, "issues:draft");
    let issues = null;
    if (di && di.hash === (await hashOf(live))) { issues = { ...di, stale: false }; writes.push(write(env, "issues:live", di)); }
    await Promise.all(writes);
    return J({ live, issues, history: histMeta(kept, live) });
  }

  if (path === "restore" && method === "POST") {
    const b = await body();
    const prev = await read(env, "live");
    const history = (await read(env, "history")) || [];
    const h0 = history.find((x) => x.version === +b.version);
    if (!h0 || !valid(h0.snapshot)) return J({ error: "That version isn't stored." }, 404);
    if (valid(prev) && !history.some((x) => x.version === prev.version)) history.unshift({ version: prev.version, at: prev.publishedAt, by: prev.publishedBy || "", note: "", snapshot: prev });
    const live = { ...h0.snapshot, version: ((prev && prev.version) || 0) + 1, publishedAt: new Date().toISOString(), publishedBy: me.email || "admin" };
    history.unshift({ version: live.version, at: live.publishedAt, by: live.publishedBy, note: `Restored from ${verLabel(h0.version)}`, snapshot: live });
    const kept = history.slice(0, 40);
    await Promise.all([write(env, "live", live), write(env, "draft", live), write(env, "history", kept)]);
    return J({ live, history: histMeta(kept, live) });
  }

  if (path === "ai/draft" && method === "POST") {
    if (!ai.enabled) return J({ error: "AI isn't connected." }, 501);
    const b = await body();
    if (!valid(b.draft)) return J({ error: "Missing draft." }, 400);
    const hash = await numHash(b.draft);
    const cached = await read(env, "suggest:draft");
    if (cached && cached.hash === hash && !b.force) return J(cached);
    try {
      const out = normDeep(await claude(env, SUGGEST_SYSTEM, "Dashboard data:\n" + compact(b.draft), 1600), curQuarter(b.draft));
      const t = (x) => String(x || "").slice(0, 400);
      const res = {
        hash, at: new Date().toISOString(),
        highlights: (out.highlights || []).slice(0, 6).map((g) => ({ id: +g.id, good: t(g.good), risk: t(g.risk), next: t(g.next) })),
        escalations: (out.escalations || []).slice(0, 6).map((e) => ({ id: +e.id, issue: t(e.issue), impact: t(e.impact), next: t(e.next) })),
        keyNotes: (out.keyNotes || []).slice(0, 20).map((k) => ({ id: String(k.id || ""), text: t(k.text) })),
      };
      await write(env, "suggest:draft", res);
      return J(res);
    } catch (e) {
      return J({ error: String(e.message || e) }, 502);
    }
  }

  if (path === "ai/email" && method === "POST") {
    if (!ai.enabled) return J({ error: "AI isn't connected." }, 501);
    const b = await body();
    const c = b.context || {};
    const user = [
      `Topic: ${c.label || ""}`,
      `Issue: ${c.issue || ""}`,
      c.impact ? `Why it matters: ${c.impact}` : "",
      c.next ? `What is needed: ${c.next}` : "",
      (c.facts || []).length ? `Figures:\n- ${c.facts.join("\n- ")}` : "",
      `Recipients: ${(b.recipients || []).map((r) => [r.name, r.role].filter(Boolean).join(", ")).join("; ") || "data owners"}`,
      c.owner ? `Data owner role (team): ${c.owner}` : "",
      String(c.ref || "").startsWith("sub:") ? "This is a data submission follow-up, not a leadership-review item." : "",
      `Sender: ${b.sender || "Value Capture Office"}`,
      `Leadership review: ${b.reviewDate || ""}. Reply needed by: ${b.replyBy || ""}.`,
      b.current ? `Current draft to revise:\nSubject: ${b.current.subject}\n${b.current.body}` : "",
      b.instruction ? `Change requested by the sender: ${b.instruction}` : "",
    ].filter(Boolean).join("\n\n");
    try {
      const out = normDeep(await claude(env, EMAIL_SYSTEM, user, 1200), curQuarter(await read(env, "live")));
      if (!out.subject || !out.body) throw new Error("AI reply was missing a subject or body.");
      return J({ subject: String(out.subject).slice(0, 200), body: String(out.body).slice(0, 6000) });
    } catch (e) {
      return J({ error: String(e.message || e) }, 502);
    }
  }

  if (path === "send" && method === "POST") {
    const b = await body();
    const emails = (b.emails || []).slice(0, 20);
    if (!mail.enabled) return J({ results: emails.map(() => ({ status: "simulated" })) });
    const results = [];
    for (const m of emails) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: b.fromName ? `${b.fromName} <${env.MAIL_FROM}>` : env.MAIL_FROM,
            to: [].concat(m.to).slice(0, 20),
            cc: m.cc ? String(m.cc).split(/[\s,;]+/).filter(Boolean) : undefined,
            reply_to: b.replyTo || undefined,
            subject: normPeriods(m.subject),
            text: normPeriods(m.body),
          }),
        });
        results.push(r.ok ? { status: "sent" } : { status: "failed", error: `Mail service returned ${r.status}: ${(await r.text()).slice(0, 200)}` });
      } catch (e) {
        results.push({ status: "failed", error: String((e && e.message) || e) });
      }
    }
    return J({ results });
  }

  return J({ error: "Not found." }, 404);
}
