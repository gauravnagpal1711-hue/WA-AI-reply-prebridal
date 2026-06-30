const express = require("express");
const axios   = require("axios");
const path    = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const PORT              = process.env.PORT              || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID   = process.env.WAPI_VENDOR_UID   || "";
const WAPI_TOKEN        = process.env.WAPI_TOKEN        || "";
const ADMIN_KEY         = process.env.ADMIN_KEY         || "beautybox2024";
const BOT_ACTIVE        = true; // Set to true to enable bot replies
const SHEET_ID          = process.env.SHEET_ID          || "";
const ADMIN_PHONE       = "919560277217";
const GARIMA_PHONE      = "919354260517";

// -- GOOGLE SHEETS SETUP
let sheetsClient = null;
async function initSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS || !SHEET_ID) {
      console.log("⚠️ Google Sheets disabled -- credentials or SHEET_ID missing");
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

// -- GET CUSTOMER DATA FROM SHEETS
async function getCustomerData(phone) {
  if (!sheetsClient) return null;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return null;
    
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:J${row}`,
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
      botIntervention: current[10] !== undefined ? current[10] : "Yes",
    };
  } catch (err) {
    console.error("getCustomerData error:", err.message);
    return null;
  }
}

// -- CHECK BOT INTERVENTION FROM SHEET
async function checkBotIntervention(phone) {
  if (!sheetsClient) return true;
  try {
    const row = await findRow("Active Leads", phone);
    if (row < 1) return true;
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!K${row}`,
    });
    const val = res.data.values?.[0]?.[0] || "Yes";
    const isOn = val.toString().trim().toLowerCase() !== "no";
    if (!isOn) console.log(`🚫 Bot Intervention = No for ${phone} -- bot skipping reply`);
    return isOn;
  } catch (err) {
    console.error("checkBotIntervention error:", err.message);
    return true;
  }
}

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
      range: "Active Leads!A:J",
      valueInputOption: "RAW",
      resource: {
        values: [[
          phone, name || "", wedding || "", city || "", source || "",
          status || "🆕 New Lead",
          (lastMsg || "").substring(0, 200),
          nowIST(), nowIST(),
          "",
          "Yes",
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
      range: `Active Leads!A${row}:J${row}`,
    });
    const current = res.data.values?.[0] || ["", "", "", "", "", "", "", "", "", "", "Yes"];
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
      current[10] !== undefined ? current[10] : "Yes",
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

// -- STATUS DETECTION
function detectStatus(aiReply, customerMsg) {
  const reply = (aiReply || "").toLowerCase();
  const msg   = (customerMsg || "").toLowerCase();

  if (reply.includes("garima ma'am aapko") && reply.includes("qr")) return "💳 Advance Pending";
  if (reply.includes("garima ma'am se timing confirm")) return "🏠 Studio Visit Scheduled";
  if (reply.includes("pre-bridal package")) return "📋 Package Shared";
  if (reply.includes("why pay more")) return "💰 Price Shared";
  if (reply.includes("combo price")) return "💑 Combo Interest";
  if (reply.includes("hydra")) return "💧 Hydra Interest";
  if (reply.includes("family") || reply.includes("mummy")) return "👨‍👩‍👧 Awaiting Family OK";
  if (reply.includes("nurture")) return "🌱 Nurture - Far Wedding";
  if (reply.includes("nail")) return "💅 Nail Service Interest";

  if (msg.includes("nahi")) return "❌ Not Interested";
  if (msg.includes("yes") || msg.includes("confirm") || msg.includes("book")) return "✅ Interested";

  return null;
}

// -- META & AD TRIGGERS
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
    if (key === "full_name" || key === "name") d.name = val;
    if (key === "when_is_your_wedding_date" || key === "when_is_your_wedding_date?") d.wedding = val;
    if (key === "city/area" || key === "city" || key === "area") d.city = val;
  }
  return d;
}

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

