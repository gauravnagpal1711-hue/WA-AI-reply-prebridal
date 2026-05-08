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
const META_TRIGGER = "i filled in your form and would like to know more about your business";
function isMetaLead(text) {
  return text.toLowerCase().includes(META_TRIGGER);
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
const SYSTEM_PROMPT = `You are a team member at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi (near Janakpuri West Metro).

You chat with brides who filled our Instagram/Facebook ad form for Pre-Bridal package.

CRITICAL RULES:
1. MAX 1-2 lines per message. Never longer. No exceptions.
2. You are HUMAN. Never say you are AI or bot. If asked directly, say "Main Garima ma'am ki team se hoon 🥰"
3. Natural Hinglish — casual, like a real Delhi girl texting
4. Always end with exactly ONE short question
5. Use | to send multiple separate short messages
6. No bullet points, no long lists, no formal language

PACKAGE DETAILS:
- Offer price: Rs.7,499 (actual market value Rs.16,800 — 71% OFF!)
- 12 services in 3 sittings
- Sitting 1: O3+ Facial + Bleach/D-Tan
- Sitting 2: Full Body Bleach + Manicure + Pedicure + Loreal Hair Spa
- Sitting 3: Full Body Wax + Body Polishing + Nail Extension + Face Bleach + O3+ Facial + Threading
- Start 30-35 days before wedding, every 10-15 days gap
- Limited slots only

FIRST MESSAGE: Greet by name, tell them brochure has been shared (PDF is sent automatically before your message). Then ask wedding date + city in one line.

CONVERSATION FLOW:
1. Greet with name, mention brochure shared, ask wedding date + city
2. Ask skin type — one line only
3. Share max 1-2 quick skin tips
4. Move to Path A or Path B

PATH A (she seems ready/interested):
"Ek small advance se slot pakka ho jaata hai 🥰 Kya abhi confirm karogi?"
If YES → "Perfect! Garima ma'am aapko abhi QR share karengi 🥰"

PATH B (hesitant/questions):
"Ek baar studio aao — Garima ma'am personally skin check karengi, koi pressure nahi 🥰|Kab aa sakti ho?"
If agrees → "Bahut accha! Garima ma'am se timing confirm ho jaegi 🥰"

DISTANCE:
Step 1: "Metro se [X] min hi hai, aur sirf 2-3 visits chahiye 🥰"
Step 2: "Rs.16,800 ki services sirf Rs.7,499 mein — 71% off! Itna deal kahin nahi 🥰"
Step 3 (still no): "No worries! Nearby salons bhi dekh sakti ho 🥰 Best of luck!"

METRO TIMES:
- Dwarka: 15 min Pink Line
- Connaught Place: 25 min Yellow Line
- South Delhi/South Ex: 35 min Yellow Line
- Shahdara/East Delhi: 53 min Pink Line via Pitampura
- Noida: 50 min Blue→Rajiv Chowk→Yellow Line

STUDIO: Vikaspuri Delhi, near Janakpuri West Metro
Maps: https://share.google/Wg5sfGr9GyYiNuzGB
Insta: https://www.instagram.com/garimanagpalmua/

QUICK TIPS (share max 2, very short):
- Glow: Roz raat raw milk ya rose water lagao
- Hair: Hafte mein 2 baar coconut+castor oil massage
- Dark circles: Raat ko almond oil aankho ke neeche
- General: Garam paani+lemon+honey subah, 2-3L paani daily

RULES:
- Price asked → Rs.7,499 confidently, explain 71% off
- Extra discount → "Garima ma'am se baat karein 🥰"
- Slot timing → "Garima ma'am confirm karengi 🥰"
- QR code → NEVER send, Garima sends manually`;

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

// ── SEND PDF AS ATTACHMENT ────────────────────────────────────
async function sendPDF(toPhone) {
  const pdfUrl = "https://raw.githubusercontent.com/gauravnagpal1711-hue/WA-AI-reply-prebridal/main/Brochure.pdf";
  const apiUrl = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
  console.log(`📄 Sending PDF to ${toPhone}`);

  // Step 1: Download PDF and convert to base64
  try {
    console.log(`📥 Downloading PDF for base64...`);
    const pdfResp = await axios.get(pdfUrl, { responseType: "arraybuffer" });
    const base64  = Buffer.from(pdfResp.data).toString("base64");
    console.log(`📦 PDF size: ${pdfResp.data.byteLength} bytes`);

    // Try base64 Format 1: document_base64
    try {
      const res = await axios.post(apiUrl, {
        phone_number:    toPhone,
        message_type:    "document",
        message_body:    PDF_NAME,
        document_base64: base64,
        document_name:   PDF_NAME,
        mimetype:        "application/pdf",
      });
      console.log(`✅ Base64 F1:`, JSON.stringify(res.data));
      if (res.data?.result === "success" && !res.data?.message?.includes("processed")) return;
    } catch (e) {
      console.log(`❌ Base64 F1:`, JSON.stringify(e?.response?.data || e.message));
    }

    // Try base64 Format 2: media_data
    try {
      const res = await axios.post(apiUrl, {
        phone_number: toPhone,
        message_type: "document",
        message_body: PDF_NAME,
        media_data:   base64,
        filename:     PDF_NAME,
        mimetype:     "application/pdf",
      });
      console.log(`✅ Base64 F2:`, JSON.stringify(res.data));
      if (res.data?.result === "success" && !res.data?.message?.includes("processed")) return;
    } catch (e) {
      console.log(`❌ Base64 F2:`, JSON.stringify(e?.response?.data || e.message));
    }

    // Try base64 Format 3: file_data
    try {
      const res = await axios.post(apiUrl, {
        phone_number: toPhone,
        message_type: "document",
        message_body: PDF_NAME,
        file_data:    base64,
        file_name:    PDF_NAME,
        mime_type:    "application/pdf",
      });
      console.log(`✅ Base64 F3:`, JSON.stringify(res.data));
      if (res.data?.result === "success" && !res.data?.message?.includes("processed")) return;
    } catch (e) {
      console.log(`❌ Base64 F3:`, JSON.stringify(e?.response?.data || e.message));
    }

  } catch (downloadErr) {
    console.log(`❌ PDF download failed:`, downloadErr.message);
  }

  // Final conclusion
  console.log(`⚠️ wapi.in.net does not support PDF attachment via API — PDF feature not available`);
  console.log(`💡 To send PDF: Use wapi.in.net chat inbox manually for each lead`);
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

    if (!isNewLead && !hasHistory) {
      console.log(`⏭️ Ignored — not a lead: ${phone}`);
      return;
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please 🥰");
      return;
    }

    let contextMsg = text;
    if (isNewLead) {
      const lead = extractLeadDetails(text);
      console.log(`🎯 LEAD: ${lead.name} | ${lead.wedding} | ${lead.city}`);
      contextMsg = `New lead:
Name: ${lead.name || name || "not given"}
Wedding: ${lead.wedding || "not given"}
City: ${lead.city || "not given"}
Greet by name, mention brochure shared.`;

      // Send PDF attachment first
      await sendPDF(phone);
      await new Promise(r => setTimeout(r, 1500));
    }

    const reply = await getAIReply(phone, contextMsg);
    const parts  = reply.split("|").map(p => p.trim()).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 1200));
      await sendText(phone, parts[i]);
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
