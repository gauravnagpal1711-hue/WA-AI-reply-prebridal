const express = require("express");
const axios   = require("axios");
const path    = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── PHONE NUMBER NORMALIZATION ────────────────────────────────
function normalizePhone(phone) {
  // Remove all non-digits and return full clean number
  return (phone || "").replace(/\D/g, "");
}

const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID   = process.env.WAPI_VENDOR_UID   || "";
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";
const ADMIN_KEY         = process.env.ADMIN_KEY         || "beautybox2024";
const SHEET_ID          = process.env.SHEET_ID          || "";
const ADMIN_PHONE       = "919560277217";
const GARIMA_PHONE      = "919354260517";

// ── GOOGLE SHEETS SETUP ───────────────────────────────────────
let sheetsClient = null;
async function initSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS || !SHEET_ID) {
      console.log("⚠️ Google Sheets disabled — credentials or SHEET_ID missing");
      return;
    }
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth  = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    console.log("📊 Google Sheets connected ✅");
    await ensureHeaders();
  } catch (err) {
    console.error("❌ Sheets init failed:", err.message);
  }
}

async function ensureHeaders() {
  try {
    const activeHeaders = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Status", "Last Message", "First Seen", "Last Updated", "Service Path", "Bot Intervention"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A1:K1",
      valueInputOption: "RAW",
      resource: { values: [activeHeaders] },
    });
    const followupHeaders = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Template Sent", "Sent Date", "Notes"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Followup!A1:H1",
      valueInputOption: "RAW",
      resource: { values: [followupHeaders] },
    });
    console.log("📋 Sheet headers verified");
  } catch (err) {
    console.log("⚠️ Header setup skipped:", err.message);
  }
}

// ── GET CUSTOMER DATA FROM SHEETS ──────────────────────────────
async function getCustomerData(phone) {
  if (!sheetsClient) return null;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return null;
    
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
    });
    const current = res.data.values?.[0];
    if (!current) return null;
    
    return {
      phone: current[0] || "",
      name: current[1] || "",
      wedding: current[2] || "",
      city: current[3] || "",
      source: current[4] || "",
      status: current[5] || "",
      lastMessage: current[6] || "",
      servicePath: current[9] || "",
      botIntervention: current[10] || "YES",
    };
  } catch (err) {
    console.error("getCustomerData error:", err.message);
    return null;
  }
}

// ── SHEET HELPERS ─────────────────────────────────────────────
function nowIST() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