// -- CONVERSATION MEMORY
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
  return conversations.get(phone);
}
function addToHistory(phone, role, content) {
  const h = getHistory(phone);
  h.push({ role, content });
  if (h.length > 10) h.splice(0, h.length - 10);
}

// -- MENU SYSTEM
const MENU_BODY = `Welcome to *Beauty Box Makeup Studio*

Aap kaunsi service ke baare mein jaanna chahti hain? Ek option choose karein`;

const MENU_TEXT_FALLBACK = `Welcome to *Beauty Box Makeup Studio*

Aap kaunsi service ke baare mein jaanna chahti hain?

*A* -- Pre-Bridal Package
*B* -- Pre Bridal+ Bridal Makeup Combo
*C* -- Hydra Facial Package
*D* -- Nail Services
*E* -- Other Beauty Services

Reply *A, B, C, D ya E* karein`;

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
              { id: "A", title: "Pre-Bridal Package", description: "12 services, 3 sittings" },
              { id: "B", title: "Pre Bridal+ Bridal Makeup", description: "Complete bridal combo" },
              { id: "C", title: "Hydra Facial Package", description: "Deep hydration facials" },
              { id: "D", title: "Nail Services", description: "Launch offer" },
              { id: "E", title: "Other Beauty Services", description: "Facials, waxing, hair care" }
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
  if (t === "a" || t === "1" || t.includes("pre-bridal")) return "A";
  if (t === "b" || t === "2" || t.includes("combo")) return "B";
  if (t === "c" || t === "3" || t.includes("hydra")) return "C";
  if (t === "d" || t === "4" || t.includes("nail")) return "D";
  if (t === "e" || t === "5" || t.includes("beauty")) return "E";
  return null;
}

function buildPathContext(selectedPath, customerName, wedding, city, customerMsg) {
  const name = customerName || "not given";
  switch (selectedPath) {
    case "A":
      return `Customer selected: Pre-Bridal Package. Name: ${name}, Wedding: ${wedding || "not mentioned"}, City: ${city || "not mentioned"}. Customer message: "${customerMsg}". INSTRUCTION: Share pre-bridal package details and pricing. Ask when they want to book. NO trust building.`;
    case "B":
      return `Customer selected: Pre-Bridal + Bridal Makeup Combo. Name: ${name}. INSTRUCTION: Share combo package details and pricing. Ask when they want to book. NO trust building.`;
    case "C":
      return `Customer selected: Hydra Facial Package. Name: ${name}. INSTRUCTION: Share Hydra Facial Package details: Single sitting Rs.999 OR 3-Sitting Package Rs.2,799 (recommended). Benefits: Deep hydration, brightening, skin barrier restore. Then ask: "Kab convenient hoga aapko?" Keep response to 2-3 sentences max.`;
    case "D":
      return `Customer selected: Nail Services. Name: ${name}. INSTRUCTION: Share Nail Services Launch Offer: Rs.499 (Normal: Rs.1,200-1,500). Professional team. Ask: "Kab convenient hoga aapko?" Keep it short (2 sentences).`;
    case "E":
      return `Customer selected: Other Beauty Services. Name: ${name}. INSTRUCTION: Ask which specific service they want (facials, hair, waxing, makeup, etc), then share price. Ask for booking.`;
    default:
      return `Customer message: "${customerMsg}". Name: ${name}. Respond and ask for booking.`;
  }
}

