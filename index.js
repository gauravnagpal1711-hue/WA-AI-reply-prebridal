// ============================================================
//  Beauty Box AI Agent — v5
//  Short msgs + Human tone + PDF as WhatsApp attachment
// ============================================================

const express = require("express");
const axios   = require("axios");
const path    = require("path");
const app     = express();
app.use(express.json());

// Serve PDF as static file from /public folder
// brochure.pdf must be in the same folder as index.js
app.use(express.static(path.join(__dirname)));

const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID   = process.env.WAPI_VENDOR_UID   || process.env.WAPI_INSTANCE_ID || "";
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";

// Railway gives your app a public URL — set this in Railway Variables
// Example: https://wa-ai-reply-prebridal.up.railway.app
const APP_URL  = (process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : process.env.APP_URL || "").replace(/\/$/, "");

const PDF_NAME = "Beauty Box Pre-Bridal Package.pdf";

// Full public URL of the PDF (auto-built from Railway domain)
function getPdfUrl() {
  if (!APP_URL) return null;
  return `${APP_URL}/brochure.pdf`;
}

// ── META LEAD TRIGGER ─────────────────────────────────────────
const META_TRIGGER   = "i filled in your form and would like to know more about your business";
const MANUAL_TRIGGER = "#start"; // Secret keyword — type this in wapi.in.net inbox to activate bot for any lead

function isMetaLead(text) {
  return text.toLowerCase().includes(META_TRIGGER);
}
function isManualTrigger(text) {
  return text.trim().toLowerCase() === MANUAL_TRIGGER;
}

// ── EXTRACT LEAD DETAILS ──────────────────────────────────────
function extractLeadDetails(text) {
  const d = {};
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const low = line.toLowerCase();
    // Handle both "key: value" and "key:value" formats
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = low.substring(0, colonIdx).trim();
    const val = line.substring(colonIdx + 1).trim();

    if (key === "full_name" || key === "name")                          d.name    = val;
    if (key === "when_is_your_wedding_date" || key === "wedding_date")  d.wedding = val;
    if (key === "city/area" || key === "city" || key === "area")        d.city    = val;
    if (key === "phone_number")                                          d.leadPhone = val;
  }
  console.log(`🎯 Extracted lead:`, JSON.stringify(d));
  return d;
}

