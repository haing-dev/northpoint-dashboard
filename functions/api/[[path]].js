// Dashboard API for Cloudflare Pages Functions.
// Storage: a KV namespace bound as DASH (keys: live, draft, ops, history).
// Who can edit: emails listed in ADMIN_EMAILS (comma separated), identified by Cloudflare Access.
// Email (optional): set RESEND_API_KEY and MAIL_FROM to deliver reminders; otherwise sends are logged only.

const J = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });

function who(request, env) {
  const email = (request.headers.get("cf-access-authenticated-user-email") || "").toLowerCase();
  const admins = (env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const setup = admins.length === 0; // nobody listed yet: everyone who can reach the page may edit
  return { email, admin: setup || (!!email && admins.includes(email)), setup };
}

const read = (env, key) => env.DASH.get(key, "json");
const write = (env, key, value) => env.DASH.put(key, JSON.stringify(value));

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path || []).join("/");
  const method = request.method;

  if (!env.DASH) return J({ error: "Storage isn't connected. Add a KV binding named DASH (README step 4) and redeploy." }, 503);

  const me = who(request, env);
  const mail = { enabled: !!(env.RESEND_API_KEY && env.MAIL_FROM), from: env.MAIL_FROM || "" };
  const body = async () => {
    try { return await request.json(); } catch { return {}; }
  };

  if (path === "state" && method === "GET") {
    const live = await read(env, "live");
    if (!me.admin) return J({ me, live }); // viewers only ever receive the published version
    const [draft, ops, history] = await Promise.all([read(env, "draft"), read(env, "ops"), read(env, "history")]);
    return J({ me, mail, live, draft, ops, history: history || [] });
  }

  if (!me.admin) return J({ error: "Only dashboard admins can make changes." }, 403);

  if (path === "init" && method === "POST") {
    if (await read(env, "live")) return J({ error: "The dashboard is already set up." }, 409);
    const b = await body();
    if (!b.live || !b.live.areas) return J({ error: "Missing dashboard data." }, 400);
    const draft = b.draft || b.live, ops = b.ops || {}, history = b.history || [];
    await Promise.all([write(env, "live", b.live), write(env, "draft", draft), write(env, "ops", ops), write(env, "history", history)]);
    return J({ live: b.live, draft, ops, history });
  }

  if (path === "draft" && method === "PUT") {
    const b = await body();
    if (!b.draft || !b.draft.areas) return J({ error: "Missing draft." }, 400);
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
    if (!b.draft || !b.draft.areas) return J({ error: "Missing draft." }, 400);
    const prev = await read(env, "live");
    const history = (await read(env, "history")) || [];
    const live = {
      ...b.draft,
      version: ((prev && prev.version) || 0) + 1,
      publishedAt: new Date().toISOString(),
      publishedBy: me.email || "admin",
    };
    history.unshift({
      version: live.version, at: live.publishedAt, by: live.publishedBy,
      note: String(b.note || "").slice(0, 500), changes: (b.changes || []).slice(0, 200), snapshot: live,
    });
    const kept = history.slice(0, 40);
    await Promise.all([write(env, "live", live), write(env, "draft", live), write(env, "history", kept)]);
    return J({ live, history: kept });
  }

  if (path === "send" && method === "POST") {
    const b = await body();
    const emails = (b.emails || []).slice(0, 50);
    if (!mail.enabled) return J({ results: emails.map(() => ({ status: "simulated" })) });
    const results = [];
    for (const m of emails) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: b.fromName ? `${b.fromName} <${env.MAIL_FROM}>` : env.MAIL_FROM,
            to: [m.to],
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
