const crypto = require("node:crypto");

const COOKIE_NAME = "bevalink_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const DEFAULT_SUPABASE_URL = "https://opaamrcdaqztuadcxlol.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_MHJOtiqZlpfdhIx-y5QHXg_-QrJOZwb";

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


const IMAGE_TYPES = {
  "image/jpeg": { extension: "jpg", signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: "png", signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", signature: (buffer) => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" }
};

function validateImagePayload(fileName, mimeType, data) {
  const type = IMAGE_TYPES[mimeType];
  if (!type) throw new Error("Use a JPG, PNG or WebP image.");
  if (typeof data !== "string" || !data.length || data.length > 3_500_000) throw new Error("The selected image is too large.");
  const buffer = Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (!buffer.length || buffer.length > 2_500_000) throw new Error("The selected image is too large after compression.");
  if (!type.signature(buffer)) throw new Error("The selected file is not a valid image.");
  const cleanName = String(fileName || "image").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "image";
  return { buffer, extension: type.extension, cleanName };
}

async function uploadImageToGitHub(fileName, mimeType, data, token, repository) {
  const image = validateImagePayload(fileName, mimeType, data);
  const branch = process.env.GITHUB_BRANCH || "main";
  const encodedRepo = repository.split("/").map(encodeURIComponent).join("/");
  const storedName = Date.now() + "-" + crypto.randomBytes(5).toString("hex") + "-" + image.cleanName + "." + image.extension;
  const filePath = "dist/uploads/" + storedName;
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  await githubRequest("/repos/" + encodedRepo + "/contents/" + encodedPath, token, {
    method: "PUT",
    body: JSON.stringify({
      message: "Upload Bevalink image from admin",
      content: image.buffer.toString("base64"),
      branch
    })
  });
  return "/uploads/" + storedName;
}


async function supabaseRequest(path, baseUrl, anonKey, options = {}) {
  const response = await fetch(String(baseUrl).replace(/\/$/, "") + path, {
    ...options,
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.msg || data.message || "Email authentication could not be completed.");
  return data;
}

async function supabaseSignIn(email, password, baseUrl, anonKey) {
  const data = await supabaseRequest("/auth/v1/token?grant_type=password", baseUrl, anonKey, {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  if (String(data.user?.email || "").toLowerCase() !== String(email).toLowerCase()) throw new Error("Incorrect admin email or password.");
  return data;
}

async function supabaseUser(accessToken, baseUrl, anonKey) {
  return supabaseRequest("/auth/v1/user", baseUrl, anonKey, {
    headers: { authorization: "Bearer " + accessToken }
  });
}

module.exports = async function handler(req, res) {
  const adminPassword = process.env.BEVALINK_ADMIN_PASSWORD;
  const sessionSecret = process.env.BEVALINK_SESSION_SECRET;
  const githubToken = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPO || "Douglas-kavita/Bavalink";
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  const adminEmail = String(process.env.BEVALINK_ADMIN_EMAIL || "bevalink99@gmail.com").toLowerCase();
  const emailAuthEnabled = Boolean(supabaseUrl && supabaseAnonKey && adminEmail);
  const setupRequired = (!adminPassword && !emailAuthEnabled) || !sessionSecret || !githubToken;

  if (req.method === "GET") return json(res, 200, {
    authenticated: !setupRequired && authenticated(req, sessionSecret),
    setupRequired,
    emailAuthEnabled,
    adminEmail
  });
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
    let valid = false;
    if (emailAuthEnabled) {
      try {
        await supabaseSignIn(adminEmail, String(body.password || ""), supabaseUrl, supabaseAnonKey);
        valid = true;
      } catch {}
    }
    if (!valid && adminPassword) {
      valid = safeEqual(body.password || "", adminPassword);
    }
    if (!valid) return json(res, 401, { error: "Incorrect admin password." });
    res.setHeader("set-cookie", COOKIE_NAME + "=" + createSession(sessionSecret) + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + SESSION_SECONDS);
    return json(res, 200, { authenticated: true });
  }

  if (body.action === "forgotPassword") {
    if (!emailAuthEnabled) return json(res, 503, { error: "Email password reset has not been connected yet." });
    try {
      const redirectTo = process.env.BEVALINK_ADMIN_RESET_URL || "https://www.bevalink.com/admin?reset=1";
      await supabaseRequest("/auth/v1/recover?redirect_to=" + encodeURIComponent(redirectTo), supabaseUrl, supabaseAnonKey, {
        method: "POST",
        body: JSON.stringify({ email: adminEmail })
      });
      return json(res, 200, { message: "A secure password reset link has been sent to " + adminEmail + "." });
    } catch {
      return json(res, 502, { error: "The reset email could not be sent right now. Please try again." });
    }
  }

  if (body.action === "resetPassword") {
    if (!emailAuthEnabled) return json(res, 503, { error: "Email password reset has not been connected yet." });
    const password = String(body.password || "");
    const accessToken = String(body.accessToken || "");
    if (password.length < 12) return json(res, 400, { error: "Use a password containing at least 12 characters." });
    if (!accessToken) return json(res, 400, { error: "This reset link is invalid or has expired." });
    try {
      const user = await supabaseUser(accessToken, supabaseUrl, supabaseAnonKey);
      if (String(user.email || "").toLowerCase() !== adminEmail) return json(res, 403, { error: "This reset link is not for the Bevalink administrator." });
      await supabaseRequest("/auth/v1/user", supabaseUrl, supabaseAnonKey, {
        method: "PUT",
        headers: { authorization: "Bearer " + accessToken },
        body: JSON.stringify({ password })
      });
      res.setHeader("set-cookie", COOKIE_NAME + "=" + createSession(sessionSecret) + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + SESSION_SECONDS);
      return json(res, 200, { authenticated: true, message: "Your admin password has been changed." });
    } catch {
      return json(res, 400, { error: "This reset link is invalid or has expired. Request a new email." });
    }
  }

  if (body.action === "logout") {
    res.setHeader("set-cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
    return json(res, 200, { authenticated: false });
  }


  if (!setupRequired && authenticated(req, sessionSecret) && body.action === "upload") {
    try {
      const url = await uploadImageToGitHub(body.fileName, body.mimeType, body.data, githubToken, repository);
      return json(res, 200, { message: "Image uploaded. Publish your changes when ready.", url });
    } catch (error) {
      return json(res, 400, { error: error.message || "The image could not be uploaded." });
    }
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