// -- NUDGE SYSTEM
const NUDGE_MESSAGES = [
  "Hi! Bas check kar rahi thi -- koi sawaal tha kya?",
  "Koi confusion ho toh bata dijiye, help kar sakti hoon!",
  "Kab convenient rahega booking ke liye?",
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

// -- SIMPLIFIED SYSTEM PROMPT v3.0
const SYSTEM_PROMPT = `You are Radhya (AI bot), customer support at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi.

Your role: Answer service inquiries and facilitate booking. NO trust building, NO lengthy explanations.

TONE: Polite, professional, Hinglish. 1-2 sentences max.

CONVERSATION RULES:
1. Customer asks about service -- Share service details, pricing, package info
2. Ask when they want to book
3. Direct them to Garima for slot confirmation
4. Keep responses SHORT

SERVICE DETAILS & PRICING:

PRE-BRIDAL PACKAGE (A):
12 Services in 3 Sittings -- Rs.7,499
Services: O3+ Facial (x2), Bleach/D-Tan (x2), Full Body Bleach, Full Body Wax, Full Body Polishing, Hair Spa, Manicure, Pedicure, Nail Extension, Face Bleach, Threading & Upper Lips
Market value: Rs.13,850 -- Save Rs.6,351 (46% OFF)

COMBO PACKAGE (B):
Pre-Bridal (12 services) + Bridal Makeup
Pre-Bridal: Rs.7,499 | Bridal Makeup: Rs.11,000
Combo: Rs.16,500 (Save Rs.1,999)
Bridal includes: Waterproof finish, soft glam velvety matte, lashes & lenses, draping + hairstyle complimentary

HYDRA FACIAL PACKAGE (C):
Single sitting: Rs.999
3-Sitting Package: Rs.2,799 (recommended)
Benefits: Deep hydration, brightening, skin barrier restore, 60-70% improvement typical

NAIL SERVICES (D):
LAUNCH OFFER: Rs.499 (Normal: Rs.1,200-1,500)
Services: Nail extension, gel paint, design
Professional nail team handles services

OTHER BEAUTY SERVICES (E):
FACIALS: Basic (Rs.549-999) | Premium (Rs.1,599-2,199)
HAIR: Hair Spa (Rs.499-799) | Hair Cut (Rs.249) | Color (Rs.2,499-3,999)
WAXING: Face (Rs.299) | Full Arms (Rs.199-399) | Full Legs (Rs.299-599) | Full Body (Rs.1,199-1,999)
BASIC: Manicure (Rs.349) | Pedicure (Rs.349-549) | Threading (Rs.30) | Polishing (Rs.1,999)
MAKEUP: Basic (Rs.1,500) | HD (Rs.1,999-2,999) | Bridal (Rs.11,000)

BOOKING FLOW:
1. After sharing service: Ask "Kab convenient hoga aapko studio visit ke liye?"
2. If agreed: "Perfect! Garima ma'am aapko confirm karengi. +91 93542 60517"
3. If hesitant: "Aap studio visit kar sakte ho -- koi pressure nahi. Kab suitable hai?"
4. For advance: "Garima ma'am QR code bhejegi"

SPECIAL HANDLING:
- Portfolio/experience: https://www.instagram.com/garimanagpalmua/
- Price negotiation: "Garima ma'am se baat karein"
- Slot/QR code: Always direct to Garima, NEVER send from bot

KEY: NO TRUST BUILDING. Share details -- Ask for booking -- Direct to Garima.`;

// -- SEND TEXT
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

// -- CALL CLAUDE
async function getAIReply(phone, contextMsg) {
  addToHistory(phone, "user", contextMsg);
  const liveInstructions = adminInstructions.length > 0
    ? "\n\nLIVE INSTRUCTIONS FROM ADMIN:\n" + adminInstructions.map((ins, i) => (i+1) + ". " + ins).join("\n")
    : "";
  try {
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: SYSTEM_PROMPT + liveInstructions,
        messages: getHistory(phone)
      },
      { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" } }
    );
    const reply = res.data.content?.[0]?.text || "Ek second.";
    addToHistory(phone, "assistant", reply);
    return reply;
  } catch (err) {
    console.error(`Claude API error for ${phone}:`, err.message);
    const fallback = "Aap kaunsi service ke baare mein jaanna chahti ho? A, B, C, D ya E option select karein.";
    addToHistory(phone, "assistant", fallback);
    return fallback;
  }
}

// -- PARSE WEBHOOK
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