// ── CONVERSATION MEMORY ───────────────────────────────────────
const conversations    = new Map();
const lastSentMessage  = new Map(); // Fix 3: track last sent per phone for dedup
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
const SYSTEM_PROMPT = `You are a team member at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi (near Janakpuri West Metro).

You chat with brides who filled our Instagram/Facebook ad form for Pre-Bridal package.

CRITICAL RULES:
1. MAX 1-2 lines per message. Never longer.
2. You are HUMAN. Never introduce yourself or your role unless directly asked. Just reply naturally.
3. Natural Hinglish — casual, like a real Delhi girl texting.
4. Always end with ONE short question.
5. Use | to send multiple separate short messages.
6. Use emojis very sparingly — max 1 emoji per 2-3 messages. Most messages NO emoji.
7. NEVER send all information at once. Share gradually as conversation flows.

CONVERSATION FLOW — follow this order strictly:
Step 1: Greet by first name, ask wedding date (if not known) + which area/city they are from — in ONE message
Step 2: Ask skin type — dry, oily, normal or combination
Step 3: Share 2-3 relevant skin tips based on their skin type (builds trust)
Step 4: Naturally mention the package — "I'll share our package details"
Step 5: Move toward Path A or Path B

DO NOT send brochure, services list, or price upfront. Share only when customer asks OR when conversation reaches Step 4+.

WHEN CUSTOMER ASKS "what services are included" or "kya kya hoga":
Send this EXACT formatted message (use *bold* formatting):

*Pre-Bridal Package — 12 Services in 3 Sittings*

*1. O3+ Facial* — 2 sittings
Deep oxygenating, removes dead cells, reveals radiant skin

*2. Bleach / D-Tan* — 2 sittings
Removes tan, dark patches, evens skin tone

*3. Full Body Bleach*
Lightens dark spots on arms, legs & back

*4. Full Body Wax*
Head to toe hair removal for silky smooth skin

*5. Full Body Polishing*
Deep exfoliation, moisturises & wedding glow

*6. L'Oréal Hair Spa*
Repairs damage, adds shine & controls frizz

*7. Manicure*
Shapes, buffs & nourishes hands & nails

*8. Pedicure*
Softens feet, revives nail health

*9. Nail Extension*
Beautiful nail extensions for your big day

*10. Face Bleach* — in 3rd sitting
*11. Threading & Upper Lips*
*12. O3+ Facial* — repeat in 3rd sitting

All this in just *Rs.7,499* — limited slots only.

WHEN CUSTOMER ASKS about price or "kitna hai":
Send this message:

*Why Pay More? See the Difference*

Service | Market Rate
O3+ Facial x2 | Rs.5,000
Bleach/D-Tan x2 | Rs.700
Full Body Bleach | Rs.2,000
Manicure + Pedicure | Rs.1,000
Loreal Hair Spa | Rs.1,000
Full Body Wax | Rs.2,500
Full Body Polishing | Rs.3,000
Nail Extension | Rs.1,500
Threading + Upper Lips | Rs.200
*Total 12 services | Rs.16,800*

*Our Package Price: Rs.7,499 only*
*You Save: Rs.12,001 — 71% OFF*

PATH A (ready to book):
"Ek small advance se slot pakka ho jaata hai. Kya abhi confirm karogi?"
If YES → "Garima ma'am aapko abhi QR share karengi."

PATH B (hesitant):
"Ek baar studio aao — Garima ma'am skin check karengi, koi pressure nahi.|Kab aa sakti ho?"
If agrees → "Garima ma'am se timing confirm ho jaegi."

WHEN TO SEND PDF LINK:
Only send the brochure link when customer is clearly interested and asks for more details or wants to share with family. Say: "Please download complete Pre-Bridal Package details in brochure, Link: [send PDF link]"

DISTANCE HANDLING:
Step 1: "Metro se [X] min hi hai, aur sirf 2-3 visits chahiye poore package mein."
Step 2: "Rs.16,800 ki services sirf Rs.7,499 mein — 71% off. Itna deal kahin nahi milega."
Step 3 (still hesitant): "No worries! Nearby salons bhi dekh sakti ho. Best of luck for your wedding!"

METRO TIMES:
- Dwarka: 15 min Pink Line
- Connaught Place: 25 min Yellow Line
- South Delhi/South Ex: 35 min Yellow Line
- Shahdara/East Delhi: 53 min Pink Line via Pitampura
- Noida: 50 min Blue to Rajiv Chowk then Yellow Line

STUDIO: Vikaspuri Delhi, near Janakpuri West Metro
Maps: https://share.google/Wg5sfGr9GyYiNuzGB
Insta: https://www.instagram.com/garimanagpalmua/

PACKAGE TIMING:
- 3+ months away: skin care start now, facials now, full package 30-35 days before
- 1-2 months: perfect timing, 2-3 sittings
- Within 40 days: 3 sittings possible
- Engagement coming: suggest starting earlier

SKINCARE TIPS (share 2-3 based on skin type, keep very short):
Dry skin: Raat ko raw milk lagao face pe | Hafte mein ek baar besan+curd+haldi face pack karo
Oily skin: Roz subah rose water se face saaf karo | Avoid fried and sugary food
Normal skin: Warm water+lemon+honey subah khali pet | Turmeric milk raat ko
For hair: Hafte mein 2 baar coconut+castor oil massage karo
For dark circles: Raat ko almond oil aankho ke neeche lagao

RULES:
- Price asked → share price table
- Services asked → share full services list
- Discount extra → "Garima ma'am se baat karein"
- Slot timing → "Garima ma'am confirm karengi"
- QR code → NEVER send, Garima sends manually
- If asked "Are you AI" → "Nahi, main ek real person hoon. Batao kya jaanna hai."
- If you do not understand a message → Do NOT say you don't understand. Just move forward naturally with the next relevant question.
- If wedding is 2+ months away → Don't push for booking. Say: "Abhi time hai, soch ke batao. Aap kab free hongi baat karne ke liye?"
- If someone asks about bridal makeup looks → "Garima ma'am ka kaam yahan dekho: https://www.instagram.com/garimanagpalmua/"
- If someone asks about combined package (bridal makeup + pre-bridal together) → "Bilkul ho sakta hai! Aapko Garima ma'am se directly baat karni chahiye. Kaunsa time suit karta hai call ke liye?"`;
// Note: Never introduce yourself proactively — only if asked

// ── SEND TEXT ─────────────────────────────────────────────────
async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, {
      phone_number: toPhone,
      message_body: text,
      message_type: "text",
    });
    console.log(`✅ Text → ${toPhone}: "${text.substring(0, 50)}"`);
  } catch (err) {
    console.error(`❌ Text failed:`, err?.response?.data || err.message);
  }
}

