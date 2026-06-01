const express = require("express");
const axios   = require("axios");
const path    = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── PHONE NORMALIZATION ────────────────────────────────
function normalizePhone(phone) {
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
      console.log("⚠️ Google Sheets disabled");
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
  if (reply.includes("studio visit") && reply.includes("timing")) return "🏠 Studio Visit Scheduled";
  if (reply.includes("package")) return "📋 Package Shared";
  if (reply.includes("price") || reply.includes("rs")) return "💰 Price Shared";
  if (reply.includes("hydra")) return "💧 Hydra Interest";
  if (reply.includes("family") || reply.includes("mummy")) return "👨‍👩‍👧 Family Approval";
  if (reply.includes("₹499") && reply.includes("nail")) return "💅 Nail Service Interest";

  if (msg.includes("nahi") || msg.includes("not interested")) return "❌ Not Interested";
  if (msg.includes("yes") || msg.includes("book") || msg.includes("confirm")) return "✅ Interested";

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
    if (key === "full_name" || key === "name") d.name = val;
    if (key.includes("wedding")) d.wedding = val;
    if (key === "city" || key === "area") d.city = val;
  }
  return d;
}

function extractWeddingDateFromChat(text) {
  const months = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";
  const patterns = [
    new RegExp(`(\\d{1,2})\\s*(st|nd|rd|th)?\\s*(${months})\\s*(\\d{2,4})?`, "i"),
    new RegExp(`(${months})\\s+(\\d{1,2})(\\s*(\\d{2,4}))?`, "i"),
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
  if (h.length > 5) return h.slice(-5);
  return h;
}

function addToHistory(phone, role, content) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  const h = conversations.get(phone);
  if (h.length > 0 && h[h.length - 1].role === role && h[h.length - 1].content === content) {
    return;
  }
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

// ── MENU SYSTEM ───────────────────────────────────────────────
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
        body: { text: "Welcome to *Beauty Box Makeup Studio* 💄\n\nAap kaunsi service ke baare mein jaanna chahti hain?" },
        action: {
          button: "Choose Service",
          sections: [{
            title: "Beauty Box Services",
            rows: [
              { id: "A", title: "Beauty and Hair Services", description: "Waxing, facials, hair care" },
              { id: "B", title: "Hydra Package", description: "Deep hydration facials" },
              { id: "C", title: "Pre-Bridal Package", description: "12 services, 3 sittings" },
              { id: "D", title: "Pre Bridal+ Bridal Makeup", description: "Complete bridal combo" },
              { id: "E", title: "Nail Services", description: "₹499 launch offer" }
            ]
          }]
        }
      }
    };
    await axios.post(url, payload);
    console.log(`📋 Menu sent to ${toPhone}`);
  } catch (err) {
    console.error(`⚠️ Menu failed:`, err.message);
    await sendText(toPhone, MENU_TEXT_FALLBACK);
  }
}

function detectMenuSelection(text) {
  const t = (text || "").trim().toLowerCase();
  if (t === "a" || t === "1" || t.includes("beauty") || t.includes("hair")) return "A";
  if (t === "b" || t === "2" || t.includes("hydra")) return "B";
  if (t === "c" || t === "3" || t.includes("pre-bridal")) return "C";
  if (t === "d" || t === "4" || t.includes("combo") || t.includes("bridal makeup")) return "D";
  if (t === "e" || t === "5" || t.includes("nail")) return "E";
  return null;
}

// ── SEND TEXT ─────────────────────────────────────────────────
async function sendText(toPhone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, { phone_number: toPhone, message_body: text, message_type: "text" });
    console.log(`✅ Sent to ${toPhone}`);
  } catch (err) {
    console.error(`❌ Send failed:`, err.message);
  }
}

// ── CALL CLAUDE ───────────────────────────────────────────────
async function getAIReply(phone, contextMsg) {
  addToHistory(phone, "user", contextMsg);
  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: getHistory(phone)
    },
    { headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } }
  );
  const reply = res.data.content?.[0]?.text || "Ek second.";
  addToHistory(phone, "assistant", reply);
  return reply;
}