// -- WEBHOOK ENDPOINT
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
        console.log(`Admin message ignored (no Radhya trigger)`);
        res.sendStatus(200);
        return;
      }
      if (!adminTrainerActive) {
        adminTrainerActive = true;
        console.log(`Admin trainer mode ACTIVATED`);
        await sendText(phone, `Trainer mode activated. Instruction dijiye.`);
        return;
      }
      const instruction = text.replace(/radhya[,.]?\s*/i, "").trim();
      
      if (instruction.toLowerCase().includes("enable auto")) {
        const match = instruction.match(/(\d{10,})/);
        if (match) {
          const targetPhone = match[1];
          manualOnlyChats.delete(targetPhone);
          console.log(`AUTO MODE ENABLED for ${targetPhone}`);
          await sendText(phone, `Auto mode enabled for ${targetPhone}.`);
          return;
        }
      }

      if (instruction) {
        adminInstructions.push(instruction);
        if (adminInstructions.length > 5) adminInstructions.shift();
        console.log(`ADMIN INSTRUCTION: "${instruction}"`);
        await sendText(phone, `Instruction noted: "${instruction.substring(0, 80)}"`);
      }
      return;
    }

    const isNewLead  = isMetaLead(text);
    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;
    const followupData = !hasHistory && !isNewLead ? await isInFollowupSent(phone) : null;

    // ADD ALL LEADS TO SHEETS IMMEDIATELY
    if (!hasHistory && !followupData) {
      const lead = isNewLead ? extractLeadDetails(text) : {};
      const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      const source = isAdDM(text) ? "Ad DM" : (isNewLead ? "Meta Form" : "Direct Message");
      await addActiveLead(phone, firstName, lead.wedding || "", lead.city || "", source, "🆕 New Lead", text);
      console.log(`ADDED TO SHEETS: ${phone} | Source: ${source}`);
    }

    if (!isNewLead && !hasHistory && !followupData) {
      console.log(`Lead added but not processing: ${phone}`);
      res.sendStatus(200);
      return;
    }

    // -- GLOBAL BOT ACTIVE CHECK
    if (!BOT_ACTIVE) {
      console.log(`BOT_ACTIVE=false -- Lead recorded: ${phone}`);
      res.sendStatus(200);
      return;
    }

    // -- BOT INTERVENTION CHECK
    const botActive = await checkBotIntervention(phone);
    if (!botActive) {
      await updateActiveLead(phone, { lastMsg: text });
      res.sendStatus(200);
      return;
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return;
    }

    lastMessageTime.set(phone, Date.now());
    nudgeSent.set(phone, false);

    if (manualOnlyChats.has(phone)) {
      console.log(`MANUAL MODE: ${phone}`);
      await addToHistory(phone, "user", text);
      const extractedDate = extractWeddingDateFromChat(text);
      const extractedLocation = extractLocationFromChat(text);
      
      const updates = { lastMsg: text };
      if (extractedDate) {
        updates.wedding = extractedDate;
        console.log(`Wedding date extracted: "${extractedDate}" for ${phone}`);
      }
      if (extractedLocation) {
        updates.city = extractedLocation;
        console.log(`Location extracted: "${extractedLocation}" for ${phone}`);
      }
      await updateActiveLead(phone, updates);
      res.sendStatus(200);
      return;
    }
    if (isNewLead) {
      const lead = isAdDM(text) ? {} : extractLeadDetails(text);
      const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      const source = isAdDM(text) ? "Ad DM" : "Meta Form";

      console.log(`NEW LEAD: ${firstName || "unknown"} | ${phone} | ${source}`);

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

        console.log(`PATH ${selection} selected by ${phone}`);

        const pathLabels = {
          "A": "Pre-Bridal Package",
          "B": "Pre Bridal+ Bridal Makeup Combo",
          "C": "Hydra Facial Package",
          "D": "Nail Services",
          "E": "Other Beauty Services",
        };
        await updateActiveLead(phone, {
          status: `📂 ${pathLabels[selection]}`,
          servicePath: pathLabels[selection],
        });

        const contextMsg = buildPathContext(selection, storedLead.name, storedLead.wedding, storedLead.city, text);
        console.log(`[DEBUG] Path ${selection} context: ${contextMsg.substring(0, 100)}...`);
        const reply = await getAIReply(phone, contextMsg);
        console.log(`[DEBUG] Claude reply for ${selection}: ${reply.substring(0, 100)}`);
        const parts = reply.split("|").map(p => p.trim()).filter(Boolean);
        console.log(`[DEBUG] Sending ${parts.length} parts to ${phone}`);

        await new Promise(r => setTimeout(r, 3000));
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 1800));
          await sendText(phone, parts[i]);
          lastSentMessage.set(phone, parts[i]);
        }
        return;
      } else {
        await sendText(phone, "Aap *A, B, C, D ya E* reply karein");
        return;
      }
    }

    let contextMsg = text;
    if (followupData) {
      const firstName = followupData.name ? followupData.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      console.log(`FOLLOWUP REPLY: ${firstName} (${phone})`);
      await markFollowupReplied(phone);
      await addActiveLead(phone, firstName, followupData.wedding, followupData.city, "Followup", "🆕 New Lead", text);
      contextMsg = `Customer replied to our outreach: "${text}". INSTRUCTION: Ask which service they are interested in, then offer details and ask for booking.`;
    }

    const reply = await getAIReply(phone, contextMsg);
    const parts = reply.split("|").map(p => p.trim()).filter(Boolean);

    await new Promise(r => setTimeout(r, 5500));

    const lastSent = lastSentMessage.get(phone) || "";
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === lastSent && i === 0) continue;
      if (i > 0) await new Promise(r => setTimeout(r, 1800));
      await sendText(phone, parts[i]);
      lastSentMessage.set(phone, parts[i]);
    }

    const extractedDate = extractWeddingDateFromChat(text);
    const extractedLocation = extractLocationFromChat(text);
    
    if (extractedDate || extractedLocation) {
      const updates = { lastMsg: text, status: detectStatus(reply, text) };
      if (extractedDate) {
        updates.wedding = extractedDate;
        console.log(`Wedding date extracted: "${extractedDate}" for ${phone}`);
      }
      if (extractedLocation) {
        updates.city = extractedLocation;
        console.log(`Location extracted: "${extractedLocation}" for ${phone}`);
      }
      await updateActiveLead(phone, updates);
    } else {
      const status = detectStatus(reply, text);
      await updateActiveLead(phone, { lastMsg: text, status });
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err.message);
    res.sendStatus(200);
  }
});

