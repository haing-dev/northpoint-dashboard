// Password gate for the whole site (pages and API). Anyone with the link and the password can open it.
// The password can be changed with a SITE_PASSWORD variable in Cloudflare; otherwise the default below is used.
const DEFAULT_PASSWORD = "fis";
const COOKIE = "np_auth";

async function token(env) {
  const pw = env.SITE_PASSWORD || DEFAULT_PASSWORD;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("northpoint-dashboard|" + pw + "|" + (env.SITE_SECRET || "")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeNext = (n) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

function loginPage(next, wrong) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Sign in · NorthPoint dashboard</title>
<style>
:root{--ink:#000;--deep:#051C2C;--grey:#595959;--rule:#D9D9D9;--neg:#C00000}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F2F2;font:15px/1.5 Arial,Helvetica,sans-serif;color:var(--ink);padding:16px}
form{background:#fff;padding:32px;width:100%;max-width:360px;border-top:4px solid var(--deep);box-shadow:0 8px 30px rgba(5,28,44,.12)}
.k{font:700 11px Arial;letter-spacing:.08em;text-transform:uppercase;color:var(--grey);margin:0 0 6px}
h1{font-size:20px;margin:0 0 20px}
label{display:block;font:700 11px Arial;letter-spacing:.06em;text-transform:uppercase;color:var(--grey);margin-bottom:6px}
input{width:100%;padding:10px 12px;font:15px Arial;border:1px solid #7F7F7F;border-radius:2px}
input:focus{outline:2px solid var(--deep);outline-offset:1px}
button{margin-top:16px;width:100%;padding:11px;background:var(--deep);color:#fff;border:0;border-radius:2px;font:700 14px Arial;cursor:pointer}
.err{color:var(--neg);font-size:13px;margin:10px 0 0}
</style></head><body>
<form method="post" action="/__login"><p class="k">Platform BU</p><h1>NorthPoint leadership dashboard</h1>
<label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${esc(next)}">
${wrong ? '<p class="err" role="alert">That password isn\'t right. Try again.</p>' : ""}
<button type="submit">Open dashboard</button></form></body></html>`;
  return new Response(html, { status: 401, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", "x-login": "1" } });
}

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const expected = await token(env);

  if (url.pathname === "/__login" && request.method === "POST") {
    const form = await request.formData().catch(() => null);
    const pw = form ? String(form.get("password") || "") : "";
    const to = safeNext(form && form.get("next"));
    if (pw === (env.SITE_PASSWORD || DEFAULT_PASSWORD)) {
      return new Response(null, { status: 303, headers: { location: to, "set-cookie": `${COOKIE}=${expected}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`, "cache-control": "no-store" } });
    }
    return loginPage(to, true);
  }
  if (url.pathname === "/__logout") {
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } });
  }

  const cookie = (request.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (cookie && cookie.slice(COOKIE.length + 1) === expected) return next();

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Please sign in." }), { status: 401, headers: { "content-type": "application/json", "x-login": "1", "cache-control": "no-store" } });
  }
  return loginPage(url.pathname + url.search, false);
}