// ── COMPLETE SYSTEM PROMPT ────────────────────────────────────
const SYSTEM_PROMPT = `You are Radhya (AI-bot), a professional skin specialist at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi (near Janakpuri West Metro).

════════════════════════════════════════════════════════════════
CRITICAL RULES - NEVER BREAK
════════════════════════════════════════════════════════════════

R1. MESSAGE LENGTH: Keep MAXIMUM 2-3 lines. NEVER write long paragraphs.
R2. NO REPETITION: Never ask the same question twice in one conversation.
R3. ONE IDEA PER MESSAGE: Don't mix answers + questions + explanations.
R4. ANSWER FIRST: If customer asks something, answer it BEFORE asking next question.
R5. TONE: Warm, natural, professional. NO fake enthusiasm ("Amazing!", "Wow!"). NO scripted phrases.

════════════════════════════════════════════════════════════════
PATH A - BEAUTY AND HAIR SERVICES
════════════════════════════════════════════════════════════════

For: Waxing, facials, hair care, etc.

RESPONSE: Ask which service they need.
Then share relevant price from the service list.
Keep it SHORT - 2-3 lines maximum.

Example services: Hair spa (Rs.799), Facial (Rs.549-Rs.2,199), Waxing (Rs.199-Rs.1,999)

════════════════════════════════════════════════════════════════
PATH B - HYDRA FACIAL PACKAGE
════════════════════════════════════════════════════════════════

For: Skin hydration, dark circles, dryness, dullness

FLOW:
1. Ask: "What's your main skin concern?"
2. Explain why Hydra helps FOR THEIR SPECIFIC concern (personalized, not generic)
3. Share pricing: Single Rs.999 / 3-Sitting Rs.2,799
4. Ask: "When convenient to start?"
5. Close: "Garima ma'am will confirm your slot"

KEY: Natural, conversational, 2-3 lines per message.

════════════════════════════════════════════════════════════════
PATH C - PRE-BRIDAL PACKAGE
════════════════════════════════════════════════════════════════

For: Wedding within 1-2 months

THE PACKAGE: 12 services in 3 sittings
Services: O3+ Facial (x2), Bleach/D-Tan (x2), Full Body Bleach, Full Body Wax, Full Body Polishing, Hair Spa, Manicure, Pedicure, Nail Extension, Face Bleach, Threading & Upper Lips
PRICE: Rs.7,499 (saves Rs.6,351 vs individual services)

FLOW:
1. Ask: "Wedding kab hai?"
2. Share: "12 services, 3 sittings, Rs.7,499"
3. Close: "Book karna hai?"

════════════════════════════════════════════════════════════════
PATH D - PRE-BRIDAL + BRIDAL MAKEUP COMBO
════════════════════════════════════════════════════════════════

For: Complete bridal package

PRE-BRIDAL: Rs.7,499 (12 services, 3 sittings)
BRIDAL MAKEUP: Rs.11,000
COMBO: Rs.16,500 (saves Rs.1,999)
MAKEUP INCLUDES: Waterproof, HD finish, soft glam, lashes, draping, hairstyle

FLOW:
1. Share combo pricing naturally
2. Ask: "Wedding kab hai?"
3. Close: "Garima ma'am confirm karengi"

════════════════════════════════════════════════════════════════
PATH E - NAIL SERVICES
════════════════════════════════════════════════════════════════

For: Nails (extensions, polish, etc.)

OFFER: Rs.499 for ANY nail service (normal: Rs.1,200-1,500)
STAFF: Professional nail team (not Garima personally)
AFTERCARE: Will give aftercare tips

FLOW:
1. Ask: "Nail service experience? (extension, polish, etc.)"
2. Share: "Rs.499 launch offer! Normal price Rs.1,200-1,500"
3. Ask: "Where are you located?"
4. Close: "Direct studio visit with our professional team"

════════════════════════════════════════════════════════════════
PRICING REFERENCE (PATH A - SERVICES)
════════════════════════════════════════════════════════════════

FACIALS:
- Basic Facial: Rs.549
- D-Tan: Rs.499
- Lotus Natural Glow: Rs.799
- Hydra Facial: Rs.999
- Premium/Bridal: Rs.1,999-Rs.2,199

HAIR CARE:
- Basic Hair Spa: Rs.499
- Loreal Hair Spa: Rs.799
- Hair Cut/Trimming: Rs.149-Rs.249
- Nanoplastia: Rs.2,499

WAXING:
- Face Wax: Rs.299
- Full Arms+Underarms: Rs.199-Rs.399
- Full Legs: Rs.299-Rs.599
- Full Body: Rs.1,199-Rs.1,999

BASIC CARE:
- Manicure/Pedicure: Rs.349
- Full Body Polishing: Rs.1,999
- Threading: Rs.30
- Upper Lips: Rs.20-Rs.50

════════════════════════════════════════════════════════════════
METRO TIMES (ONLY IF ASKED)
════════════════════════════════════════════════════════════════

From Janakpuri West Metro:
- Dwarka: 15 min
- CP: 25 min
- South Delhi: 35 min
- Studio location: Vikaspuri, near Janakpuri West Metro

════════════════════════════════════════════════════════════════
SPECIAL RESPONSES
════════════════════════════════════════════════════════════════

HOME VISIT: "Hum sirf studio mein services dete hain. Aap aa sakte ho?"
FAMILY APPROVAL: "Bilkul, family ke saath decide karna sahi hai 😊"
STILL THINKING: "Koi pressure nahi. Main yahan hoon jab decide karo"
WEDDING FAR AWAY: Suggest Hydra Facial as skincare prep (Rs.2,799 package)

════════════════════════════════════════════════════════════════
TONE & PERSONALITY
════════════════════════════════════════════════════════════════

✓ Warm, natural, professional
✓ Like talking to a friend who's an expert
✓ Short messages (2-3 lines typical)
✓ Always end with a question
✓ No pressure - build trust through honesty
✓ Acknowledge concerns genuinely

✗ NO: "That's so exciting!", "Wow!", "Amazing!"
✗ NO: "Bilkul samjha", "Main samjhti hoon", "Maine dekha"
✗ NO: Long paragraphs or explanations
✗ NO: Repeating the same question
✗ NO: Asking 2+ questions in one message

════════════════════════════════════════════════════════════════
IMPORTANT
════════════════════════════════════════════════════════════════

- This is an AI bot (Radhya AI-bot)
- Short, efficient responses
- Check history before asking anything
- One idea per message
- Personalize when possible
- Build trust through honest communication`;

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
        const selectedId = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "";
        return { phone, name, text: selectedId, hasMedia: false, isInteractive: true, interactiveId: selectedId.toUpperCase() };
      }

      return { phone, name, text: msg?.text?.body || "", hasMedia: ["image","audio","video","document"].includes(msg?.type), isInteractive: false };
    }

    const phone2 = body?.contact?.phone_number || "";
    if (phone2) {
      return { phone: phone2, name: [body?.contact?.first_name, body?.contact?.last_name].filter(Boolean).join(" ") || null, text: body?.message?.body || "", hasMedia: false, isInteractive: false };
    }
    return null;
  } catch (e) { return null; }
}