// -- ADMIN PANEL
app.get("/admin", (req, res) => {
  const defaultMsg = `We have received your inquiry on our advertisement for Pre-Bridal Package. Please let us know your marriage date and location.\n\nRegards,\nBeauty Box Makeup Studio by Garima Nagpal`;
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beauty Box Admin v3.0</title>
<style>*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,sans-serif}body{background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}.container{display:flex;gap:16px;width:100%;max-width:900px;flex-wrap:wrap}.card{background:#fff;border-radius:16px;padding:28px 24px;flex:1;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}h2{font-size:18px;font-weight:600;color:#111;margin-bottom:4px}p{font-size:13px;color:#888;margin-bottom:16px}label{font-size:13px;color:#444;display:block;margin:12px 0 5px;font-weight:500}input{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;margin-bottom:8px}input:focus{border-color:#128C7E}textarea{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;resize:vertical;min-height:100px;line-height:1.6;font-family:-apple-system,sans-serif}textarea:focus{border-color:#128C7E}.hint{font-size:11px;color:#aaa;margin-top:4px}.msg{margin-top:14px;padding:11px;border-radius:10px;font-size:14px;text-align:center;display:none}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#fdecea;color:#c62828}button{width:100%;background:#128C7E;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:500;cursor:pointer;margin-top:10px}button:hover{background:#0d6b65}button.secondary{background:#555;margin-top:8px}small{display:block;font-size:12px;color:#aaa;text-align:center;margin-top:12px;line-height:1.5}</style></head><body><div class="container"><div class="card"><h2>New Chat</h2><p>Send opening message and start bot</p><label>Phone number (with country code, no +)</label><input id="ph" type="tel" placeholder="919999999999"><label>Customer name (optional)</label><input id="nm" type="text" placeholder="Priya"><label>Opening message</label><textarea id="omsg">${defaultMsg}</textarea><div class="hint">Edit before sending. Bot takes over after customer replies.</div><label>Admin key</label><input id="ky" type="password" placeholder="Enter admin key"><button onclick="goNew(true)">Send Message & Activate Bot</button><button class="secondary" onclick="goNew(false)">Activate Bot Only</button><div class="msg" id="msg1"></div><small>Bot handles all replies automatically (v3.0)</small></div><div class="card"><h2>Reactivate Customer</h2><p>Load customer history & continue conversation</p><label>Customer phone (with country code, no +)</label><input id="rph" type="tel" placeholder="919999999999"><label>Follow-up message</label><textarea id="rmsg" placeholder="Hi! Kaunsi service interested ho?">Hi! Kaunsi service ke baare mein jaanna chahti ho?</textarea><div class="hint">Leave blank to just reactivate.</div><label>Admin key</label><input id="rky" type="password" placeholder="Enter admin key"><button onclick="goReactivate()">Reactivate & Continue</button><div class="msg" id="msg2"></div><small>Bot will read their history and resume (v3.0)</small></div></div><script>async function goNew(sendMsg){const ph=document.getElementById('ph').value.trim();const nm=document.getElementById('nm').value.trim();const ky=document.getElementById('ky').value.trim();const om=document.getElementById('omsg').value.trim();if(!ph||!ky){sh('Enter phone and admin key','err','msg1');return;}try{const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:nm,key:ky,openingMessage:sendMsg?om:'',sendMessage:sendMsg})});const d=await r.json();if(d.success){sh(sendMsg?'Sent to '+ph+'. Bot activated!':'Bot activated for '+ph,'ok','msg1');document.getElementById('ph').value='';document.getElementById('nm').value='';}else sh(d.error||'Error','err','msg1');}catch(e){sh('Network error','err','msg1');}}async function goReactivate(){const ph=document.getElementById('rph').value.trim();const ky=document.getElementById('rky').value.trim();const rmsg=document.getElementById('rmsg').value.trim();if(!ph||!ky){sh('Enter phone and admin key','err','msg2');return;}try{const r=await fetch('/admin/reactivate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,key:ky,message:rmsg})});const d=await r.json();if(d.success){sh('Reactivated '+d.message.split('.')[0],'ok','msg2');document.getElementById('rph').value='';document.getElementById('rmsg').value='';}else sh(d.error||'Error','err','msg2');}catch(e){sh('Network error','err','msg2');}}function sh(t,c,id){const el=document.getElementById(id);el.textContent=t;el.className='msg '+c;el.style.display='block';}document.getElementById('ky').addEventListener('keydown',e=>{if(e.key==='Enter')goNew(true);});document.getElementById('rky').addEventListener('keydown',e=>{if(e.key==='Enter')goReactivate();});</script></body></html>`);
});