async function findRow(sheetName, phone) {
  if (!sheetsClient) return -1;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:A`,
    });
    const rows = res.data.values || [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] && rows[i][0].toString().replace(/\D/g, "").endsWith(phone.replace(/\D/g, ""))) {
        return i + 1;
      }
    }
    return -1;
  } catch (err) {
    console.error("findRow error:", err.message);
    return -1;
  }
}

async function addActiveLead(phone, name, wedding, city, source, status, lastMsg) {
  if (!sheetsClient) return;
  try {
    const existing = await findRow("Active Leads", phone);
    if (existing > 0) {
      await updateActiveLead(phone, { status, lastMsg, name, wedding, city });
      return;
    }
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A:K",
      valueInputOption: "RAW",
      resource: {
        values: [[
          phone, name || "", wedding || "", city || "", source || "",
          status || "🆕 New Lead",
          (lastMsg || "").substring(0, 200),
          nowIST(), nowIST(),
          "",
          "YES",
        ]],
      },
    });
    console.log(`📊 Added to Active Leads: ${phone}`);
  } catch (err) {
    console.error("addActiveLead error:", err.message);
  }
}

async function updateActiveLead(phone, updates) {
  if (!sheetsClient) return;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return;
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
    });
    const current = res.data.values?.[0] || ["", "", "", "", "", "", "", "", "", "", ""];
    const updated = [
      current[0] || phone,
      updates.name    || current[1] || "",
      updates.wedding || current[2] || "",
      updates.city    || current[3] || "",
      current[4] || "",
      updates.status  || current[5] || "💬 Conversation Started",
      (updates.lastMsg || current[6] || "").substring(0, 200),
      current[7] || nowIST(),
      nowIST(),
      updates.servicePath || current[9] || "",
      updates.botIntervention || current[10] || "YES",
    ];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
      valueInputOption: "RAW",
      resource: { values: [updated] },
    });
  } catch (err) {
    console.error("updateActiveLead error:", err.message);
  }
}

async function isInFollowupSent(phone) {
  if (!sheetsClient) return null;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Followup!A:H",
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;
      const rowPhone = row[0].toString().replace(/\D/g, "");
      const matchPhone = phone.replace(/\D/g, "");
      const status = (row[5] || "").toString().toLowerCase();
      if (rowPhone.endsWith(matchPhone) && (status === "sent" || status === "pending")) {
        return {
          rowNum: i + 1,
          phone: row[0],
          name: row[1] || "",
          wedding: row[2] || "",
          city: row[3] || "",
          source: row[4] || "Followup",
        };
      }
    }
    return null;
  } catch (err) {
    console.error("isInFollowupSent error:", err.message);
    return null;
  }
}

async function markFollowupReplied(phone) {
  if (!sheetsClient) return;
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Followup!A:F",
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      const rowPhone = rows[i][0].toString().replace(/\D/g, "");
      if (rowPhone.endsWith(phone.replace(/\D/g, ""))) {
        await sheetsClient.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `Followup!F${i + 1}`,
          valueInputOption: "RAW",
          resource: { values: [["Replied"]] },
        });
        console.log(`📊 Marked Followup as Replied: ${phone}`);
        return;
      }
    }
  } catch (err) {
    console.error("markFollowupReplied error:", err.message);
  }
}

// ── STATUS DETECTION ──────────────────────────────────────────
function detectStatus(aiReply, customerMsg) {
  const reply = (aiReply || "").toLowerCase();
  const msg   = (customerMsg || "").toLowerCase();

  if (reply.includes("garima ma'am aapko") && reply.includes("qr")) return "💳 Advance Pending";
  if (reply.includes("garima ma'am se timing confirm")) return "🏠 Studio Visit Scheduled";
  if (reply.includes("pre-bridal package — 12 services")) return "📋 Package Shared";
  if (reply.includes("why pay more")) return "💰 Price Shared";
  if (reply.includes("combo price") && reply.includes("16,500")) return "💑 Combo Interest";
  if (reply.includes("hydra facial package")) return "💧 Hydra Interest";
  if (reply.includes("family se baat kar lijiye") || reply.includes("mummy ko dikhayein")) return "👨‍👩‍👧 Awaiting Family OK";
  if (reply.includes("abhi time hai") && reply.includes("skincare")) return "🌱 Nurture - Far Wedding";
  if (reply.includes("₹499") && reply.includes("nail")) return "💅 Nail Service Interest";

  if (msg.includes("nahi chahiye") || msg.includes("not interested") || msg.includes("don't want")) return "❌ Not Interested";
  if (msg.includes("yes") || msg.includes("confirm") || msg.includes("book")) return "✅ Interested";

  return null;
}

// ── META & AD TRIGGERS ────────────────────────────────────────
const META_TRIGGER  = "i filled in your form and would like to know more about your business";
const AD_DM_TRIGGER = "hello! can i get more info on this";

function isMetaLead(text) {
  const lower = text.toLowerCase().trim();
  return lower.includes(META_TRIGGER) || lower.includes(AD_DM_TRIGGER);
}
function isAdDM(text) {
  return text.toLowerCase().trim().includes(AD_DM_TRIGGER);
}

function extractLeadDetails(text) {
  const d = {};
  for (const line of text.split("\n").map(l => l.trim())) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).toLowerCase().trim();
    const val = line.substring(colonIdx + 1).trim();
    if (key === "full_name" || key === "name")                                       d.name    = val;
    if (key === "when_is_your_wedding_date" || key === "when_is_your_wedding_date?") d.wedding = val;
    if (key === "city/area" || key === "city" || key === "area")                     d.city    = val;
  }
  return d;
}

// ── WEDDING DATE EXTRACTOR FROM CHAT ─────────────────────────
function extractWeddingDateFromChat(text) {
  const months = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";
  const patterns = [
    new RegExp(`(\\d{1,2})\\s*(st|nd|rd|th)?\\s*(${months})\\s*(\\d{2,4})?`, "i"),
    new RegExp(`(${months})\\s+(\\d{1,2})(\\s*(\\d{2,4}))?`, "i"),
    /(\d{1,2})[\/\-](\d{1,2})([\/\-](\d{2,4}))?/,
    new RegExp(`(${months})\\s*(mein|ko|tak|me)?`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}

// ── LOCATION EXTRACTOR FROM CHAT ─────────────────────────────
function extractLocationFromChat(text) {
  const locations = [
    "Dwarka", "Noida", "Janakpuri", "Vikaspuri", "Uttam Nagar", "Rajouri Garden",
    "Greater Noida", "Gurgaon", "Gurugram", "Faridabad", "Delhi", "West Delhi",
    "South Delhi", "North Delhi", "East Delhi", "Central Delhi", "New Delhi",
    "Connaught Place", "CP", "Shahdara", "Pitampura", "Defence Colony",
    "Green Park", "Karol Bagh", "Rohini", "Malviya Nagar", "Sector", "Crossing",
    "Sector 104", "Sector 105", "Sector 110", "Sector 126"
  ];
  
  const lowerText = text.toLowerCase();
  for (const location of locations) {
    if (lowerText.includes(location.toLowerCase())) {
      return location;
    }
  }
  return null;
}

// ── CONVERSATION MEMORY ───────────────────────────────────────
const conversations      = new Map();
const lastSentMessage    = new Map();
const lastMessageTime    = new Map();
const nudgeSent          = new Map();
const pendingMenuSelect  = new Set();
const customerPath       = new Map();
const manualOnlyChats    = new Set();
const adminInstructions  = [];
let   adminTrainerActive = false;

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  const h = conversations.get(phone);
  // Keep only last 5 messages (was 10) to reduce token usage
  if (h.length > 5) {
    return h.slice(-5);
  }
  return h;
}
function addToHistory(phone, role, content) {
  // Check for repetition - don't add if same message just sent
  const h = getHistory(phone);
  if (h.length > 0 && h[h.length - 1].role === role && h[h.length - 1].content === content) {
    return;
  }
  const fullHistory = conversations.get(phone) || [];
  fullHistory.push({ role, content });
  if (fullHistory.length > 5) fullHistory.splice(0, fullHistory.length - 5);
  conversations.set(phone, fullHistory);
}

// ── MENU SYSTEM ───────────────────────────────────────────────
const MENU_BODY = `Welcome to *Beauty Box Makeup Studio* 💄

Aap kaunsi service ke baare mein jaanna chahti hain? Ek option choose karein 👇`;

const MENU_TEXT_FALLBACK = `Welcome to *Beauty Box Makeup Studio* 💄

Aap kaunsi service ke baare mein jaanna chahti hain?

*A* — Beauty and Hair Services
*B* — Hydra Package
*C* — Pre-Bridal Package
*D* — Pre Bridal+ Bridal Makeup Combo
*E* — Nail Services

Reply A, B, C, D ya E karein`;

async function sendMenuButtons(toPhone) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    const payload = {
      phone_number: toPhone,
      message_type: "interactive",
      interactive: {
        type: "list",
        body: { text: MENU_BODY },
        action: {
          button: "Choose Service",
          sections: [{
            title: "Beauty Box Services",
            rows: [
              { id: "A", title: "Beauty and Hair Services", description: "Waxing, facials, hair care" },
              { id: "B", title: "Hydra Package",         description: "Deep hydration facials" },
              { id: "C", title: "Pre-Bridal Package",    description: "12 services, 3 sittings" },
              { id: "D", title: "Pre Bridal+ Bridal Makeup", description: "Complete bridal combo" },
              { id: "E", title: "Nail Services",         description: "₹499 launch offer" }
            ]
          }]
        }
      }
    };
    const res = await axios.post(url, payload);
    console.log(`📋 Interactive menu sent to ${toPhone}`);
    return res.data;
  } catch (err) {
    console.error(`⚠️ Interactive menu failed, using text fallback:`, err?.response?.data?.message || err.message);
    await sendText(toPhone, MENU_TEXT_FALLBACK);
  }
}

function detectMenuSelection(text) {
  const t = (text || "").trim().toLowerCase();
  if (t === "a" || t === "1" || t.includes("beauty") || t.includes("hair") || t.includes("wax")) return "A";
  if (t === "b" || t === "2" || t.includes("hydra")) return "B";
  if (t === "c" || t === "3" || t.includes("pre-bridal") || t.includes("pre bridal")) return "C";
  if (t === "d" || t === "4" || (t.includes("bridal") && t.includes("makeup")) || t.includes("combo")) return "D";
  if (t === "e" || t === "5" || t.includes("nail")) return "E";
  return null;
}

function buildPathContext(selectedPath, customerName, wedding, city, customerMsg) {
  const name = customerName || "not given";
  switch (selectedPath) {
    case "A":
      return `Customer selected: Beauty and Hair Services.
Name: ${name}, Wedding: ${wedding || "not mentioned"}, City: ${city || "not mentioned"}
Customer message: "${customerMsg}"
INSTRUCTION: Ask which specific service - waxing, facial, hair care, etc. Share relevant price. Keep it short, 2-3 lines max.
Use polite English. Keep conversation natural and brief.`;

    case "B":
      return `Customer selected: Hydra Facial Package.
Name: ${name}
Customer message: "${customerMsg}"
INSTRUCTION: Ask skin concern (dryness, dullness, dark circles). Explain why Hydra helps. Share: Single Rs.999 / 3-Sitting Rs.2,799. Short message, 2-3 lines.`;

    case "C":
      return `Customer selected: Pre-Bridal Package.
Name: ${name}, Wedding: ${wedding || "not mentioned"}, City: ${city || "not mentioned"}
Customer message: "${customerMsg}"
INSTRUCTION: Ask wedding date if not known. Share package briefly. Close for booking. Short message, 2-3 lines.`;

    case "D":
      return `Customer selected: Pre-Bridal + Bridal Makeup Combo.
Name: ${name}, Wedding: ${wedding || "not mentioned"}, City: ${city || "not mentioned"}
Customer message: "${customerMsg}"
INSTRUCTION: Share combo pricing naturally. Ask when ready. Short, 2-3 lines. No repetition.`;

    case "E":
      return `Customer selected: Nail Services.
Name: ${name}
Customer message: "${customerMsg}"
INSTRUCTION: Ask nail service experience. Share offer: Rs.499. Ask location. Short, natural, 2-3 lines max.`;

    default:
      return `Customer message: "${customerMsg}". Name: ${name}. Respond naturally, short reply.`;
  }
}

// ── NUDGE SYSTEM ──────────────────────────────────────────────
const NUDGE_MESSAGES = [
  "Hi! Bas check kar rahi thi — koi sawaal tha kya? 😊",
  "Koi confusion ho package ke baare mein toh bata dijiye, help kar sakti hoon!",
  "Aapki shaadi ki tayaari kaisi chal rahi hai? Koi sawaal ho toh poochhiye 🌸",
];

function scheduleNudgeCheck() {
  setInterval(async () => {
    const now = Date.now();
    for (const [phone, lastTime] of lastMessageTime.entries()) {
      const hoursSince = (now - lastTime) / (1000 * 60 * 60);
      if (hoursSince >= 24 && !nudgeSent.get(phone)) {
        nudgeSent.set(phone, true);
        const nudge = NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)];
        await sendText(phone, nudge);
        addToHistory(phone, "assistant", nudge);
        console.log(`🔔 Nudge sent to ${phone}`);
      }
    }
  }, 30 * 60 * 1000);
}

// ── UPDATED SYSTEM PROMPT v2.5 - SHORT, EFFICIENT, NO REPETITION ──
const SYSTEM_PROMPT = `You are Radhya, a professional skin specialist at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi.

CRITICAL RULES (NON-NEGOTIABLE):

R1. MESSAGE LENGTH: ALWAYS keep messages to 2-3 lines MAXIMUM. No long paragraphs.

R2. NO REPETITION: Never ask a question you've asked before. Check history first.

R3. ONE MESSAGE = ONE POINT: Don't try to answer + ask + explain in one message. Pick one.

R4. ANSWER FIRST: If customer asks something, answer it FIRST before asking your next question.

TONE:
- Warm, natural, professional
- Short. Punchy. Direct.
- NO fake enthusiasm ("Amazing!", "Exciting!", "Wow!")
- NO scripted phrases
- Always end with a question or next step

═══════════════════════════════════════

PATH A — BEAUTY AND HAIR SERVICES
═══════════════════════════════════════
Ask: Which service - waxing, facial, hair care?
Then share relevant price from price list.
Close naturally.
Max: 2-3 lines.

═══════════════════════════════════════
PATH B — HYDRA FACIAL PACKAGE
═══════════════════════════════════════
Ask: Your main skin concern?
Explain: Why Hydra helps for THAT specific concern.
Share: Single Rs.999 / 3-Sitting Rs.2,799
Close: Garima ma'am confirm karengi.
Max: 2-3 lines per message.

═══════════════════════════════════════
PATH C — PRE-BRIDAL PACKAGE
═══════════════════════════════════════
Ask: Wedding date?
Share: 12 services in 3 sittings, Rs.7,499
Close: Book karna hai?
Max: 2-3 lines.

═══════════════════════════════════════
PATH D — PRE-BRIDAL + BRIDAL MAKEUP COMBO
═══════════════════════════════════════
Share: Combo Rs.16,500 (save Rs.1,999)
Ask: Wedding kab hai?
Close: Booking?
Max: 2-3 lines.

═══════════════════════════════════════
PATH E — NAIL SERVICES
═══════════════════════════════════════
Ask: Service experience?
Share: Rs.499 offer (normal Rs.1,200-1,500)
Ask: Location?
Close: Studio visit?
Max: 2-3 lines.

═══════════════════════════════════════
KEY PRICES (Reference Only)
═══════════════════════════════════════
Pre-Bridal: Rs.7,499
Bridal Makeup: Rs.11,000
Combo: Rs.16,500
Hydra Single: Rs.999
Hydra 3-Pack: Rs.2,799
Nail Services: Rs.499
Hair Spa: Rs.799
Facial (basic): Rs.549

═══════════════════════════════════════
METRO TIMES (Only if asked)
═══════════════════════════════════════
- Dwarka: 15 min
- CP: 25 min
- South Delhi: 35 min
Studio: Janakpuri West Metro, Vikaspuri

═══════════════════════════════════════
SPECIAL RESPONSES
═══════════════════════════════════════
Home visit: "Studio mein hi services dete hain. Aap aa sakte ho?"
Still thinking: "Bilkul, soch lo. Main yahan hoon jab decide karo 😊"
Other info: Short, natural answer. No over-explanation.

═══════════════════════════════════════
MOST IMPORTANT
═══════════════════════════════════════
- Keep it SHORT (2-3 lines)
- NO repetition
- Natural tone
- End with question
- Don't over-explain
- One idea per message`;

// ── SEND TEXT ─────────────────────────────────────────────────
async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    const res = await axios.post(url, { phone_number: toPhone, message_body: text, message_type: "text" });
    console.log(`✅ Sent to ${toPhone}: "${text.substring(0, 50)}"`);
    return res.data;
  } catch (err) {
    console.error(`❌ Send failed:`, err?.response?.data || err.message);
  }
}

// ── CALL CLAUDE ───────────────────────────────────────────────
async function getAIReply(phone, contextMsg) {
  addToHistory(phone, "user", contextMsg);
  const liveInstructions = adminInstructions.length > 0
    ? "\n\nLIVE INSTRUCTIONS FROM ADMIN:\n" + adminInstructions.map((ins, i) => (i+1) + ". " + ins).join("\n")
    : "";
  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      system: SYSTEM_PROMPT + liveInstructions,
      messages: getHistory(phone)
    },
    { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" } }
  );
  const reply = res.data.content?.[0]?.text || "Ek second.";
  addToHistory(phone, "assistant", reply);
  return reply;
}

// ── PARSE WEBHOOK ─────────────────────────────────────────────
function parseWebhook(body) {
  try {
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg = messages[0];
      const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts || [];
      const phone = msg?.from || "";
      const name = contacts[0]?.profile?.name || null;

      if (msg?.type === "interactive") {
        const interactive = msg.interactive;
        const selectedId    = interactive?.list_reply?.id    || interactive?.button_reply?.id    || "";
        const selectedTitle = interactive?.list_reply?.title || interactive?.button_reply?.title || "";
        return {
          phone,
          name,
          text: selectedId || selectedTitle,
          hasMedia: false,
          isInteractive: true,
          interactiveId: selectedId.toUpperCase(),
        };
      }

      return {
        phone,
        name,
        text: msg?.text?.body || "",
        hasMedia: ["image","audio","video","document","sticker"].includes(msg?.type),
        isInteractive: false,
      };
    }

    const phone2 = body?.contact?.phone_number || "";
    if (phone2) {
      return {
        phone: phone2,
        name: [body?.contact?.first_name, body?.contact?.last_name].filter(Boolean).join(" ") || null,
        text: body?.message?.body || "",
        hasMedia: !!body?.message?.media?.type,
        isInteractive: false,
      };
    }
    return null;
  } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// WEBHOOK DIAGNOSTIC ENDPOINTS - FOR TESTING GARIMA'S MESSAGES
// ═══════════════════════════════════════════════════════════════

// Diagnostic webhook to capture ALL webhook events
app.post("/webhook-diagnostic", async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    const fs = require('fs');
    const path = require('path');
    
    // Log the COMPLETE webhook body
    const logFile = path.join(__dirname, 'webhook-logs.json');
    const logEntry = {
      timestamp,
      body: req.body,
      headers: req.headers,
      type: "UNKNOWN"
    };

    // Try to identify message type
    try {
      const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
      if (messages?.length > 0) {
        const msg = messages[0];
        logEntry.type = `INFLOW - ${msg.type} message from customer`;
        logEntry.from = msg.from;
        logEntry.messageType = msg.type;
        logEntry.timestamp_msg = msg.timestamp;
      }

      const statuses = req.body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (statuses?.length > 0) {
        const status = statuses[0];
        logEntry.type = `STATUS UPDATE - Message sent/delivered/read`;
        logEntry.status = status.status;
        logEntry.messageId = status.id;
      }
    } catch (e) {
      logEntry.parseError = e.message;
    }

    // Append to log file
    try {
      let logs = [];
      if (fs.existsSync(logFile)) {
        const existing = fs.readFileSync(logFile, 'utf8');
        logs = JSON.parse(existing);
      }
      logs.push(logEntry);
      // Keep only last 100 entries
      if (logs.length > 100) logs = logs.slice(-100);
      fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
      console.log(`📋 [${timestamp}] Webhook logged: ${logEntry.type}`);
    } catch (err) {
      console.error("❌ Failed to write log:", err.message);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Diagnostic webhook error:", err);
    res.sendStatus(200);
  }
});

// View the diagnostic logs
app.get("/webhook-logs", (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, 'webhook-logs.json');

    if (!fs.existsSync(logFile)) {
      return res.json({ 
        message: "No logs yet. Test webhook by:",
        step1: "Point wapi.in.net webhook to: https://your-railway-url/webhook-diagnostic",
        step2: "Have customer send a message",
        step3: "Garima send a manual reply",
        step4: "Customer reply again",
        step5: "Check logs here"
      });
    }

    const logs = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    
    // Analyze the logs
    const analysis = {
      total: logs.length,
      inflow: logs.filter(l => l.type.includes("INFLOW")).length,
      status: logs.filter(l => l.type.includes("STATUS")).length,
      unknown: logs.filter(l => l.type.includes("UNKNOWN")).length,
      types: [...new Set(logs.map(l => l.type))],
      logs: logs
    };

    res.json(analysis);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Clear the diagnostic logs
app.post("/webhook-logs/clear", (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const logFile = path.join(__dirname, 'webhook-logs.json');
    
    if (fs.existsSync(logFile)) {
      fs.unlinkSync(logFile);
    }
    
    res.json({ message: "Logs cleared" });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// MAIN WEBHOOK ENDPOINT
// ═══════════════════════════════════════════════════════════════

app.post("/webhook", async (req, res) => {
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return;
    const { phone, name, text, hasMedia, isInteractive, interactiveId } = parsed;
    if (!text && !hasMedia) return;
    if (text && text.trim() === "") return;

    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.endsWith("9560277217")) {
      if (!text.toLowerCase().includes("radhya")) {
        console.log(`⏭️ Admin message ignored (no Radhya trigger): "${text.substring(0, 60)}"`);
        res.sendStatus(200);
        return;
      }
      if (!adminTrainerActive) {
        adminTrainerActive = true;
        console.log(`🔓 Admin trainer mode ACTIVATED`);
        await sendText(phone, `Trainer mode activated. Main sun rahi hoon Radhya ke roop mein. Instruction dijiye.`);
        return;
      }
      const instruction = text.replace(/radhya[,.]?\s*/i, "").trim();
      
      if (instruction.toLowerCase().includes("enable auto")) {
        const match = instruction.match(/(\d{10,})/);
        if (match) {
          const targetPhone = normalizePhone(match[1]);
          manualOnlyChats.delete(targetPhone);
          console.log(`🤖 AUTO MODE ENABLED for ${match[1]} (${targetPhone})`);
          await sendText(phone, `Auto mode enabled for ${match[1]}. Bot will now respond to their messages.`);
          return;
        }
      }

      if (instruction) {
        adminInstructions.push(instruction);
        if (adminInstructions.length > 5) adminInstructions.shift();
        console.log(`👨‍💼 ADMIN INSTRUCTION: "${instruction}"`);
        await sendText(phone, `Samajh gayi. Instruction noted: "${instruction.substring(0, 80)}"`);
      }
      return;
    }

    // ── PRIMARY CHECK: Google Sheet Bot Intervention Column ────────────────
    const customerData = await getCustomerData(phone);
    const isNewLead = isMetaLead(text);

    // If customer NOT in Google Sheet AND not a new lead (meta form) → ignore
    if (!customerData && !isNewLead) {
      console.log(`⏭️ IGNORED: ${phone} - Not in sheet, not a new lead`);
      res.sendStatus(200);
      return;
    }

    // If customer IS in Google Sheet, check Bot Intervention column
    if (customerData) {
      const botIntervention = customerData.botIntervention || "YES";
      
      if (botIntervention === "YES") {
        console.log(`📝 BOT INTERVENTION = YES: ${phone} — You're handling, bot will not respond.`);
        await addToHistory(phone, "user", text);
        const extractedDate = extractWeddingDateFromChat(text);
        const extractedLocation = extractLocationFromChat(text);
        
        const updates = { lastMsg: text };
        if (extractedDate) {
          updates.wedding = extractedDate;
          console.log(`📅 Wedding date extracted: "${extractedDate}" for ${phone}`);
        }
        if (extractedLocation) {
          updates.city = extractedLocation;
          console.log(`📍 Location extracted: "${extractedLocation}" for ${phone}`);
        }
        await updateActiveLead(phone, updates);
        res.sendStatus(200);
        return;
      }
      
      // Bot Intervention = "NO" → Bot can reply
      console.log(`✅ BOT INTERVENTION = NO: ${phone} — Bot can reply`);
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return;
    }

    lastMessageTime.set(phone, Date.now());
    nudgeSent.set(phone, false);

    const normalizedPhone = normalizePhone(phone);
    if (manualOnlyChats.has(normalizedPhone)) {
      console.log(`📝 MANUAL MODE (Legacy): ${phone} → ${normalizedPhone} — bot will not respond.`);
      await addToHistory(phone, "user", text);
      const extractedDate = extractWeddingDateFromChat(text);
      const extractedLocation = extractLocationFromChat(text);
      
      const updates = { lastMsg: text };
      if (extractedDate) {
        updates.wedding = extractedDate;
        console.log(`📅 Wedding date extracted: "${extractedDate}" for ${phone}`);
      }
      if (extractedLocation) {
        updates.city = extractedLocation;
        console.log(`📍 Location extracted: "${extractedLocation}" for ${phone}`);
      }
      await updateActiveLead(phone, updates);
      res.sendStatus(200);
      return;
    }

    if (isNewLead) {
      const lead = isAdDM(text) ? {} : extractLeadDetails(text);
      const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      const source = isAdDM(text) ? "Ad DM" : "Meta Form";

      console.log(`🎯 NEW LEAD: ${firstName || "unknown"} | ${phone} | ${source}`);

      await addActiveLead(phone, firstName, lead.wedding, lead.city, source, "🆕 New Lead", text);

      await new Promise(r => setTimeout(r, 2000));
      await sendMenuButtons(phone);
      pendingMenuSelect.add(phone);

      conversations.set(phone, []);
      addToHistory(phone, "assistant", MENU_TEXT_FALLBACK);
      return;
    }

    if (pendingMenuSelect.has(phone)) {
      const selection = isInteractive
        ? (interactiveId || "")
        : detectMenuSelection(text);

      if (selection && ["A","B","C","D","E"].includes(selection)) {
        pendingMenuSelect.delete(phone);
        customerPath.set(phone, selection);

        const existingHistory = getHistory(phone);
        const storedLead = { name: "", wedding: "", city: "" };

        console.log(`✅ PATH ${selection} selected by ${phone}`);

        const pathLabels = {
          "A": "Beauty and Hair Services",
          "B": "Hydra Package",
          "C": "Pre-Bridal Package",
          "D": "Pre Bridal+ Bridal Makeup Combo",
          "E": "Nail Services",
        };
        await updateActiveLead(phone, {
          status: `📂 ${pathLabels[selection]}`,
          servicePath: pathLabels[selection],
        });

        const contextMsg = buildPathContext(selection, storedLead.name, storedLead.wedding, storedLead.city, text);
        const reply = await getAIReply(phone, contextMsg);
        const parts = reply.split("|").map(p => p.trim()).filter(Boolean).slice(0, 2);

        await new Promise(r => setTimeout(r, 2000));
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 1200));
          await sendText(phone, parts[i]);
          lastSentMessage.set(phone, parts[i]);
        }
        return;
      } else {
        await sendText(phone, "Aap *A, B, C, D ya E* reply karein — main help kar sakti hoon 😊");
        return;
      }
    }

    let contextMsg = text;
    const followupData = await isInFollowupSent(phone);
    if (followupData) {
      const firstName = followupData.name ? followupData.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      console.log(`📤 FOLLOWUP REPLY: ${firstName} (${phone})`);
      await markFollowupReplied(phone);
      await addActiveLead(phone, firstName, followupData.wedding, followupData.city, "Followup", "🆕 New Lead", text);
      contextMsg = `Customer replied to our outreach: "${text}"
Name: ${firstName || "not given"}, Wedding: ${followupData.wedding || "not mentioned"}, City: ${followupData.city || "not mentioned"}
INSTRUCTION: Greet warmly in polite English. Ask wedding date and area. Do NOT introduce yourself.`;
    }

    const reply = await getAIReply(phone, contextMsg);
    const parts = reply.split("|").map(p => p.trim()).filter(Boolean).slice(0, 2);

    await new Promise(r => setTimeout(r, 3000));

    const lastSent = lastSentMessage.get(phone) || "";
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === lastSent && i === 0) continue;
      if (i > 0) await new Promise(r => setTimeout(r, 1200));
      await sendText(phone, parts[i]);
      lastSentMessage.set(phone, parts[i]);
    }

    const extractedDate = extractWeddingDateFromChat(text);
    const extractedLocation = extractLocationFromChat(text);
    
    if (extractedDate || extractedLocation) {
      const updates = { lastMsg: text, status: detectStatus(reply, text) };
      if (extractedDate) {
        updates.wedding = extractedDate;
        console.log(`📅 Wedding date extracted: "${extractedDate}" for ${phone}`);
      }
      if (extractedLocation) {
        updates.city = extractedLocation;
        console.log(`📍 Location extracted: "${extractedLocation}" for ${phone}`);
      }
      await updateActiveLead(phone, updates);
    } else {
      const status = detectStatus(reply, text);
      await updateActiveLead(phone, { lastMsg: text, status });
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook error:", err?.response?.data || err.message);
    res.sendStatus(200);
  }
});

