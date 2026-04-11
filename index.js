// ============================================================
//  Beauty Box AI Agent — Webhook Server
//  Connects wapi.in.net  ↔  Claude AI
//  Author: Built for Garima Nagpal, Beauty Box Makeup Studio
// ============================================================

const express = require("express");
const axios   = require("axios");
const app     = express();
app.use(express.json());

// ── CONFIG (set these in Railway / .env) ─────────────────────
const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";   // sk-ant-...
const WAPI_INSTANCE_ID  = process.env.WAPI_INSTANCE_ID  || "";   // from wapi.in.net dashboard
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";   // from wapi.in.net dashboard
const WAPI_BASE_URL     = "https://panel.wapi.in.net";           // wapi.in.net base URL

// ── CONVERSATION MEMORY (per phone number) ───────────────────
// Stores last 20 messages per customer so AI remembers context
const conversations = new Map();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

function addToHistory(phone, role, content) {
  const history = getHistory(phone);
  history.push({ role, content });
  // Keep only last 20 messages to avoid token overflow
  if (history.length > 20) history.splice(0, history.length - 20);
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI assistant for Beauty Box Makeup Studio by Garima Nagpal, located in Vikaspuri, Delhi (near Janakpuri West Metro Station).

You reply to leads from Facebook and Instagram ads enquiring about Pre-Bridal packages.

YOUR GOAL: Engage warmly, collect info, share value — then guide every customer toward ONE of two next steps:
→ PATH A: Pay a small advance to confirm their slot (for ready customers)
→ PATH B: Book a studio visit — free skin check + plan discussion (for hesitant customers)

Never push. The conversation should feel like talking to a caring beauty expert — not a salesperson.

CONVERSATION FLOW:
1. Greet warmly using their name if known → confirm exact wedding date + city/area
2. Mention package is being shared → "This is our complete pre-bridal package 🥰"
3. Ask: "Are you following any skincare routine currently?"
4. Ask: "Aapki skin type kya hai — dry, oily, normal ya combination?"
5. Share skincare tips based on skin type
6. Handle location/distance questions naturally
7. Read signals → move to Path A or Path B closing

TONE & STYLE:
- Short messages — 2 to 3 lines max
- Natural Hinglish — mix Hindi and English casually
- Warm, like a caring beauty didi 🥰
- Light emojis: 🥰 ✨ 💆‍♀️ 🛑
- Always end with ONE question
- IMPORTANT: If you want to send multiple short messages, separate them with the | character
  Example: "Hi Priya! 🥰 Congratulations!|Aapki shaadi ki date confirm karein?"

PATH A — ADVANCE BOOKING (ready customer):
Signals: She's asking about next steps, slots, or seems decided.
Message: "Bahut accha! 🥰 Ek small advance se aap apna slot abhi secure kar sakti hain.|Kya aap abhi advance de kar slot confirm karna chahogi?"
If YES → "Perfect! Main Garima ma'am ko abhi inform karti hoon — wo aapko QR code share kar deti hain 🥰"

PATH B — STUDIO VISIT (hesitant customer):
Signals: She's uncertain, asking many questions, or hesitant about distance.
Message: "Ek suggestion hai 🥰 Ek baar hamare studio visit karein —|Main personally aapki skin check karungi, sitting plan discuss karenge. Koi pressure nahi!|Kab convenient rahega aapko?"
If agrees → "Bahut accha! Main Garima ma'am ko inform karti hoon — wo aapse timing confirm kar lengi 🥰"

LONG DISTANCE — 3 STEP APPROACH:
Step 1 — Reassure: "Metro se connected hai, sirf 2-3 sittings chahiye 🥰"
Step 2 — Value + urgency: "Hum sirf 20 brides ko is heavy discount mein le rahe hain. Yeh services approx ₹20,000 ki hain!"
Step 3 — Honest release (if still hesitant): "Bilkul samajh sakti hoon! Aap nearby salons bhi check kar sakti hain 🥰 Agar kabhi consider karein toh hum yahaan hain!"

METRO ROUTES:
- South Ex / Sarita Vihar / South Delhi: ~35-40 min via Yellow Line → Janakpuri West
- Connaught Place / Rajiv Chowk: ~25 min Yellow Line → Janakpuri West
- Dwarka: ~15 min Pink Line → Janakpuri West
- Shahdara / East Delhi: ~53 min Pink Line from Pitampura → Janakpuri West
- Noida: ~45-50 min Blue Line → Rajiv Chowk → Yellow Line → Janakpuri West

STUDIO INFO:
Location: Vikaspuri, Delhi | Near Janakpuri West Metro
Google Maps: https://share.google/Wg5sfGr9GyYiNuzGB
Instagram: https://www.instagram.com/garimanagpalmua/

PACKAGE INFO:
Complete pre-bridal: skin + hair + makeup care (all in poster)
Ideal start: 30-35 days before wedding | 2-4 sittings | 10-15 day intervals
40 days left: can complete in 3 sittings
Value: approx ₹20,000 (heavy discount for 20 brides only)
Add-ons: Bikini wax ₹1,000 | Nail extensions from ₹500
Final pricing + discount → Garima ma'am confirms personally

TIMELINE:
- 3+ months away: "Skincare abhi se start karo, facials abhi le sakte ho. Package 30-35 days pehle start karenge."
- 1-2 months: "Perfect timing — 2-3 sittings mein ho jaega!"
- Within 40 days: "Ho jaega! 3 sittings mein complete kar sakte hain."
- Engagement also coming: suggest starting earlier for engagement glow

SKINCARE TIPS TO SHARE:
Tips for our bride to be 🥰

For Glowing Skin:
• Drink 2-3 litres water daily
• Morning: warm water + lemon + honey
• Night: raw milk or rose water on face
• Weekly: besan + curd + haldi + honey face pack
• Turmeric milk at night daily

For Hair Growth & Shine:
• Oil massage twice a week: coconut + castor + almond oil
• Hair mask: curd + egg + olive oil
• Rice water rinse once a week

For Dark Circles & Puffy Eyes:
• Cold cucumber or potato slices
• Almond oil massage before sleep
• 7-8 hours sleep (most important!)

🛑 Avoid Before Wedding:
• Too much sugar & fried food
• Soft drinks, excess tea/coffee
• Late nights | Crash dieting

RULES:
- If asked "Are you AI / bot?" → "Haan, main ek AI assistant hoon jo studio ki taraf se help kar rahi hoon. Garima ma'am specific baaton ke liye khud connect karengi 🥰"
- NEVER share QR code — Garima sends it manually
- NEVER confirm price, slot, or discount — always Garima ma'am will discuss
- NEVER push for payment directly — always frame as "securing your slot"`;

// ── SEND MESSAGE via wapi.in.net ─────────────────────────────
async function sendWhatsAppMessage(toPhone, message) {
  try {
    const url = `${WAPI_BASE_URL}/api/sendMessage`;
    await axios.post(
      url,
      {
        instanceId: WAPI_INSTANCE_ID,
        token:      WAPI_TOKEN,
        to:         toPhone,   // e.g. "919999999999"  (country code + number, no +)
        body:       message,
      },
      { headers: { "Content-Type": "application/json" } }
    );
    console.log(`✅ Sent to ${toPhone}: ${message.substring(0, 60)}...`);
  } catch (err) {
    console.error(`❌ Failed to send message:`, err?.response?.data || err.message);
  }
}

// ── CALL CLAUDE API ──────────────────────────────────────────
async function getAIReply(phone, userMessage) {
  addToHistory(phone, "user", userMessage);
  const history = getHistory(phone);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model:      "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages:   history,
    },
    {
      headers: {
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type":      "application/json",
      },
    }
  );

  const reply = response.data.content?.[0]?.text || "Ek second 🥰";
  addToHistory(phone, "assistant", reply);
  return reply;
}

// ── WEBHOOK ENDPOINT ─────────────────────────────────────────
// panel.wapi.com will POST here every time a customer sends a message
app.post("/webhook", async (req, res) => {
  // Always respond 200 immediately so wapi doesn't retry
  res.sendStatus(200);

  try {
    const body = req.body;

    // ── Log full raw payload for debugging ────────────────────
    console.log("📩 Incoming webhook (raw):", JSON.stringify(body, null, 2));

    // ── Parse incoming message ────────────────────────────────
    // panel.wapi.com sends one of two shapes:
    //   Shape A: { event, data: { from, fromMe, body, type, ... } }
    //   Shape B: { event, message: { from, body, ... } }
    // We try both and fall back gracefully.

    const event = body?.event || body?.type || "";

    // Resolve the nested message object — prefer `data`, then `message`, then root
    const messageData = body?.data || body?.message || body;

    // Extract fields from the resolved message object, with root-level fallbacks
    const messageText = messageData?.body    || messageData?.text    || messageData?.message || "";
    // panel.wapi.com places the sender's number in body.contact.phone_number;
    // fall back to the message object and root level for other providers.
    const fromPhone   = body?.contact?.phone_number || messageData?.from || messageData?.sender || body?.from || "";

    // `fromMe` can live inside the nested object (Shape A) or at root level
    const fromMe      = messageData?.fromMe  ?? body?.fromMe         ?? null;

    // Determine if this is an inbound customer message:
    //   - event must be "message" or "incoming" (or absent, for providers that omit it)
    //   - fromMe must NOT be explicitly true (null/undefined = assume inbound)
    const eventOk     = !event || event === "message" || event === "incoming";
    const isIncoming  = eventOk && fromMe !== true;

    // ── Diagnostic log so we can see exactly what was resolved ─
    const phoneSource = body?.contact?.phone_number ? "contact.phone_number"
                      : messageData?.from           ? "messageData.from"
                      : messageData?.sender         ? "messageData.sender"
                      : body?.from                  ? "body.from"
                      : "(missing)";
    console.log("🔍 Parsed fields:", {
      event:       event       || "(none)",
      fromPhone:   fromPhone   || "(missing)",
      phoneSource,
      messageText: messageText || "(missing)",
      fromMe:      fromMe      ?? "(not set)",
      eventOk,
      isIncoming,
    });

    // Skip if it's our own sent message, or not a text message
    if (!isIncoming) {
      console.log(`⏭️ Skipping — not an inbound message (event="${event}", fromMe=${fromMe})`);
      return;
    }
    if (!messageText) {
      console.log("⏭️ Skipping — no message text found in payload");
      return;
    }
    if (!fromPhone) {
      console.log("⏭️ Skipping — could not determine sender phone number");
      return;
    }

    // Clean phone number (remove @s.whatsapp.net suffix if present)
    const cleanPhone = fromPhone.replace("@s.whatsapp.net", "").replace("+", "");

    console.log(`📱 Message from ${cleanPhone}: ${messageText}`);

    // ── Get AI reply ──────────────────────────────────────────
    const aiReply = await getAIReply(cleanPhone, messageText);
    console.log(`🤖 AI Reply: ${aiReply}`);

    // ── Split by | and send as separate messages ──────────────
    // The AI is instructed to use | to separate multiple short messages
    const parts = aiReply.split("|").map(p => p.trim()).filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
      // Small delay between messages so they feel natural
      if (i > 0) await new Promise(r => setTimeout(r, 1200));
      await sendWhatsAppMessage(cleanPhone, parts[i]);
    }

  } catch (err) {
    console.error("❌ Webhook processing error:", err?.response?.data || err.message);
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status:  "✅ Beauty Box AI Agent is running!",
    time:    new Date().toISOString(),
    studio:  "Beauty Box Makeup Studio by Garima Nagpal",
  });
});

// ── START SERVER ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Beauty Box AI Agent running on port ${PORT}`);
  console.log(`📡 Webhook URL: https://YOUR-DOMAIN/webhook`);
  console.log(`🔑 Anthropic Key: ${ANTHROPIC_API_KEY ? "✅ Set" : "❌ MISSING"}`);
  console.log(`📱 WAPI Instance: ${WAPI_INSTANCE_ID ? "✅ Set" : "❌ MISSING"}`);
  console.log(`🔐 WAPI Token:    ${WAPI_TOKEN ? "✅ Set" : "❌ MISSING"}`);
});