app.post("/admin/start", async (req, res) => {
  const { phone, name, key } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false, error: "Wrong admin key" });
  if (!phone) return res.json({ success: false, error: "Phone number required" });
  try {
    const sendMsg = req.body.sendMessage !== false;
    const firstName = name ? name.trim().split(" ")[0] : "";

    if (sendMsg && req.body.openingMessage) {
      const openingMsg = req.body.openingMessage.trim();
      await new Promise(r => setTimeout(r, 1000));
      await sendText(phone, openingMsg);
      addToHistory(phone, "assistant", openingMsg);
      manualOnlyChats.add(phone);
      lastMessageTime.set(phone, Date.now());
      nudgeSent.set(phone, false);
      await addActiveLead(phone, firstName, "", "", "Admin Initiated", "💬 Conversation Started", openingMsg);
      console.log(`ADMIN: Message sent for ${phone}`);
    } else {
      conversations.set(phone, []);
      addToHistory(phone, "assistant", "Admin activated this number.");
      manualOnlyChats.add(phone);
      lastMessageTime.set(phone, Date.now());
      nudgeSent.set(phone, false);
      await addActiveLead(phone, firstName, "", "", "Admin Activated", "🆕 New Lead", "Manually activated");
      console.log(`ADMIN: Activated ${phone}`);
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
    const customerData = await getCustomerData(phone);
    if (!customerData) {
      return res.json({ success: false, error: "Customer not found in records" });
    }

    const firstName = customerData.name ? customerData.name.split(" ")[0] : "Customer";
    const servicePath = customerData.servicePath || "Unknown";

    console.log(`REACTIVATING: ${firstName} (${phone}) | Path: ${servicePath}`);

    if (!conversations.has(phone)) {
      conversations.set(phone, []);
    }
    const history = getHistory(phone);
    
    addToHistory(phone, "system", `[REACTIVATED] Previous path: ${servicePath}. Last status: ${customerData.status}`);

    manualOnlyChats.delete(phone);

    lastMessageTime.set(phone, Date.now());
    nudgeSent.set(phone, false);

    let sentMessage = "";
    if (message && message.trim()) {
      await sendText(phone, message);
      addToHistory(phone, "assistant", message);
      sentMessage = message;
      console.log(`Reactivation message sent to ${phone}`);
    }

    res.json({
      success: true,
      message: `Reactivated ${firstName}. Previous path: ${servicePath}. Ready to continue.`,
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

// -- HEALTH CHECK
app.get("/", (req, res) => {
  res.json({
    agent: "Beauty Box AI Agent v3.0",
    tone: "Simplified Inquiry to Booking Flow",
    claude: ANTHROPIC_API_KEY ? "OK" : "MISSING",
    wapi: WAPI_VENDOR_UID ? "OK" : "MISSING",
    sheets: sheetsClient ? "OK" : "DISABLED",
    admin: "/admin",
    activeConversations: conversations.size,
    pendingMenuSelections: pendingMenuSelect.size,
    nudgeTracking: lastMessageTime.size,
  });
});

// -- DAILY STATUS REPORT
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
    await sendText(ADMIN_PHONE, `Daily Report\n\nBot: OK (v3.0)\nTotal leads: ${total}\nNew today: ${today}\nActive conversations: ${conversations.size}`);
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
  console.log(`Daily report scheduled in ${Math.round(delay/1000/60)} minutes`);
}

// -- STARTUP
app.listen(PORT, async () => {
  console.log(`\n🚀 Beauty Box Agent v3.0 on port ${PORT}`);
  console.log(`✨ Flow: Inquiry -- Service Menu -- Details + Price -- Booking`);
  console.log(`📋 ALL leads added to Google Sheets immediately`);
  console.log(`🔑 Claude:  ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`📱 WAPI:    ${WAPI_VENDOR_UID ? "OK" : "MISSING"}`);
  console.log(`🔐 Token:   ${WAPI_TOKEN ? "OK" : "MISSING"}`);
  console.log(`📊 Sheet ID: ${SHEET_ID ? "OK" : "MISSING"}`);
  console.log(`🔒 Admin:   /admin (key: ${ADMIN_KEY})`);
  await initSheets();
  scheduleDailyReport();
  scheduleNudgeCheck();
  console.log(`🔔 Nudge system: active (24h silence trigger)`);
  console.log(`📋 Menu system: active (A/B/C/D/E paths)`);
  console.log(`📍 Location extraction: active`);
  console.log(`✅ All systems ready (v3.0)\n`);
});
