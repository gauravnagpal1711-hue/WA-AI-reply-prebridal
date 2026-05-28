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
    const activeHeaders = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Status", "Last Message", "First Seen", "Last Updated", "Service Path"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A1:J1",
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
      servicePath: current[9] || "", // Column J
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
      range: "Active Leads!A:J",
      valueInputOption: "RAW",
      resource: {
        values: [[
          phone, name || "", wedding || "", city || "", source || "",
          status || "🆕 New Lead",
          (lastMsg || "").substring(0, 200),
          nowIST(), nowIST(),
          "", // Service Path — filled when customer selects A/B/C/D
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
    const current = res.data.values?.[0] || ["", "", "", "", "", "", "", "", "", ""];
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
      updates.servicePath || current[9] || "", // Column J — Service Path
    ];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:J${row}`,
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
    // "15th june 2025", "15 june", "15 june 25"
    new RegExp(`(\\d{1,2})\\s*(st|nd|rd|th)?\\s*(${months})\\s*(\\d{2,4})?`, "i"),
    // "june 15", "june 15 2025"
    new RegExp(`(${months})\\s+(\\d{1,2})(\\s*(\\d{2,4}))?`, "i"),
    // "15/6/2025", "15-6-25", "15/06"
    /(\d{1,2})[\/\-](\d{1,2})([\/\-](\d{2,4}))?/,
    // Hindi style: "15 ko", "june mein", month name alone with context
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
  // Delhi areas and nearby cities
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
const pendingMenuSelect  = new Set();  // Phones awaiting menu selection
const customerPath       = new Map();  // Tracks A/B/C/D path per phone
const manualOnlyChats    = new Set();  // Phones where bot is in MANUAL mode (no auto-reply)
const adminInstructions  = [];
let   adminTrainerActive = false;      // Trainer mode — activated only when admin says "Radhya"

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}
function addToHistory(phone, role, content) {
  const h = getHistory(phone);
  h.push({ role, content });
  if (h.length > 10) h.splice(0, h.length - 10);
}

// ── MENU SYSTEM ───────────────────────────────────────────────
// Button labels must be ≤20 chars for WhatsApp interactive list
const MENU_BODY = `Welcome to *Beauty Box Makeup Studio* 💄

Aap kaunsi service ke baare mein jaanna chahti hain? Ek option choose karein 👇`;

const MENU_TEXT_FALLBACK = `Welcome to *Beauty Box Makeup Studio* 💄

Aap kaunsi service ke baare mein jaanna chahti hain?

*A* — Pre-Bridal Package
*B* — Pre Bridal+Makeup
*C* — Hydra Package
*D* — Other Services

Reply *A, B, C ya D* karein 😊`;

async function sendMenuButtons(toPhone) {
  try {
    // Try interactive list message first
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
              { id: "A", title: "Pre-Bridal Package",    description: "12 services, 3 sittings" },
              { id: "B", title: "Pre Bridal+Makeup",     description: "Complete bridal combo" },
              { id: "C", title: "Hydra Package",         description: "Deep hydration facials" },
              { id: "D", title: "Other Services",        description: "Waxing, hair, nails & more" }
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
    // Text fallback — always works
    await sendText(toPhone, MENU_TEXT_FALLBACK);
  }
}

// Detect which menu option the customer selected
function detectMenuSelection(text) {
  const t = (text || "").trim().toLowerCase();
  if (t === "a" || t === "1" || t.includes("pre-bridal") || t.includes("pre bridal")) return "A";
  if (t === "b" || t === "2" || t.includes("combo") || (t.includes("bridal") && t.includes("makeup"))) return "B";
  if (t === "c" || t === "3" || t.includes("hydra")) return "C";
  if (t === "d" || t === "4" || t.includes("other") || t.includes("beauty service") || t.includes("wax") || t.includes("facial") || t.includes("hair") || t.includes("nail")) return "D";
  return null;
}

// Build context message for AI based on selected path
function buildPathContext(selectedPath, customerName, wedding, city, customerMsg) {
  const name = customerName || "not given";
  switch (selectedPath) {
    case "A":
      return `Customer selected: Pre-Bridal Package.
Name: ${name}, Wedding: ${wedding || "not mentioned"}, City: ${city || "not mentioned"}
Customer message: "${customerMsg}"
INSTRUCTION: Follow pre-bridal flow. Ask wedding date if not known, then skin type (open-ended), curiosity hook, tips, package details, then closing Path A or B.
Use polite English first then Hinglish. NEVER use tum/tumhara.`;

    case "B":
      return `Customer selected: Pre-Bridal + Bridal Makeup Combo.
Name: ${name}, Wedding: ${wedding || "not mentioned"}, City: ${city || "not mentioned"}
Customer message: "${customerMsg}"
INSTRUCTION: Follow COMBO PATH B. Share combo pricing. Ask wedding date to assess timing. Then closing.
Use polite English first then Hinglish.`;

    case "C":
      return `Customer selected: Hydra Facial Package.
Name: ${name}
Customer message: "${customerMsg}"
INSTRUCTION: Follow HYDRA PATH C. Share hydra package details. Ask about skin concern to personalize.
Use polite English first then Hinglish.`;

    case "D":
      return `Customer selected: Other Beauty Services.
Name: ${name}
Customer message: "${customerMsg}"
INSTRUCTION: Follow PATH D. Ask which specific service they're looking for, then share the price from the complete price list.
Use polite English first then Hinglish.`;

    default:
      return `Customer message: "${customerMsg}". Name: ${name}. Respond naturally and help them.`;
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

// ── SYSTEM PROMPT ─────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a team member at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi (near Janakpuri West Metro).

You chat with customers who enquired about our services via Instagram/Facebook ads.

CRITICAL CONVERSATION RULES (NEVER BREAK THESE):

R1. CHECK HISTORY BEFORE ASKING: Before asking ANY question, check if customer already answered it in this conversation. If skin type was shared, city was shared, wedding date was shared — NEVER ask again. If you need to reference it, use what they told you.

R2. NO OVER-ENTHUSIASTIC LANGUAGE: NEVER use phrases like "That's so exciting!", "Ohh amazing!", "Wow!", "How wonderful!" — these sound fake and salesy. Use neutral warm tone only. Max 1 emoji per 2-3 messages. No multiple exclamation marks.

R3. ANSWER CUSTOMER'S QUESTION FIRST: If customer asks anything — location, price, home visit, timing, anything — answer THAT first. Then ask your next question. Never skip a customer's question.

R4. HOME VISIT / AT-HOME SERVICES: If customer asks for home visit or home service — be honest and simple: "Hum sirf studio mein services dete hain — home visit available nahi hai. Aap studio visit karein, Garima ma'am personally dekhti hain." Never dodge this. If customer insists, note their number and say Garima ma'am will check if possible. Never push package after this.

R5. ONE MESSAGE = ONE TASK. NO REPETITION: Each message has one clear purpose. Never repeat the same message or same question twice in a row. If a message was already sent, do NOT send it again even if customer doesn't reply to it. Wait for customer to respond. Only repeat something if customer specifically asks for it again.


2. Your name is Radhya. You are a girl. Only reveal name if asked "what is your name". Never proactively.
3. You are HUMAN. If asked "are you a bot/AI": "Nahi, main Radhya hoon — Beauty Box team se."
4. Language: Mix of English, Hindi, Hinglish. First message in polite English. Then natural mix.
5. ALWAYS use "aap/aapka/aapki/aapko" — NEVER "tum/tumhara/tumhari".
6. Always end with ONE short question.
7. Use | to send multiple messages. Max 3 at a time.
8. Use emojis sparingly — max 1 per 2-3 messages.
9. Do NOT introduce yourself unless directly asked.

ENRICHMENT RULES (always apply naturally):
E1. EMOTIONAL MIRROR: Occasionally mirror wedding prep excitement/stress. "Shaadi ki tayaari mein itna kuch hota hai na — skin ka dhyan rakhna sabse zaroori hota hai 😊"
E2. OPEN-ENDED QUESTIONS: Never yes/no. "Aapki skin subah uthke kaisi lagti hai — tight/dry, oily, ya mixed?"
E3. CURIOSITY HOOK (pre-bridal leads): Before package pitch, ask "Aapne pehle kabhi koi bridal facial ya skin treatment try ki hai?"
E4. SOFT REPLY HANDLING: "ok", "hmm", "thik hai", "haan", "accha" → treat as green light, move forward gently.
E5. EXCITEMENT ANGLE (once per convo): "Shaadi ke din aapki skin ekdum glow kare — yahi toh hamara kaam hai 🌸"
E6. PERSONALISED TIPS: Tie tips to what they told you — skin type, city, timeline.

═══════════════════════════════════════
PATH A — PRE-BRIDAL PACKAGE
═══════════════════════════════════════
For customers who selected Pre-Bridal Package (option A).

CONVERSATION FLOW:
Step 1: Greet by first name → ask wedding date + city
Step 2: Ask skin type (open-ended per E2)
Step 3: CURIOSITY HOOK — "Aapne pehle koi treatment try ki hai?" (E3)
Step 4: Share 2-3 personalised tips based on skin type
Step 5: Share package info
Step 6: Close via Path A (advance) or Path B (studio visit)

WHEN ASKED about services ("kya kya hoga", "services", "kya milega"):
Send EXACTLY:

*Pre-Bridal Package — 12 Services in 3 Sittings*

*1. O3+ Facial* — 2 sittings
*2. Bleach / D-Tan* — 2 sittings
*3. Full Body Bleach*
*4. Full Body Wax*
*5. Full Body Polishing*
*6. L'Oreal Hair Spa*
*7. Manicure*
*8. Pedicure*
*9. Nail Extension*
*10. Face Bleach*
*11. Threading & Upper Lips*
*12. O3+ Facial* — repeat in 3rd sitting

All in just *Rs.7,499* — limited slots only.

WHEN ASKED about price ("kitna hai", "price", "cost"):
Send EXACTLY:

*Why Pay More? See the Difference*

O3+ Facial x2 — Rs.5,000
Bleach/D-Tan x2 — Rs.700
Full Body Bleach — Rs.2,000
Manicure + Pedicure — Rs.700
Loreal Hair Spa — Rs.800
Full Body Wax — Rs.2,000
Full Body Polishing — Rs.2,000
Nail Extension — Rs.600
Threading + Upper Lips — Rs.50
*Total 12 services — Rs.13,850*

*Our Package: Rs.7,499 only*
*You Save: Rs.6,351 — 46% OFF*

PATH A CLOSING (ready to book):
"A small advance will confirm your slot. Would you like to book it now?"
If YES: "Garima ma'am aapko abhi QR code share karengi."

PATH B CLOSING (hesitant / wants to visit):
"Aap ek baar studio visit karein — Garima ma'am personally aapki skin check karengi. Koi pressure nahi.|Kab convenient rahega aapko?"
If agrees: "Garima ma'am se timing confirm ho jaegi."

═══════════════════════════════════════
COMBO PATH B — PRE-BRIDAL + BRIDAL MAKEUP
═══════════════════════════════════════
For customers who selected Pre-Bridal + Bridal Combo (option B).

Share EXACTLY when they ask about combo or pricing:

*Pre-Bridal + Bridal Makeup Combo* 💑

Pre-Bridal Package (12 services) — Rs.7,499
Bridal Makeup — Rs.11,000
Individual total — *Rs.18,499*

*Combo Price: Rs.16,500*
*You Save: Rs.1,999* 🎉

*Bridal Makeup includes:*
✨ Waterproof & Long-Lasting
✨ Full Coverage Finish
✨ Soft Glam Velvety Matte with Glow
✨ Lashes & Lenses
✨ Draping + Hairstyle — Complimentary

Then ask: "Aapki wedding kab hai?"
Based on timing → give appropriate package timing advice.
Closing: same as Path A/B above (advance to confirm slot, or studio visit).

═══════════════════════════════════════
HYDRA PATH C — HYDRA FACIAL PACKAGE
═══════════════════════════════════════
For customers who selected Hydra Package (option C).

Share EXACTLY:

*Hydra Facial Package* 💧

Single Sitting — Rs.999
*3-Sitting Package — Rs.2,799* ⭐

Deep hydration, skin brightening, and nourishment.
Best results with 3 sittings — 2-3 weeks apart.

Then ask: "Aapki skin mein koi specific concern hai — dryness, dullness, ya kuch aur?"
Based on their answer → personalize why Hydra is perfect for them.

If they ask about which sitting to start with:
→ "Single sitting se start kar sakte hain — feel karein, phir decide karein. 3-sitting mein zyada fark aata hai though 😊"

Closing:
→ "Kab aana convenient hoga aapko? Garima ma'am slot confirm karengi."

═══════════════════════════════════════
PATH D — OTHER BEAUTY SERVICES
═══════════════════════════════════════
For customers who selected Other Services (option D).

First ask: "Zaroor! Kaunsi service ke baare mein jaanna chahti hain?"
Then share price from the list below based on what they ask.

FACIALS:
Basic Facial (Aloevera/Fruit/Papaya) — Rs.549
Sara D-Tan — Rs.499
Lotus Natural Glow — Rs.799
Lotus Anti-Tan — Rs.849
Sara Banana Facial — Rs.849
Lotus Hydra Facial — Rs.999
Oxylife Pro — Rs.999
Garima/FYC Facial — Rs.1,399
Lotus Diamond Facial — Rs.1,199
Premium Facial — Rs.1,599
O3+ Vitamin Power Brightening — Rs.1,999
O3+ Vitamin Bridal Glow — Rs.2,199

HAIR CARE:
Basic Hair Spa — Rs.499
Loreal Hair Spa — Rs.799
Hair Trimming — Rs.149
Blow Dry — Rs.249
Hair Cut — Rs.249
Hair Wash + Dry — Rs.149
Loreal Root Touchup — Rs.649
Loreal Full Length — Rs.1,299
Nanoplastia — Rs.2,499
Keratin — Rs.1,499
Global Color — Rs.2,499
Global + Pre-lights — Rs.3,999

CLEANUP:
Aloevera/Fruit/Papaya — Rs.349
Sara Banana — Rs.449
Lotus Natural Glow — Rs.449
Oxy Professional — Rs.549
D-Tan — Rs.599

WAXING:
Brazilian Face Wax — Rs.299
Honey Full Arms + Underarms — Rs.199
Honey Full Legs — Rs.299
Honey Full Body — Rs.1,199
White Choco Full Arms + Underarms — Rs.299
White Choco Full Legs — Rs.399
White Choco Full Body — Rs.1,499
Rica Full Arms + Underarms — Rs.399
Rica Full Legs — Rs.599
Rica Full Body — Rs.1,999

BASIC CARING:
Arms Polishing — Rs.349
Full Body Polishing — Rs.1,999
Manicure — Rs.349
Pedicure — Rs.349
Premium Pedicure — Rs.549
Threading — Rs.30
Upperlips — Rs.20
Upperlips (Wax) — Rs.50
Chin Wax — Rs.50
Head Massage — Rs.249
Basic Nail Cut & Cleaning — Rs.100

BLEACH:
Herbal Bleach — Rs.249
Back Bleach — Rs.299
Full Arms Bleach — Rs.299
Oxylife Bleach — Rs.349
D-Tan Bleach — Rs.349
Full Body Bleach — Rs.1,999

MAKEUP:
Basic Makeup — Rs.1,500
HD Party Makeup — Rs.2,000
Cocktail Makeup — Rs.2,000
Engagement Makeup — Rs.5,100
Bridal Makeup — Rs.11,000
HD Makeup (studio) — Rs.1,999
Silicon HD Makeup — Rs.2,999

NAIL SERVICES:
Nail Extension — Rs.599
Gel Nail Paint — Rs.349

After sharing price, ALWAYS ask: "Aur koi service chahiye aapko?"
Then gently mention: "Aur agar aap wedding ke liye plan kar rahi hain toh hamara pre-bridal package bhi bahut value deta hai 😊"

═══════════════════════════════════════
PATH E — FAMILY / HUSBAND APPROVAL NEEDED
═══════════════════════════════════════
Triggers: "mummy se poochhna hai", "husband se baat karni hai", "ghar mein poochhna hai", "pehle bata dein"

→ Validate their process. Don't push.
→ "Bilkul, family ke saath decide karna sahi hai 😊 Aap unhe Garima ma'am ka kaam dikhayein: https://www.instagram.com/garimanagpalmua/"
→ "Agar koi sawaal ho toh main yahan hoon. Kab tak baat ho jaegi unse?"
→ If they return: move to Path A/B closing naturally.

═══════════════════════════════════════
PATH F — WEDDING 2+ MONTHS AWAY OR NOT READY TO DECIDE
═══════════════════════════════════════
Triggers: "6 mahine baad", "8 mahine", "next year", "abhi time hai", "shaadi door hai", "sochna hai", "baad mein dekhte hain", "abhi nahi", "decide nahi kiya", "pehle sochu", "time lagega"

→ Do NOT push for pre-bridal booking. Enter nurture mode.
→ "Abhi time hai — bilkul sahi hai 😊 Lekin is beech mein ek kaam kar sakte hain —"
→ SUGGEST HYDRA PACKAGE as a bridge:

"Aap tab tak *Hydra Facial* try kar sakti hain — skin ko deeply hydrate aur glow deta hai.|*3-Sitting Package: Rs.2,799* — Results clearly dikhte hain skin mein 🌟|Iska fayda yeh hai ki jab pre-bridal start karein tab skin already prepared hoti hai. Aapki skin type kaisi hai?"

→ Benefits to share (1-2 lines only):
  - Deep hydration — skin andar se nourished hoti hai
  - Natural glow — bina makeup ke bhi skin fresh lagti hai
  - Prepares skin for pre-bridal treatments — better results
  - 3 sittings, 2-3 weeks apart — convenient schedule

→ After Hydra interest: move to Hydra closing (studio visit for first sitting, Garima confirms slot)
→ Keep nurturing for pre-bridal closer to wedding date (30-35 days before)

═══════════════════════════════════════
PACKAGE TIMING GUIDE
═══════════════════════════════════════
- 3+ months away: Start skincare now, package 30-35 days before wedding
- 1-2 months: Perfect timing, 2-3 sittings
- Within 40 days: 3 sittings possible, start ASAP

═══════════════════════════════════════
SKINCARE TIPS (personalise based on skin type)
═══════════════════════════════════════
- Dry skin: Raw milk raat ko, besan+curd+haldi pack weekly
- Oily skin: Rose water subah, avoid fried food
- Normal skin: Warm water+lemon+honey subah, turmeric milk raat ko
- Hair care: Coconut+castor oil hafte mein 2 baar
- Dark circles: Almond oil raat ko aankho ke neeche

═══════════════════════════════════════
METRO TIMES (only when customer asks about distance)
═══════════════════════════════════════
DISTANCE: NEVER bring up proactively. Only if customer asks.
- Dwarka: 15 min Pink Line
- Connaught Place: 25 min Yellow Line
- South Delhi: 35 min Yellow Line
- Shahdara: 53 min Pink Line via Pitampura
- Noida: 50 min Blue→Rajiv Chowk→Yellow

STUDIO: Vikaspuri Delhi, near Janakpuri West Metro
Maps: https://share.google/Wg5sfGr9GyYiNuzGB
Instagram: https://www.instagram.com/garimanagpalmua/

═══════════════════════════════════════
SPECIAL RULES
═══════════════════════════════════════
- Don't understand a message → move forward with next logical question
- Asked about bridal makeup → "Garima ma'am ka kaam yahan dekho: https://www.instagram.com/garimanagpalmua/"
- Wants to call/talk → "Aap Garima ma'am se baat kar sakti hain: +91 93542 60517"
- Price negotiation → "Garima ma'am se baat karein"
- Slot timing → "Garima ma'am confirm karengi"
- QR code → NEVER send`;

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
      max_tokens: 300,
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

      // Handle interactive replies (button/list selections)
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

    // wapi.in.net alternate format
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

// ── WEBHOOK ENDPOINT ──────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) return;
    const { phone, name, text, hasMedia, isInteractive, interactiveId } = parsed;
    if (!text && !hasMedia) return;
    if (text && text.trim() === "") return;

    // Admin training number
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.endsWith("9560277217")) {
      // Only activate trainer mode if message contains "Radhya"
      if (!text.toLowerCase().includes("radhya")) {
        console.log(`⏭️ Admin message ignored (no Radhya trigger): "${text.substring(0, 60)}"`);
        res.sendStatus(200);
        return; // Silently ignore — bot does not reply
      }
      // Radhya mentioned → trainer mode active
      if (!adminTrainerActive) {
        adminTrainerActive = true;
        console.log(`🔓 Admin trainer mode ACTIVATED`);
        await sendText(phone, `Trainer mode activated. Main sun rahi hoon Radhya ke roop mein. Instruction dijiye.`);
        return;
      }
      // Already in trainer mode — accept instruction
      const instruction = text.replace(/radhya[,.]?\s*/i, "").trim();
      
      // Check for enable auto command
      if (instruction.toLowerCase().includes("enable auto")) {
        const match = instruction.match(/(\d{10,})/);
        if (match) {
          const targetPhone = match[1];
          manualOnlyChats.delete(targetPhone);
          console.log(`🤖 AUTO MODE ENABLED for ${targetPhone}`);
          await sendText(phone, `Auto mode enabled for ${targetPhone}. Bot will now respond to their messages.`);
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

    const isNewLead  = isMetaLead(text);
    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;
    const followupData = !hasHistory && !isNewLead ? await isInFollowupSent(phone) : null;

    if (!isNewLead && !hasHistory && !followupData) {
      console.log(`⏭️ Ignored: ${phone}`);
      return;
    }

    if (hasMedia && !text) {
      await sendText(phone, "Text mein likhein please.");
      return;
    }

    // Update last message time, reset nudge
    lastMessageTime.set(phone, Date.now());
    nudgeSent.set(phone, false);

    // ── CHECK IF MANUAL MODE ───────────────────────────────────
    if (manualOnlyChats.has(phone)) {
      console.log(`📝 MANUAL MODE: ${phone} — bot will not respond. Garima handles this manually.`);
      // Just update the sheet with the message, don't reply
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
      return; // Exit — no bot reply
    }
    if (isNewLead) {
      const lead = isAdDM(text) ? {} : extractLeadDetails(text);
      const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      const source = isAdDM(text) ? "Ad DM" : "Meta Form";

      console.log(`🎯 NEW LEAD: ${firstName || "unknown"} | ${phone} | ${source}`);

      await addActiveLead(phone, firstName, lead.wedding, lead.city, source, "🆕 New Lead", text);

      // Send menu
      await new Promise(r => setTimeout(r, 2000));
      await sendMenuButtons(phone);
      pendingMenuSelect.add(phone);

      // Store lead info for when they select
      conversations.set(phone, []);
      addToHistory(phone, "assistant", MENU_TEXT_FALLBACK);
      return;
    }

    // ── MENU SELECTION ─────────────────────────────────────────
    if (pendingMenuSelect.has(phone)) {
      const selection = isInteractive
        ? (interactiveId || "")
        : detectMenuSelection(text);

      if (selection && ["A","B","C","D"].includes(selection)) {
        pendingMenuSelect.delete(phone);
        customerPath.set(phone, selection);

        const existingHistory = getHistory(phone);
        const storedLead = { name: "", wedding: "", city: "" };

        console.log(`✅ PATH ${selection} selected by ${phone}`);

        const pathLabels = {
          "A": "Pre-Bridal Package",
          "B": "Pre Bridal+Makeup",
          "C": "Hydra Package",
          "D": "Other Services",
        };
        await updateActiveLead(phone, {
          status: `📂 ${pathLabels[selection]}`,
          servicePath: pathLabels[selection],
        });

        const contextMsg = buildPathContext(selection, storedLead.name, storedLead.wedding, storedLead.city, text);
        const reply = await getAIReply(phone, contextMsg);
        const parts = reply.split("|").map(p => p.trim()).filter(Boolean).slice(0, 3);

        await new Promise(r => setTimeout(r, 3000));
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 1800));
          await sendText(phone, parts[i]);
          lastSentMessage.set(phone, parts[i]);
        }
        return;
      } else {
        // Couldn't detect selection — gently re-prompt
        await sendText(phone, "Aap *A, B, C ya D* reply karein — main help kar sakti hoon 😊");
        return;
      }
    }

    // ── FOLLOWUP LEAD ──────────────────────────────────────────
    let contextMsg = text;
    if (followupData) {
      const firstName = followupData.name ? followupData.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
      console.log(`📤 FOLLOWUP REPLY: ${firstName} (${phone})`);
      await markFollowupReplied(phone);
      await addActiveLead(phone, firstName, followupData.wedding, followupData.city, "Followup", "🆕 New Lead", text);
      contextMsg = `Customer replied to our outreach: "${text}"
Name: ${firstName || "not given"}, Wedding: ${followupData.wedding || "not mentioned"}, City: ${followupData.city || "not mentioned"}
INSTRUCTION: Greet warmly in polite English. Ask wedding date and area. Do NOT introduce yourself.`;
    }

    // ── EXISTING CONVERSATION ──────────────────────────────────
    const reply = await getAIReply(phone, contextMsg);
    const parts = reply.split("|").map(p => p.trim()).filter(Boolean).slice(0, 3);

    await new Promise(r => setTimeout(r, 5500));

    const lastSent = lastSentMessage.get(phone) || "";
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === lastSent && i === 0) continue;
      if (i > 0) await new Promise(r => setTimeout(r, 1800));
      await sendText(phone, parts[i]);
      lastSentMessage.set(phone, parts[i]);
    }

    // Extract wedding date from customer message and update sheet
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
    res.sendStatus(200); // Always respond 200 to WhatsApp even on error
  }
});