// ── ADMIN PANEL ───────────────────────────────────────────────
app.get("/admin", (req, res) => {
  const defaultMsg = `We have received your inquiry on our advertisement for Pre-Bridal Package. Please let us know your marriage date and location.\n\nRegards,\nBeauty Box Makeup Studio by Garima Nagpal`;
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beauty Box Admin v2.4</title>
<style>*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,sans-serif}body{background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}.container{display:flex;gap:16px;width:100%;max-width:900px;flex-wrap:wrap}.card{background:#fff;border-radius:16px;padding:28px 24px;flex:1;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}h2{font-size:18px;font-weight:600;color:#111;margin-bottom:4px}p{font-size:13px;color:#888;margin-bottom:16px}label{font-size:13px;color:#444;display:block;margin:12px 0 5px;font-weight:500}input{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;margin-bottom:8px}input:focus{border-color:#128C7E}textarea{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;resize:vertical;min-height:100px;line-height:1.6;font-family:-apple-system,sans-serif}textarea:focus{border-color:#128C7E}.hint{font-size:11px;color:#aaa;margin-top:4px}.msg{margin-top:14px;padding:11px;border-radius:10px;font-size:14px;text-align:center;display:none}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#fdecea;color:#c62828}button{width:100%;background:#128C7E;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:500;cursor:pointer;margin-top:10px}button:hover{background:#0d6b65}button.secondary{background:#555;margin-top:8px}small{display:block;font-size:12px;color:#aaa;text-align:center;margin-top:12px;line-height:1.5}</style></head><body><div class="container"><div class="card"><h2>New Chat</h2><p>Send opening message and start bot</p><label>Phone number (with country code, no +)</label><input id="ph" type="tel" placeholder="919999999999"><label>Customer name (optional)</label><input id="nm" type="text" placeholder="Priya"><label>Opening message <span style="font-weight:400;color:#aaa">(editable)</span></label><textarea id="omsg">${defaultMsg}</textarea><div class="hint">Edit before sending. Bot takes over after customer replies.</div><label>Admin key</label><input id="ky" type="password" placeholder="Enter admin key"><button onclick="goNew(true)">Send Message &amp; Activate Bot</button><button class="secondary" onclick="goNew(false)">Activate Bot Only</button><div class="msg" id="msg1"></div><small>Bot handles all replies automatically (v2.4 - Natural Female Tone)</small></div><div class="card"><h2>Reactivate Customer</h2><p>Load customer history & continue conversation</p><label>Customer phone (with country code, no +)</label><input id="rph" type="tel" placeholder="919999999999"><label>Follow-up message <span style="font-weight:400;color:#aaa">(optional)</span></label><textarea id="rmsg" placeholder="Warm message to re-engage customer...">Got it, dry skin. That explains a lot, actually. The issue with dry skin under the eyes is that the area loses moisture much faster than other parts of your face. How long have you been dealing with the dark circles?</textarea><div class="hint">Leave blank to just reactivate without sending message.</div><label>Admin key</label><input id="rky" type="password" placeholder="Enter admin key"><button onclick="goReactivate()">Reactivate &amp; Continue</button><div class="msg" id="msg2"></div><small>Bot will read their history and resume conversation (v2.4 - Professional Tone)</small></div></div><script>async function goNew(sendMsg){const ph=document.getElementById('ph').value.trim();const nm=document.getElementById('nm').value.trim();const ky=document.getElementById('ky').value.trim();const om=document.getElementById('omsg').value.trim();if(!ph||!ky){sh('Enter phone and admin key','err','msg1');return;}try{const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:nm,key:ky,openingMessage:sendMsg?om:'',sendMessage:sendMsg})});const d=await r.json();if(d.success){sh(sendMsg?'Sent to '+ph+'. Bot activated!':'Bot activated for '+ph,'ok','msg1');document.getElementById('ph').value='';document.getElementById('nm').value='';}else sh(d.error||'Error','err','msg1');}catch(e){sh('Network error','err','msg1');}}async function goReactivate(){const ph=document.getElementById('rph').value.trim();const ky=document.getElementById('rky').value.trim();const rmsg=document.getElementById('rmsg').value.trim();if(!ph||!ky){sh('Enter phone and admin key','err','msg2');return;}try{const r=await fetch('/admin/reactivate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,key:ky,message:rmsg})});const d=await r.json();if(d.success){sh('✅ '+d.message,'ok','msg2');document.getElementById('rph').value='';document.getElementById('rmsg').value='';}else sh(d.error||'Error','err','msg2');}catch(e){sh('Network error','err','msg2');}}function sh(t,c,id){const el=document.getElementById(id);el.textContent=t;el.className='msg '+c;el.style.display='block';}document.getElementById('ky').addEventListener('keydown',e=>{if(e.key==='Enter')goNew(true);});document.getElementById('rky').addEventListener('keydown',e=>{if(e.key==='Enter')goReactivate();});</script></body></html>`);
});

