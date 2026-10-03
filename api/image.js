const ALLOWED_HOSTS = new Set(["davismerchants.co.ke", "www.davismerchants.co.ke"]);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("allow", "GET");
    return res.end("Method not allowed");
  }

  const raw = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (!raw) {
    res.statusCode = 400;
    return res.end("Missing image URL");
  }

  let target;
  try {
    target = new URL(raw);
  } catch {
    res.statusCode = 400;
    return res.end("Invalid image URL");
  }

  if (!["http:", "https:"].includes(target.protocol) || !ALLOWED_HOSTS.has(target.hostname.toLowerCase())) {
    res.statusCode = 403;
    return res.end("Image host not allowed");
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "user-agent": "Bevalink image delivery/1.0",
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!upstream.ok) {
      res.statusCode = upstream.status;
      return res.end("Image unavailable");
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.toLowerCase().startsWith("image/")) {
      res.statusCode = 415;
      return res.end("Upstream resource is not an image");
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length || buffer.length > 8_000_000) {
      res.statusCode = 413;
      return res.end("Image too large");
    }

    res.statusCode = 200;
    res.setHeader("content-type", contentType.split(";")[0]);
    res.setHeader("cache-control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
    res.setHeader("x-content-type-options", "nosniff");
    return res.end(buffer);
  } catch {
    res.statusCode = 502;
    return res.end("Could not retrieve image");
  }
};