// ── ADMIN PANEL ───────────────────────────────────────────────
app.get("/admin", (req, res) => {
  const defaultMsg = `We have received your inquiry on our advertisement for Pre-Bridal Package. Please let us know your marriage date and location.\n\nRegards,\nBeauty Box Makeup Studio by Garima Nagpal`;
  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beauty Box Admin</title>
<style>*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,sans-serif}body{background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:16px}.container{display:flex;gap:16px;width:100%;max-width:900px;flex-wrap:wrap}.card{background:#fff;border-radius:16px;padding:28px 24px;flex:1;min-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.1)}h2{font-size:18px;font-weight:600;color:#111;margin-bottom:4px}p{font-size:13px;color:#888;margin-bottom:16px}label{font-size:13px;color:#444;display:block;margin:12px 0 5px;font-weight:500}input{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;margin-bottom:8px}input:focus{border-color:#128C7E}textarea{width:100%;padding:11px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;outline:none;resize:vertical;min-height:100px;line-height:1.6;font-family:-apple-system,sans-serif}textarea:focus{border-color:#128C7E}.hint{font-size:11px;color:#aaa;margin-top:4px}.msg{margin-top:14px;padding:11px;border-radius:10px;font-size:14px;text-align:center;display:none}.ok{background:#e8f5e9;color:#2e7d32}.err{background:#fdecea;color:#c62828}button{width:100%;background:#128C7E;color:#fff;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:500;cursor:pointer;margin-top:10px}button:hover{background:#0d6b65}button.secondary{background:#555;margin-top:8px}small{display:block;font-size:12px;color:#aaa;text-align:center;margin-top:12px;line-height:1.5}</style></head><body><div class="container"><div class="card"><h2>New Chat</h2><p>Send opening message and start bot</p><label>Phone number (with country code, no +)</label><input id="ph" type="tel" placeholder="919999999999"><label>Customer name (optional)</label><input id="nm" type="text" placeholder="Priya"><label>Opening message <span style="font-weight:400;color:#aaa">(editable)</span></label><textarea id="omsg">${defaultMsg}</textarea><div class="hint">Edit before sending. Bot takes over after customer replies.</div><label>Admin key</label><input id="ky" type="password" placeholder="Enter admin key"><button onclick="goNew(true)">Send Message &amp; Activate Bot</button><button class="secondary" onclick="goNew(false)">Activate Bot Only</button><div class="msg" id="msg1"></div><small>Bot handles all replies automatically.</small></div><div class="card"><h2>Reactivate Customer</h2><p>Load customer history & continue conversation</p><label>Customer phone (with country code, no +)</label><input id="rph" type="tel" placeholder="919999999999"><label>Follow-up message <span style="font-weight:400;color:#aaa">(optional)</span></label><textarea id="rmsg" placeholder="Warm message to re-engage customer...">Hi! Bas check kar rahi thi — kaise chal rahi hai shaadi ki tayaari?</textarea><div class="hint">Leave blank to just reactivate without sending message.</div><label>Admin key</label><input id="rky" type="password" placeholder="Enter admin key"><button onclick="goReactivate()">Reactivate &amp; Continue</button><div class="msg" id="msg2"></div><small>Bot will read their history and resume conversation.</small></div></div><script>async function goNew(sendMsg){const ph=document.getElementById('ph').value.trim();const nm=document.getElementById('nm').value.trim();const ky=document.getElementById('ky').value.trim();const om=document.getElementById('omsg').value.trim();if(!ph||!ky){sh('Enter phone and admin key','err','msg1');return;}try{const r=await fetch('/admin/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,name:nm,key:ky,openingMessage:sendMsg?om:'',sendMessage:sendMsg})});const d=await r.json();if(d.success){sh(sendMsg?'Sent to '+ph+'. Bot activated!':'Bot activated for '+ph,'ok','msg1');document.getElementById('ph').value='';document.getElementById('nm').value='';}else sh(d.error||'Error','err','msg1');}catch(e){sh('Network error','err','msg1');}}async function goReactivate(){const ph=document.getElementById('rph').value.trim();const ky=document.getElementById('rky').value.trim();const rmsg=document.getElementById('rmsg').value.trim();if(!ph||!ky){sh('Enter phone and admin key','err','msg2');return;}try{const r=await fetch('/admin/reactivate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:ph,key:ky,message:rmsg})});const d=await r.json();if(d.success){sh('✅ '+d.message,'ok','msg2');document.getElementById('rph').value='';document.getElementById('rmsg').value='';}else sh(d.error||'Error','err','msg2');}catch(e){sh('Network error','err','msg2');}}function sh(t,c,id){const el=document.getElementById(id);el.textContent=t;el.className='msg '+c;el.style.display='block';}document.getElementById('ky').addEventListener('keydown',e=>{if(e.key==='Enter')goNew(true);});document.getElementById('rky').addEventListener('keydown',e=>{if(e.key==='Enter')goReactivate();});</script></body></html>`);
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
      manualOnlyChats.add(phone); // Mark as manual mode — bot won't auto-reply
      lastMessageTime.set(phone, Date.now());
      nudgeSent.set(phone, false);
      await addActiveLead(phone, firstName, "", "", "Admin Initiated", "💬 Conversation Started", openingMsg);
      console.log(`🚀 ADMIN: Message sent for ${phone} — MANUAL MODE active`);
    } else {
      conversations.set(phone, []);
      addToHistory(phone, "assistant", "Admin activated this number.");
      manualOnlyChats.add(phone); // Mark as manual mode
      lastMessageTime.set(phone, Date.now());
      nudgeSent.set(phone, false);
      await addActiveLead(phone, firstName, "", "", "Admin Activated", "🆕 New Lead", "Manually activated");
      console.log(`📋 ADMIN: Activated ${phone} — MANUAL MODE active`);
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
    // Get customer data from Active Leads sheet
    const customerData = await getCustomerData(phone);
    if (!customerData) {
      return res.json({ success: false, error: "Customer not found in records" });
    }

    const firstName = customerData.name ? customerData.name.split(" ")[0] : "Customer";
    const servicePath = customerData.servicePath || "Unknown";

    console.log(`📞 REACTIVATING: ${firstName} (${phone}) | Path: ${servicePath}`);

    // Initialize conversation history (simulate resume)
    if (!conversations.has(phone)) {
      conversations.set(phone, []);
    }
    const history = getHistory(phone);
    
    // Add context about reactivation
    addToHistory(phone, "system", `[REACTIVATED] Previous path: ${servicePath}. Last status: ${customerData.status}`);

    // Remove from manual mode if they were there
    manualOnlyChats.delete(phone);

    // Track this phone for nudges
    lastMessageTime.set(phone, Date.now());
    nudgeSent.set(phone, false);

    // Send follow-up message if provided
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
    agent: "Beauty Box AI Agent v2.3",
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
    await sendText(ADMIN_PHONE, `🌅 Beauty Box Daily Report\n\n✅ Bot is running fine\n📊 Total leads: ${total}\n📅 New today: ${today}\n💬 Active conversations: ${conversations.size}\n🔔 Nudge tracking: ${lastMessageTime.size} leads\n\nCheck /admin for details.`);
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
  console.log(`\n🚀 Beauty Box Agent v2.3 on port ${PORT}`);
  console.log(`🔑 Claude:  ${ANTHROPIC_API_KEY ? "OK" : "MISSING"}`);
  console.log(`📱 WAPI:    ${WAPI_VENDOR_UID ? "OK" : "MISSING"}`);
  console.log(`🔐 Token:   ${WAPI_TOKEN ? "OK" : "MISSING"}`);
  console.log(`📊 Sheet ID: ${SHEET_ID ? "OK" : "MISSING"}`);
  console.log(`🔒 Admin:   /admin (key: ${ADMIN_KEY})`);
  await initSheets();
  scheduleDailyReport();
  scheduleNudgeCheck();
  console.log(`🔔 Nudge system: active (24h silence trigger)`);
  console.log(`📋 Menu system: active (A/B/C/D paths)`);
  console.log(`📍 Location extraction: active`);
  console.log(`♻️ Reactivate feature: active`);
  console.log(`✅ All systems ready\n`);
});