app.post("/admin/start", async (req, res) => {
  const { phone, name, key } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false, error: "Wrong admin key" });
  if (!phone) return res.json({ success: false, error: "Phone number required" });
  try {
    const normalizedPhone = normalizePhone(phone);
    const sendMsg = req.body.sendMessage !== false;
    const firstName = name ? name.trim().split(" ")[0] : "";

    if (sendMsg && req.body.openingMessage) {
      const openingMsg = req.body.openingMessage.trim();
      await new Promise(r => setTimeout(r, 1000));
      await sendText(phone, openingMsg);
      addToHistory(phone, "assistant", openingMsg);
      manualOnlyChats.add(normalizedPhone);
      lastMessageTime.set(phone, Date.now());
      nudgeSent.set(phone, false);
      await addActiveLead(phone, firstName, "", "", "Admin Initiated", "💬 Conversation Started", openingMsg);
      console.log(`🚀 ADMIN: Message sent for ${phone} (${normalizedPhone}) — MANUAL MODE active`);
    } else {
      conversations.set(phone, []);
      addToHistory(phone, "assistant", "Admin activated this number.");
      manualOnlyChats.add(normalizedPhone);
      lastMessageTime.set(phone, Date.now());
      nudgeSent.set(phone, false);
      await addActiveLead(phone, firstName, "", "", "Admin Activated", "🆕 New Lead", "Manually activated");
      console.log(`📋 ADMIN: Activated ${phone} (${normalizedPhone}) — MANUAL MODE active`);
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post("/admin/reactivate", async (req, res) => {
  const { phone, key, message } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false, error: "Wrong admin key" });
  if (!phone) return res.json({ success: false, error: "Phone number required" });
  
  try {
    const normalizedPhone = normalizePhone(phone);
    const customerData = await getCustomerData(phone);
    if (!customerData) {
      return res.json({ success: false, error: "Customer not found in records" });
    }

    const firstName = customerData.name ? customerData.name.split(" ")[0] : "Customer";
    const servicePath = customerData.servicePath || "Unknown";

    console.log(`📞 REACTIVATING: ${firstName} (${phone} → ${normalizedPhone}) | Path: ${servicePath}`);

    if (!conversations.has(phone)) {
      conversations.set(phone, []);
    }
    const history = getHistory(phone);
    
    addToHistory(phone, "system", `[REACTIVATED] Previous path: ${servicePath}. Last status: ${customerData.status}`);

    manualOnlyChats.delete(normalizedPhone);

    lastMessageTime.set(phone, Date.now());
    nudgeSent.set(phone, false);

    let sentMessage = "";
    if (message && message.trim()) {
      await sendText(phone, message);
      addToHistory(phone, "assistant", message);
      sentMessage = message;
      console.log(`💬 Reactivation message sent to ${phone}`);
    }

    res.json({
      success: true,
      message: `Reactivated ${firstName}. Previous path: ${servicePath}. Ready to continue conversation.`,
      customerData: {
        name: firstName,
        phone,
        servicePath,
        wedding: customerData.wedding,
        city: customerData.city,
        lastStatus: customerData.status,
      }
    });
  } catch (err) {
    console.error("Reactivate error:", err.message);
    res.json({ success: false, error: err.message });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    agent: "Beauty Box AI Agent v2.4",
    tone: "Natural Professional Female Expert",
    claude: ANTHROPIC_API_KEY ? "OK" : "MISSING",
    wapi: WAPI_VENDOR_UID ? "OK" : "MISSING",
    sheets: sheetsClient ? "OK" : "DISABLED",
    admin: "/admin",
    activeConversations: conversations.size,
    pendingMenuSelections: pendingMenuSelect.size,
    nudgeTracking: lastMessageTime.size,
  });
});

