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

const read = (env, key) => env.DASH.get(key, "json");
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

async function claude(env, system, user, maxTokens) {
  const r = await fetch(env.AI_BASE_URL || "https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.AI_MODEL || DEFAULT_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`AI service returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0 || z < a) throw new Error("AI reply wasn't in the expected format.");
  return JSON.parse(text.slice(a, z + 1));
}

const ISSUES_SYSTEM = `You support the programme management office of a platform business. You review the data behind the President's dashboard and list the issues the President should know about beyond the escalation cards already shown.
Focus on: figures that disagree between sources or owners, missing or shared owners, stale updates, totals or weights that don't add up or rest on unchecked assumptions, cost trends, delivery steps that are blocked or have no update, deadlines at risk, and headline text that the figures no longer support.
Rules: use only the data given; cite the actual figures and dates; don't repeat an escalation card unless you add something new; be concise and specific; no speculation.
Reply with JSON only, no prose, in this shape:
{"issues":[{"title":"max 10 words","detail":"max 45 words, with figures","severity":"high|medium|low","category":"Data reporting|Commercial|Cost|Delivery|Ownership","rowIds":["ids of rows or projects from the data"],"owners":["role names that appear in the data"]}]}
Return 3 to 7 issues, most severe first.`;

const EMAIL_SYSTEM = `You draft follow-up emails for a programme management office. The emails go to senior leaders who own figures or projects on the President's dashboard.
Write plainly and politely, in short paragraphs, with the specific figures given. Say what is needed, from whom, and by when. No filler, no exaggeration, nothing beyond the facts given. Address recipients by first name. Sign off with the sender's name.
Reply with JSON only: {"subject":"...","body":"..."} where body is plain text with \\n line breaks.`;

function compact(d) {
  // Keep the payload small and readable for the model.
  return JSON.stringify({ asOf: d.meta && d.meta.asOf, header: d.header, escalations: d.escalations, commercial: d.commercial, cost: d.cost, operations: d.operations, footnote: d.footnote, today: new Date().toISOString().slice(0, 10) });
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
    const live = await read(env, "live");
    const liveIssues = valid(live) ? await issuesState(env, "live", live) : null;
    if (!me.admin) return J({ me, ai, live, issues: { live: liveIssues, draft: null } });
    const [draft, ops] = await Promise.all([read(env, "draft"), read(env, "ops")]);
    const draftIssues = valid(draft) ? await issuesState(env, "draft", draft) : null;
    return J({ me, mail, ai, live, draft, ops, issues: { live: liveIssues, draft: draftIssues } });
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
      const out = await claude(env, ISSUES_SYSTEM, "Dashboard data:\n" + compact(data), 1800);
      const items = (out.issues || []).slice(0, 8).map((x) => ({
        title: String(x.title || "").slice(0, 120), detail: String(x.detail || "").slice(0, 500),
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
    if (valid(existing)) return J({ error: "The dashboard is already set up." }, 409);
    const b = await body();
    if (!valid(b.live)) return J({ error: "Missing dashboard data." }, 400);
    const draft = valid(b.draft) ? b.draft : b.live, ops = b.ops || {};
    if (existing) await write(env, "history-v1", { live: existing, at: new Date().toISOString() }); // keep the old-format data
    await Promise.all([write(env, "live", b.live), write(env, "draft", draft), write(env, "ops", ops), write(env, "history", [])]);
    return J({ live: b.live, draft, ops, issues: { live: null, draft: null } });
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
    const prev = await read(env, "live");
    const history = (await read(env, "history")) || [];
    const live = { ...b.draft, version: ((prev && prev.version) || 0) + 1, publishedAt: new Date().toISOString(), publishedBy: me.email || "admin" };
    history.unshift({ version: live.version, at: live.publishedAt, by: live.publishedBy, snapshot: live });
    const writes = [write(env, "live", live), write(env, "draft", live), write(env, "history", history.slice(0, 40))];
    const di = await read(env, "issues:draft");
    let issues = null;
    if (di && di.hash === (await hashOf(live))) { issues = { ...di, stale: false }; writes.push(write(env, "issues:live", di)); }
    await Promise.all(writes);
    return J({ live, issues });
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
      `Sender: ${b.sender || "Programme Management Office"}`,
      `Leadership review: ${b.reviewDate || ""}. Reply needed by: ${b.replyBy || ""}.`,
      b.current ? `Current draft to revise:\nSubject: ${b.current.subject}\n${b.current.body}` : "",
      b.instruction ? `Change requested by the sender: ${b.instruction}` : "",
    ].filter(Boolean).join("\n\n");
    try {
      const out = await claude(env, EMAIL_SYSTEM, user, 1200);
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
            subject: m.subject,
            text: m.body,
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
