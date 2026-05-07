// ============================================================
//  Beauty Box AI Agent — Webhook Server
//  Supports WhatsApp Cloud API payload format
// ============================================================

const express = require("express");
const axios   = require("axios");
const app     = express();
app.use(express.json());

const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID   = process.env.WAPI_VENDOR_UID   || process.env.WAPI_INSTANCE_ID || "";
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";

// ── CONVERSATION MEMORY ───────────────────────────────────────
const conversations = new Map();
function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}
function addToHistory(phone, role, content) {
  const h = getHistory(phone);
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

// ── SYSTEM PROMPT ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI assistant for Beauty Box Makeup Studio by Garima Nagpal, located in Vikaspuri, Delhi (near Janakpuri West Metro Station).

You reply to leads from Facebook and Instagram ads enquiring about Pre-Bridal packages.

YOUR GOAL: Engage warmly, collect info, share value — then guide every customer toward ONE of two next steps:
PATH A: Pay a small advance to confirm their slot (for ready customers)
PATH B: Book a studio visit — free skin check + plan discussion (for hesitant customers)

Never push. Feel like a caring beauty expert, not a salesperson.

CONVERSATION FLOW:
1. Greet warmly using their name if known, confirm wedding date + city
2. Share package info
3. Ask: "Are you following any skincare routine currently?"
4. Ask skin type: dry / oily / normal / combination
5. Share skincare tips based on skin type
6. Handle location/distance questions
7. Move to Path A or Path B

TONE: Short 2-3 line messages. Natural Hinglish. Warm like a caring beauty didi. Light emojis 🥰 ✨. End with ONE question always.
IMPORTANT: Separate multiple messages with the | character.

PATH A (ready customer - asking about slots/next steps):
"Bahut accha! Ek small advance se aap apna slot abhi secure kar sakti hain.|Kya aap abhi advance de kar slot confirm karna chahogi?"
If YES: "Perfect! Main Garima ma'am ko abhi inform karti hoon - wo aapko QR code share kar deti hain 🥰"

PATH B (hesitant - many questions or far away):
"Ek suggestion hai 🥰 Ek baar hamare studio visit karein -|Main personally aapki skin check karungi, sitting plan discuss karenge. Koi pressure nahi!|Kab convenient rahega aapko?"
If agrees: "Bahut accha! Main Garima ma'am ko inform karti hoon - wo aapse timing confirm kar lengi 🥰"

LONG DISTANCE (3 steps):
Step 1: "Metro se connected hai, sirf 2-3 sittings chahiye 🥰"
Step 2: "Hum sirf 20 brides ko is heavy discount mein le rahe hain. Services approx Rs.20,000 ki hain!"
Step 3 if still hesitant: "Bilkul samajh sakti hoon! Aap nearby salons bhi check kar sakti hain 🥰 Agar kabhi consider karein toh hum yahaan hain!"

METRO ROUTES:
- South Ex / Sarita Vihar / South Delhi: ~35-40 min Yellow Line to Janakpuri West
- Connaught Place: ~25 min Yellow Line to Janakpuri West
- Dwarka: ~15 min Pink Line to Janakpuri West
- Shahdara / East Delhi: ~53 min Pink Line from Pitampura to Janakpuri West
- Noida: ~45-50 min Blue Line to Rajiv Chowk then Yellow Line to Janakpuri West

STUDIO: Vikaspuri Delhi. Near Janakpuri West Metro. Maps: https://share.google/Wg5sfGr9GyYiNuzGB Instagram: https://www.instagram.com/garimanagpalmua/

PACKAGE: Complete pre-bridal skin+hair+makeup. Start 30-35 days before wedding. 2-4 sittings 10-15 day gaps. Within 40 days: 3 sittings. Value approx Rs.20,000.
Add-ons: Bikini wax Rs.1000, Nail extensions from Rs.500. Discount on full package - Garima confirms final price.
Timeline: 3+ months away = skincare now, facials now, full package 30-35 days before. Engagement coming = start earlier.

SKINCARE TIPS:
For Glowing Skin: 2-3L water daily, morning warm water+lemon+honey, night raw milk/rose water, weekly besan+curd+haldi+honey face pack, turmeric milk nightly
For Hair: Oil massage twice weekly coconut+castor+almond, hair mask curd+egg+olive oil, rice water rinse weekly
For Dark Circles: Cold cucumber/potato slices, almond oil before sleep, 7-8 hrs sleep
Avoid: Sugar fried food, soft drinks excess tea/coffee, late nights, crash dieting

RULES:
- If asked "Are you AI?": "Haan, main ek AI assistant hoon. Garima ma'am khud specific baaton ke liye connect karengi 🥰"
- NEVER share QR code - Garima sends manually
- NEVER confirm final price or discount amount
- NEVER push for money - always frame as "securing your slot"`;

// ── SEND MESSAGE ──────────────────────────────────────────────
async function sendMessage(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, {
      phone_number: toPhone,
      message_body: text,
      message_type: "text",
    });
    console.log(`✅ Sent to ${toPhone}: "${text.substring(0, 60)}"`);
  } catch (err) {
    console.error(`❌ Send failed:`, err?.response?.data || err.message);
  }
}

// ── CALL CLAUDE ───────────────────────────────────────────────
async function getAIReply(phone, name, userMsg) {
  const msgWithContext = name ? `[Customer name: ${name}] ${userMsg}` : userMsg;
  addToHistory(phone, "user", msgWithContext);

  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system:     SYSTEM_PROMPT,
      messages:   getHistory(phone),
    },
    {
      headers: {
        "x-api-key":         ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type":      "application/json",
      },
    }
  );

  const reply = res.data.content?.[0]?.text || "Ek second 🥰";
  addToHistory(phone, "assistant", reply);
  return reply;
}

// ── PARSE INCOMING WEBHOOK ────────────────────────────────────
// Handles WhatsApp Cloud API format:
// body.entry[0].changes[0].value.messages[0]
function parseWebhook(body) {
  try {
    // ── FORMAT 1: WhatsApp Cloud API (Meta) ──────────────────
    // This is what wapi.in.net forwards in the whatsapp_webhook_payload
    const entry    = body?.entry?.[0];
    const change   = entry?.changes?.[0];
    const value    = change?.value;
    const messages = value?.messages;

    if (messages && messages.length > 0) {
      const msg      = messages[0];
      const contacts = value?.contacts || [];
      const contact  = contacts[0]     || {};

      const phone    = msg?.from        || "";
      const name     = contact?.profile?.name || null;
      const type     = msg?.type        || "";
      const text     = msg?.text?.body  || msg?.body || "";
      const hasMedia = ["image","audio","video","document","sticker"].includes(type);

      console.log(`📦 FORMAT: WhatsApp Cloud API`);
      return { phone, name, text, hasMedia, type };
    }

    // ── FORMAT 2: wapi.in.net native format ──────────────────
    // body.contact + body.message
    const contact2 = body?.contact || {};
    const message2 = body?.message || {};
    const phone2   = contact2?.phone_number || "";
    const name2    = [contact2?.first_name, contact2?.last_name].filter(Boolean).join(" ") || null;
    const text2    = message2?.body || "";
    const hasMedia2 = !!message2?.media?.type;

    if (phone2) {
      console.log(`📦 FORMAT: wapi.in.net native`);
      return { phone: phone2, name: name2, text: text2, hasMedia: hasMedia2, type: "text" };
    }

    return null;
  } catch (e) {
    console.error("❌ Parse error:", e.message);
    return null;
  }
}

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Always respond immediately

  try {
    console.log("\n📩 Webhook received:", JSON.stringify(req.body, null, 2));

    const parsed = parseWebhook(req.body);

    if (!parsed || !parsed.phone) {
      console.log("⏭️ Skipped — could not parse phone number");
      return;
    }

    const { phone, name, text, hasMedia } = parsed;
    console.log(`👤 From: ${phone} (${name || "Unknown"})`);
    console.log(`💬 Text: "${text}" | Media: ${hasMedia}`);

    // Skip if no content at all
    if (!text && !hasMedia) {
      console.log("⏭️ Skipped — empty message");
      return;
    }

    // Media with no text
    if (hasMedia && !text) {
      await sendMessage(phone, "Main sirf text messages samajh sakti hoon abhi 🥰 Please apna sawaal text mein likhein!");
      return;
    }

    // Get AI reply and send
    const reply = await getAIReply(phone, name, text);
    console.log(`🤖 AI Reply: ${reply}`);

    const parts = reply.split("|").map(p => p.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      await sendMessage(phone, parts[i]);
    }

  } catch (err) {
    console.error("❌ Webhook error:", err?.response?.data || err.message);
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    agent:  "Beauty Box AI Agent ✅",
    claude: ANTHROPIC_API_KEY ? "Connected ✅" : "Missing ❌",
    wapi:   WAPI_VENDOR_UID   ? "Connected ✅" : "Missing ❌",
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Beauty Box Agent running on port ${PORT}`);
  console.log(`🤖 Claude:     ${ANTHROPIC_API_KEY ? "✅" : "❌ MISSING"}`);
  console.log(`📱 WAPI UID:   ${WAPI_VENDOR_UID  ? "✅" : "❌ MISSING"}`);
  console.log(`🔐 WAPI Token: ${WAPI_TOKEN       ? "✅" : "❌ MISSING"}\n`);
});