// ── DAILY STATUS REPORT ───────────────────────────────────────
async function sendDailyReport() {
  try {
    if (!sheetsClient) return;
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A:I",
    });
    const rows = res.data.values || [];
    const total = Math.max(0, rows.length - 1);
    let today = 0;
    const todayStr = new Date().toLocaleDateString("en-IN");
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][7] && rows[i][7].includes(todayStr.split("/")[0])) today++;
    }
    await sendText(ADMIN_PHONE, `🌅 Beauty Box Daily Report\n\n✅ Bot is running fine (v2.4)\n📊 Total leads: ${total}\n📅 New today: ${today}\n💬 Active conversations: ${conversations.size}\n🔔 Nudge tracking: ${lastMessageTime.size} leads\n\nCheck /admin for details.`);
  } catch (err) {
    console.error("Daily report error:", err.message);
  }
}

function scheduleDailyReport() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const next9am = new Date(istNow);
  next9am.setHours(9, 0, 0, 0);
  if (istNow >= next9am) next9am.setDate(next9am.getDate() + 1);
  const delay = next9am - istNow;
  setTimeout(() => {
    sendDailyReport();
    setInterval(sendDailyReport, 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`📅 Daily report scheduled in ${Math.round(delay/1000/60)} minutes`);
}

// ── STARTUP ───────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 Beauty Box Agent v2.4 on port ${PORT}`);
  console.log(`✨ Tone: Natural Professional Female Expert`);
  console.log(`💧 Hydra Path: Updated conversation flow`);
  console.log(`💅 Nail Services: NEW Path E with professional staff`);
  console.log(`📋 Diagnostic: Webhook testing endpoints active`);
  console.log(`🔑 Claude:  ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`📱 WAPI:    ${WAPI_VENDOR_UID ? "OK" : "MISSING"}`);
  console.log(`🔐 Token:   ${WAPI_TOKEN ? "OK" : "MISSING"}`);
  console.log(`📊 Sheet ID: ${SHEET_ID ? "OK" : "MISSING"}`);
  console.log(`🔒 Admin:   /admin (key: ${ADMIN_KEY})`);
  console.log(`🧪 Diagnostic: /webhook-diagnostic, /webhook-logs, /webhook-logs/clear`);
  await initSheets();
  scheduleDailyReport();
  scheduleNudgeCheck();
  console.log(`🔔 Nudge system: active (24h silence trigger)`);
  console.log(`📋 Menu system: active (A/B/C/D/E paths)`);
  console.log(`📍 Location extraction: active`);
  console.log(`♻️ Reactivate feature: active`);
  console.log(`✅ All systems ready (v2.4 + Nail Services + Diagnostic)\n`);
});
