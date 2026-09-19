const crypto = require("node:crypto");

const COOKIE_NAME = "bevalink_admin";
const SESSION_SECONDS = 8 * 60 * 60;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signature(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createSession(secret) {
  const expiry = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${expiry}.${signature(expiry, secret)}`;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
}

function authenticated(req, secret) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return false;
  const [expiry, supplied] = token.split(".");
  if (!expiry || !supplied || Number(expiry) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(supplied, signature(expiry, secret));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

async function githubRequest(path, token, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "Bevalink Admin",
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `GitHub returned ${response.status}`);
  return data;
}

function validatePayload(site, catalog) {
  if (!site || typeof site !== "object" || !catalog || typeof catalog !== "object") throw new Error("The website data is incomplete.");
  if (!Array.isArray(catalog.products) || !Array.isArray(catalog.categories)) throw new Error("The catalogue format is invalid.");
  if (catalog.products.length > 1000 || catalog.categories.length > 150) throw new Error("The catalogue is larger than the supported admin limit.");
  const bytes = Buffer.byteLength(JSON.stringify({ site, catalog }));
  if (bytes > 4_000_000) throw new Error("The catalogue is too large to publish in one update.");
}

async function publishToGitHub(site, catalog, token, repository) {
  const branch = process.env.GITHUB_BRANCH || "main";
  const encodedRepo = repository.split("/").map(encodeURIComponent).join("/");
  const ref = await githubRequest(`/repos/${encodedRepo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
  const parentSha = ref.object.sha;
  const parentCommit = await githubRequest(`/repos/${encodedRepo}/git/commits/${parentSha}`, token);
  const configContent = `window.BEVALINK_SITE = ${JSON.stringify(site, null, 2)};\n`;
  const catalogContent = `window.BEVALINK_CATALOG = ${JSON.stringify(catalog)};\n`;
  const [configBlob, catalogBlob] = await Promise.all([
    githubRequest(`/repos/${encodedRepo}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content: configContent, encoding: "utf-8" }) }),
    githubRequest(`/repos/${encodedRepo}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content: catalogContent, encoding: "utf-8" }) })
  ]);
  const tree = await githubRequest(`/repos/${encodedRepo}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({
      base_tree: parentCommit.tree.sha,
      tree: [
        { path: "dist/site-config.js", mode: "100644", type: "blob", sha: configBlob.sha },
        { path: "dist/catalog-data.js", mode: "100644", type: "blob", sha: catalogBlob.sha }
      ]
    })
  });
  const commit = await githubRequest(`/repos/${encodedRepo}/git/commits`, token, {
    method: "POST",
    body: JSON.stringify({ message: "Update Bevalink website from admin", tree: tree.sha, parents: [parentSha] })
  });
  await githubRequest(`/repos/${encodedRepo}/git/refs/heads/${encodeURIComponent(branch)}`, token, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
  return commit.sha;
}

module.exports = async function handler(req, res) {
  const adminPassword = process.env.BEVALINK_ADMIN_PASSWORD;
  const sessionSecret = process.env.BEVALINK_SESSION_SECRET;
  const githubToken = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPO || "Douglas-kavita/Bavalink";
  const setupRequired = !adminPassword || !sessionSecret || !githubToken;

  if (req.method === "GET") return json(res, 200, { authenticated: !setupRequired && authenticated(req, sessionSecret), setupRequired });
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
  if (!sameOrigin(req)) return json(res, 403, { error: "Request origin rejected." });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return json(res, 400, { error: "Invalid JSON request." });
  }
  if (body.action === "login") {
    if (setupRequired) return json(res, 503, { error: "Admin setup is incomplete.", setupRequired: true });
    if (!safeEqual(body.password || "", adminPassword)) return json(res, 401, { error: "Incorrect admin password." });
    res.setHeader("set-cookie", `${COOKIE_NAME}=${createSession(sessionSecret)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`);
    return json(res, 200, { authenticated: true });
  }

  if (body.action === "logout") {
    res.setHeader("set-cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
    return json(res, 200, { authenticated: false });
  }

  if (!setupRequired && authenticated(req, sessionSecret) && body.action === "save") {
    try {
      validatePayload(body.site, body.catalog);
      const commitSha = await publishToGitHub(body.site, body.catalog, githubToken, repository);
      return json(res, 200, { message: "Changes saved. Vercel is publishing the update.", commitSha });
    } catch (error) {
      return json(res, 500, { error: error.message || "The changes could not be published." });
    }
  }

  return json(res, 401, { error: "Your admin session has expired. Sign in again." });
};