// ── SEND PDF AS SHORT LINK ───────────────────────────────────
async function sendPDF(toPhone) {
  const pdfUrl = "https://raw.githubusercontent.com/gauravnagpal1711-hue/WA-AI-reply-prebridal/main/Brochure.pdf";
  try {
    const res  = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(pdfUrl)}`);
    const link = res.data?.trim() || pdfUrl;
    await sendText(toPhone, `Please download complete Pre-Bridal Package details in brochure, Link: ${link}`);
    console.log(`✅ PDF link sent: ${link}`);
  } catch (err) {
    await sendText(toPhone, `Please download complete Pre-Bridal Package details in brochure, Link: ${pdfUrl}`);
    console.log(`⚠️ TinyURL failed, sent raw link`);
  }
}

// ── CALL CLAUDE ───────────────────────────────────────────────
async function getAIReply(phone, contextMsg) {
  addToHistory(phone, "user", contextMsg);
  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model:      "claude-sonnet-4-20250514",
      max_tokens: 300,
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

// ── PARSE WEBHOOK ─────────────────────────────────────────────
function parseWebhook(body) {
  try {
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg      = messages[0];
      const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts || [];
      const type     = msg?.type || "";
      return {
        phone:    msg?.from || "",
        name:     contacts[0]?.profile?.name || null,
        text:     msg?.text?.body || "",
        hasMedia: ["image","audio","video","document","sticker"].includes(type),
      };
    }
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
  } catch (e) { return null; }
}

// ── WEBHOOK ───────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return;

    const { phone, name, text, hasMedia } = parsed;
    console.log(`📩 ${phone} | "${text.substring(0,80)}"`);

    // Skip empty messages and delivery receipts
    if (!text && !hasMedia) { console.log("⏭️ Empty message skipped"); return; }
    if (text && text.trim() === "") { console.log("⏭️ Blank text skipped"); return; }

    const isNewLead  = isMetaLead(text);
    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;

    const isManual = isManualTrigger(text);

    // Only respond to: (1) Meta lead form, (2) existing conversations, (3) manual #start trigger
    if (!isNewLead && !hasHistory && !isManual) {
      console.log(`⏭️ Ignored — not a lead: ${phone}`);
      return;
    }

    // If you typed #start — don't reply to yourself, send opening to customer instead
    if (isManual) {
      console.log(`🚀 MANUAL TRIGGER by studio for: ${phone}`);
      const firstName = name ? name.split(" ")[0] : "";
      const openingMsg = firstName
        ? `Hi ${firstName}! Shaadi kab hai aur kahan se ho?`
        : `Hi! Shaadi kab hai aur kahan se ho?`;
      await new Promise(r => setTimeout(r, 2000));
      await sendText(phone, openingMsg);
      // Seed conversation history so bot continues naturally
      addToHistory(phone, "assistant", openingMsg);
      return;
    }

    let contextMsg = text;

    if (isNewLead) {
      const lead = extractLeadDetails(text);
      console.log(`🎯 META LEAD: ${lead.name} | ${lead.wedding} | ${lead.city}`);
      contextMsg = `New lead from Meta ad:
Customer first name: ${lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "")}
Wedding date: ${lead.wedding || "not mentioned"}
City/Area: ${lead.city || "not mentioned"}

INSTRUCTION: Send ONE short warm greeting using their first name only. Ask wedding date and area in one casual line. Do NOT introduce yourself or mention brochure.`;
    }

    const reply = await getAIReply(phone, contextMsg);

    // Fix 2: Max 3 messages at a time
    const parts = reply.split("|").map(p => p.trim()).filter(Boolean).slice(0, 3);

    // Fix 1: 5-6 second human-like delay before first reply
    await new Promise(r => setTimeout(r, 5500));

    // Fix 3: Dedup — don't send same message twice in a row
    const lastSent = lastSentMessage.get(phone) || "";
    for (let i = 0; i < parts.length; i++) {
      const msg = parts[i];
      if (msg === lastSent && i === 0) {
        console.log(`⏭️ Duplicate message skipped: "${msg.substring(0,40)}"`);
        continue;
      }
      if (i > 0) await new Promise(r => setTimeout(r, 1800));
      await sendText(phone, msg);
      lastSentMessage.set(phone, msg);
    }
  } catch (err) {
    console.error("❌", err?.response?.data || err.message);
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    agent:  "Beauty Box AI Agent v5 ✅",
    pdfUrl: getPdfUrl() || "⚠️ Set RAILWAY_PUBLIC_DOMAIN or APP_URL",
    claude: ANTHROPIC_API_KEY ? "✅" : "❌",
    wapi:   WAPI_VENDOR_UID   ? "✅" : "❌",
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Beauty Box Agent v5 — port ${PORT}`);
  console.log(`📄 PDF URL: ${getPdfUrl() || "⚠️ APP_URL not set"}`);
  console.log(`🤖 Claude: ${ANTHROPIC_API_KEY ? "✅" : "❌ MISSING"}`);
  console.log(`📱 WAPI:   ${WAPI_VENDOR_UID  ? "✅" : "❌ MISSING"}\n`);
});
