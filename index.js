// ============================================================
//  Beauty Box AI Agent — Webhook Server
//  Only activates for Meta Lead Ad messages
// ============================================================

const express = require("express");
const axios   = require("axios");
const app     = express();
app.use(express.json());

const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID   = process.env.WAPI_VENDOR_UID   || process.env.WAPI_INSTANCE_ID || "";
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";

// ── META LEAD TRIGGER ─────────────────────────────────────────
// AI only activates when message contains this exact Meta phrase
const META_TRIGGER = "i filled in your form and would like to know more about your business";

function isMetaLead(text) {
  return text.toLowerCase().includes(META_TRIGGER);
}

// ── EXTRACT LEAD DETAILS FROM META MESSAGE ────────────────────
// Parses: full_name, phone_number, when_is_your_wedding_date, city/area
function extractLeadDetails(text) {
  const details = {};
  const lines   = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("full_name:"))                  details.name        = line.split(":")[1]?.trim();
    if (lower.startsWith("phone_number:"))               details.phone_lead  = line.split(":")[1]?.trim();
    if (lower.startsWith("when_is_your_wedding_date:"))  details.wedding     = line.split(":").slice(1).join(":").trim();
    if (lower.startsWith("city/area:"))                  details.city        = line.split(":")[1]?.trim();
    if (lower.startsWith("city:"))                       details.city        = line.split(":")[1]?.trim();
    if (lower.startsWith("area:"))                       details.city        = line.split(":")[1]?.trim();
  }
  return details;
}

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

FIRST MESSAGE HANDLING:
When you receive a lead, you will be given their details: name, wedding date, city.
- Greet them warmly by first name
- Acknowledge their wedding date and city
- If wedding is within 1-2 months: show excitement, say perfect timing
- If wedding is 3+ months: say great, skincare can start now
- Then ask about their skin type OR current skincare routine
- Keep first reply warm and short — 2 messages maximum

CONVERSATION FLOW:
1. Greet with name, acknowledge wedding date + city
2. Ask skin type: dry / oily / normal / combination
3. Ask if they follow any skincare routine currently
4. Share skincare tips based on skin type
5. Handle location/distance questions
6. Move to Path A or Path B

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
async function getAIReply(phone, contextMsg) {
  addToHistory(phone, "user", contextMsg);

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
function parseWebhook(body) {
  try {
    // FORMAT 1: WhatsApp Cloud API (Meta format via wapi.in.net)
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg      = messages[0];
      const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts || [];
      const contact  = contacts[0] || {};
      const type     = msg?.type || "";
      const hasMedia = ["image","audio","video","document","sticker"].includes(type);
      return {
        phone:    msg?.from || "",
        name:     contact?.profile?.name || null,
        text:     msg?.text?.body || msg?.body || "",
        hasMedia,
      };
    }

    // FORMAT 2: wapi.in.net native
    const phone2 = body?.contact?.phone_number || "";
    if (phone2) {
      return {
        phone:    phone2,
        name:     [body?.contact?.first_name, body?.contact?.last_name].filter(Boolean).join(" ") || null,
        text:     body?.message?.body || "",
        hasMedia: !!body?.message?.media?.type,
      };
    }

    return null;
  } catch (e) {
    console.error("❌ Parse error:", e.message);
    return null;
  }
}

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const parsed = parseWebhook(req.body);
    if (!parsed || !parsed.phone) {
      console.log("⏭️ Skipped — could not parse");
      return;
    }

    const { phone, name, text, hasMedia } = parsed;
    console.log(`📩 From: ${phone} | Text: "${text.substring(0,80)}"`);

    if (!text && !hasMedia) {
      console.log("⏭️ Skipped — empty");
      return;
    }

    // ── CHECK: Is this a new Meta lead? ──────────────────────
    const isNewLead    = isMetaLead(text);
    const hasHistory   = conversations.has(phone) && getHistory(phone).length > 0;

    // If not a Meta lead AND no existing conversation → ignore completely
    if (!isNewLead && !hasHistory) {
      console.log(`⏭️ Ignored — not a Meta lead and no existing conversation: ${phone}`);
      return;
    }

    // ── BUILD CONTEXT MESSAGE FOR AI ─────────────────────────
    let contextMsg = text;

    if (isNewLead) {
      // Extract lead details from Meta message
      const lead = extractLeadDetails(text);
      console.log(`🎯 META LEAD detected! Name: ${lead.name} | Wedding: ${lead.wedding} | City: ${lead.city}`);

      // Build a clean context message for Claude
      contextMsg = `New lead from Meta ad:
Name: ${lead.name || name || "not provided"}
Wedding date: ${lead.wedding || "not provided"}
City/Area: ${lead.city || "not provided"}
Their message: ${text}

Please greet them warmly by name and start the conversation.`;
    }

    // ── GET AI REPLY AND SEND ─────────────────────────────────
    const reply = await getAIReply(phone, contextMsg);
    console.log(`🤖 Reply: ${reply.substring(0, 100)}`);

    const parts = reply.split("|").map(p => p.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1500));
      await sendMessage(phone, parts[i]);
    }

  } catch (err) {
    console.error("❌ Error:", err?.response?.data || err.message);
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    agent:   "Beauty Box AI Agent ✅",
    trigger: "Meta lead form messages only",
    claude:  ANTHROPIC_API_KEY ? "Connected ✅" : "Missing ❌",
    wapi:    WAPI_VENDOR_UID   ? "Connected ✅" : "Missing ❌",
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Beauty Box Agent running on port ${PORT}`);
  console.log(`🎯 Trigger: Meta lead form messages only`);
  console.log(`🤖 Claude:     ${ANTHROPIC_API_KEY ? "✅" : "❌ MISSING"}`);
  console.log(`📱 WAPI UID:   ${WAPI_VENDOR_UID  ? "✅" : "❌ MISSING"}`);
  console.log(`🔐 WAPI Token: ${WAPI_TOKEN       ? "✅" : "❌ MISSING"}\n`);
});