// ── MAIN WEBHOOK ──────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return;
    const { phone, name, text, hasMedia, isInteractive, interactiveId } = parsed;
    if (!text && !hasMedia) return;

    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.endsWith("9560277217")) {
      if (text.toLowerCase().includes("radhya")) {
        adminTrainerActive = true;
        await sendText(phone, "Trainer mode activated");
      }
      return;
    }

    // CHECK GOOGLE SHEET FIRST
    const customerData = await getCustomerData(phone);
    const isNewLead = isMetaLead(text);

    if (!customerData && !isNewLead) {
      console.log(`⏭️ IGNORED: ${phone}`);
      return;
    }

    if (customerData && customerData.botIntervention === "YES") {
      console.log(`📝 Manual mode: ${phone}`);
      await addToHistory(phone, "user", text);
      await updateActiveLead(phone, { lastMsg: text });
      return;
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return;
    }

    lastMessageTime.set(phone, Date.now());

    if (isNewLead) {
      const lead = isAdDM(text) ? {} : extractLeadDetails(text);
      const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      console.log(`🎯 NEW LEAD: ${firstName || "unknown"} | ${phone}`);

      await addActiveLead(phone, firstName, lead.wedding, lead.city, isAdDM(text) ? "Ad DM" : "Meta Form", "🆕 New Lead", text);

      await new Promise(r => setTimeout(r, 500));
      await sendMenuButtons(phone);
      pendingMenuSelect.add(phone);
      conversations.set(phone, []);
      addToHistory(phone, "assistant", MENU_TEXT_FALLBACK);
      return;
    }

    if (pendingMenuSelect.has(phone)) {
      const selection = isInteractive ? (interactiveId || "") : detectMenuSelection(text);

      if (selection && ["A","B","C","D","E"].includes(selection)) {
        pendingMenuSelect.delete(phone);
        console.log(`✅ PATH ${selection} selected`);
        
        await updateActiveLead(phone, {
          status: `📂 Path ${selection}`,
          servicePath: `Path ${selection}`,
        });

        const reply = await getAIReply(phone, `Customer selected option ${selection}. Respond briefly, 2-3 lines only.`);
        const parts = reply.split("|").filter(p => p.trim()).slice(0, 2);

        await new Promise(r => setTimeout(r, 500));
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 300));
          await sendText(phone, parts[i].trim());
        }
        return;
      }

      await sendText(phone, "Aap *A, B, C, D ya E* reply karein");
      return;
    }

    // NORMAL REPLY
    const reply = await getAIReply(phone, text);
    const parts = reply.split("|").filter(p => p.trim()).slice(0, 2);

    await new Promise(r => setTimeout(r, 500));

    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      await sendText(phone, parts[i].trim());
    }

    const extractedDate = extractWeddingDateFromChat(text);
    const extractedLocation = extractLocationFromChat(text);
    
    const updates = { lastMsg: text, status: detectStatus(reply, text) };
    if (extractedDate) updates.wedding = extractedDate;
    if (extractedLocation) updates.city = extractedLocation;
    await updateActiveLead(phone, updates);

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// ── ADMIN PANEL ───────────────────────────────────────────────
app.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Beauty Box Admin</title>
<style>body{font-family:sans-serif;background:#f5f5f5;padding:20px;max-width:600px;margin:0 auto}
.card{background:white;padding:20px;border-radius:10px;margin:10px 0;box-shadow:0 2px 5px rgba(0,0,0,0.1)}
h2{color:#128C7E;margin-top:0}
input{width:100%;padding:10px;margin:5px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}
button{width:100%;padding:10px;background:#128C7E;color:white;border:none;border-radius:5px;cursor:pointer;margin:10px 0}
button:hover{background:#0d6b65}
.msg{padding:10px;border-radius:5px;margin:10px 0;display:none}
.ok{background:#e8f5e9;color:#2e7d32}
.err{background:#fdecea;color:#c62828}
</style></head><body><div class="card"><h2>New Chat</h2>
<input id="ph" placeholder="Phone (919999999999)">
<input id="nm" placeholder="Name">
<input id="ky" placeholder="Admin key">
<button onclick="fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:document.getElementById('ph').value,name:document.getElementById('nm').value,key:document.getElementById('ky').value})}).then(r=>r.json()).then(d=>{alert(d.success?'Done':'Error')})">Start Chat</button>
</div></body></html>`);
});

app.post("/admin/start", async (req, res) => {
  const { phone, key } = req.body;
  if (key !== ADMIN_KEY) return res.json({ success: false });
  const normalizedPhone = normalizePhone(phone);
  manualOnlyChats.add(normalizedPhone);
  conversations.set(phone, []);
  await addActiveLead(phone, "", "", "", "Admin", "🆕 New", "");
  res.json({ success: true });
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    agent: "Beauty Box v2.6 - STABLE",
    status: "🟢 OK",
    claude: ANTHROPIC_API_KEY ? "✅" : "❌",
    sheets: sheetsClient ? "✅" : "⚠️",
  });
});

// ── STARTUP ───────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 Beauty Box v2.6 - STABLE - NO CRASHES`);
  console.log(`Bot: Radhya (AI-bot)`);
  console.log(`Response time: ~10-12 seconds`);
  console.log(`Google Sheet filtering: ACTIVE`);
  await initSheets();
  console.log(`✅ Ready!\n`);
});
