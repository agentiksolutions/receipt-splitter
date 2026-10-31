// Reads a receipt photo with Claude and returns line items as JSON.
// Called from the browser via supabase.functions.invoke('read-receipt', { body: { image, media_type } }).
// The Anthropic key lives in the function's secrets, never in the app bundle.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_KEYS = new Set(
  [Deno.env.get("SUPABASE_ANON_KEY"), "sb_publishable_7B_R3vy3enDn3Q398q8M-Q_pZtu7wFE"].filter(Boolean),
);
const MAX_BYTES = 6 * 1024 * 1024; // base64 payload cap

// Every accepted call spends money on a metered Anthropic request, and the only
// credential in front of this function is the publishable key that ships inside
// the public bundle. Anyone who opens the site can read it out in a minute, so
// the key is not a control and never was. These two ceilings are the control.
//
// Both are deliberately generous against real use (a meal is a handful of
// photos) and ruthless against a script. The global one is the one that matters:
// a per-IP limit alone is defeated by rotating addresses.
const PER_IP_HOURLY = 20;
const GLOBAL_DAILY = 250;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// The address is a bare identifier, not something to keep, so only its digest
// is stored. It is enough to count against and useless to anybody reading rows.
async function hashIp(ip: string) {
  const bytes = new TextEncoder().encode("rs:" + ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function countSince(filter: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rs_reads?select=id&${filter}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: "count=exact" },
  });
  if (!res.ok) {
    // Length only, never the key itself.
    console.error("count failed", res.status, (await res.text()).slice(0, 200), "keylen", SERVICE_KEY.length, "url", SUPABASE_URL);
    return null;
  }
  const range = res.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : null;
}

async function noteRead(ipHash: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/rs_reads`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ ip_hash: ipHash }),
  });
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `You are reading a photo of a restaurant, bar, or grocery receipt.
Return ONLY a JSON object, no prose, no code fence, with this shape:
{
  "merchant": string | null,
  "date": "YYYY-MM-DD" | null,
  "time": "HH:MM" (24-hour) | null,
  "items": [{ "name": string, "price": number, "qty": number }],
  "subtotal": number | null,
  "tax": number | null,
  "tip": number | null,
  "total": number | null
}
Rules:
- One entry per purchased line. If a line shows a quantity (e.g. "2 @ 4.50" or "x3"), set qty to that count and price to the LINE total as printed.
- Keep item names short and readable (title case, drop SKU codes and modifiers like "NO ONION" unless they carry a price).
- Skip subtotal, tax, tip, total, payment, change, and header/footer lines from items; report those in their own fields.
- Prices are numbers in dollars (12.4 not "$12.40").
- merchant is the store or restaurant name as printed, in title case, without address or phone.
- If a value is not visible, use null. Never invent an item.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const apikey = req.headers.get("apikey") ?? "";
  if (!ALLOWED_KEYS.has(apikey)) return json({ error: "unauthorized" }, 401);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "reader not configured" }, 500);

  // Counted before the image is even parsed, so a refused caller costs nothing
  // beyond two cheap queries. If the counter itself is unreachable the call is
  // refused rather than waved through: an unmetered reader is the thing being
  // prevented, and failing open would restore exactly the hole this closes.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = await hashIp(ip);
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [mine, everyone] = await Promise.all([
    countSince(`ip_hash=eq.${ipHash}&at=gte.${hourAgo}`),
    countSince(`at=gte.${dayAgo}`),
  ]);
  if (mine === null || everyone === null) {
    console.error("rate counter unavailable, refusing");
    return json({ error: "reader unavailable, try again shortly" }, 503);
  }
  if (mine >= PER_IP_HOURLY) {
    return json({ error: "too many receipts read from here in the last hour" }, 429);
  }
  if (everyone >= GLOBAL_DAILY) {
    console.error("global daily reader cap hit");
    return json({ error: "the reader is at its limit for today" }, 429);
  }
  await noteRead(ipHash);

  let image = "";
  let mediaType = "image/jpeg";
  try {
    const body = await req.json();
    image = String(body.image ?? "");
    mediaType = String(body.media_type ?? "image/jpeg");
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!image) return json({ error: "image required" }, 400);
  if (image.length > MAX_BYTES) return json({ error: "image too large" }, 413);
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) return json({ error: "unsupported image type" }, 415);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error("anthropic", res.status, detail.slice(0, 300));
    return json({ error: "reader failed", status: res.status }, 502);
  }

  const msg = await res.json();
  if (msg.stop_reason === "refusal") return json({ error: "reader declined this image" }, 422);
  const text = (msg.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) return json({ error: "no receipt found", raw: text.slice(0, 200) }, 422);

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    const items = Array.isArray(parsed.items)
      ? parsed.items
        .map((it: { name?: unknown; price?: unknown; qty?: unknown }) => ({
          name: String(it.name ?? "").trim(),
          price: Number(it.price),
          qty: Math.max(1, Math.round(Number(it.qty) || 1)),
        }))
        .filter((it: { name: string; price: number }) => it.name && Number.isFinite(it.price) && it.price >= 0)
      : [];
    const num = (v: unknown) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
    return json({
      merchant: parsed.merchant ?? null,
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      time: typeof parsed.time === "string" && /^\d{2}:\d{2}$/.test(parsed.time) ? parsed.time : null,
      items,
      subtotal: num(parsed.subtotal),
      tax: num(parsed.tax),
      tip: num(parsed.tip),
      total: num(parsed.total),
    });
  } catch {
    return json({ error: "could not parse receipt", raw: text.slice(0, 200) }, 422);
  }
});
