// Reads a receipt photo with Claude and returns line items as JSON.
// Called from the browser via supabase.functions.invoke('read-receipt', { body: { image, media_type } }).
// The Anthropic key lives in the function's secrets, never in the app bundle.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_KEYS = new Set(
  [Deno.env.get("SUPABASE_ANON_KEY"), "sb_publishable_7B_R3vy3enDn3Q398q8M-Q_pZtu7wFE"].filter(Boolean),
);
const MAX_BYTES = 6 * 1024 * 1024; // base64 payload cap

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
      date: parsed.date ?? null,
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
