const express = require("express");
const axios = require("axios");
const path = require("path");
const { google } = require("googleapis");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── CONFIG ──────────────────────────────────────────────────────
function normalizePhone(phone) {
  return (phone || "").replace(/\D/g, "");
}

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const WAPI_VENDOR_UID = process.env.WAPI_VENDOR_UID || "";
const WAPI_TOKEN = process.env.WAPI_TOKEN || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "beautybox2024";
const SHEET_ID = process.env.SHEET_ID || "";
const ADMIN_PHONE = "919560277217";
const VERIFY_TOKEN = "beautybox_verify_2024";

let sheetsClient = null;

// ── GOOGLE SHEETS ────────────────────────────────────────────────
async function initSheets() {
  try {
    if (!process.env.GOOGLE_CREDENTIALS || !SHEET_ID) {
      console.log("⚠️ Google Sheets disabled");
      return;
    }
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
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
  if (!sheetsClient) return;
  try {
    const headers = ["Phone", "Name", "Wedding Date", "City/Area", "Source", "Status", "Last Message", "First Seen", "Last Updated", "Service Path", "Bot Intervention"];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A1:K1",
      valueInputOption: "RAW",
      resource: { values: [headers] },
    });
    console.log("📋 Headers verified");
  } catch (err) {
    console.log("⚠️ Header setup skipped");
  }
}

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
      botIntervention: current[10] || "YES",
    };
  } catch (err) {
    return null;
  }
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
      if (rows[i][0]) {
        const rowPhone = rows[i][0].toString().replace(/\D/g, "");
        const searchPhone = phone.replace(/\D/g, "");
        if (rowPhone.endsWith(searchPhone) || searchPhone.endsWith(rowPhone)) {
          return i + 1;
        }
      }
    }
    return -1;
  } catch (err) {
    return -1;
  }
}

async function addActiveLead(phone, name, wedding, city, source) {
  if (!sheetsClient) return;
  try {
    const existing = await findRow("Active Leads", phone);
    if (existing > 0) return;
    
    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A:K",
      valueInputOption: "RAW",
      resource: {
        values: [[phone, name || "", wedding || "", city || "", source || "Meta", "🆕 New", "", now, now, "", "YES"]],
      },
    });
    console.log(`✅ Lead added: ${phone}`);
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
    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    
    const updated = [
      current[0] || phone,
      updates.name || current[1] || "",
      updates.wedding || current[2] || "",
      updates.city || current[3] || "",
      current[4] || "",
      updates.status || current[5] || "💬 Active",
      (updates.lastMsg || current[6] || "").substring(0, 200),
      current[7] || now,
      now,
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

// ── CONVERSATION MEMORY ──────────────────────────────────────────
const conversations = new Map();
const pendingMenuSelect = new Set();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  const h = conversations.get(phone);
  if (h.length > 5) return h.slice(-5);
  return h;
}

function addToHistory(phone, role, content) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  const h = conversations.get(phone);
  if (h.length > 0 && h[h.length - 1].role === role && h[h.length - 1].content === content) return;
  h.push({ role, content });
  if (h.length > 20) h.splice(0, h.length - 20);
}

// ── MENU ─────────────────────────────────────────────────────────
const MENU_TEXT = `Welcome to Beauty Box Makeup Studio 💄

What service are you interested in?

*A* — Beauty and Hair Services
*B* — Hydra Facial Package
*C* — Pre-Bridal Package
*D* — Pre Bridal+ Bridal Makeup Combo
*E* — Nail Services

Please reply A, B, C, D or E`;

function detectMenuSelection(text) {
  const t = (text || "").trim().toUpperCase();
  if (t === "A" || t.includes("BEAUTY") || t.includes("HAIR")) return "A";
  if (t === "B" || t.includes("HYDRA")) return "B";
  if (t === "C" || t.includes("BRIDAL")) return "C";
  if (t === "D" || t.includes("COMBO")) return "D";
  if (t === "E" || t.includes("NAIL")) return "E";
  return null;
}

async function sendMenu(phone) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, {
      phone_number: phone,
      message_type: "interactive",
      interactive: {
        type: "list",
        body: { text: "Welcome to Beauty Box Makeup Studio 💄\n\nWhat service are you interested in?" },
        action: {
          button: "Choose Service",
          sections: [{
            title: "Beauty Box Services",
            rows: [
              { id: "A", title: "Beauty and Hair", description: "Facials, waxing, hair care" },
              { id: "B", title: "Hydra Facial", description: "Deep skin hydration" },
              { id: "C", title: "Pre-Bridal", description: "12 services, 3 sittings" },
              { id: "D", title: "Pre Bridal+ Makeup", description: "Complete bridal package" },
              { id: "E", title: "Nail Services", description: "₹499 launch offer" }
            ]
          }]
        }
      }
    });
    console.log(`📋 Menu sent to ${phone}`);
  } catch (err) {
    console.error("Menu send failed");
    await sendText(phone, MENU_TEXT);
  }
}

// ── SEND TEXT ────────────────────────────────────────────────────
async function sendText(phone, text) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, { 
      phone_number: phone, 
      message_body: text, 
      message_type: "text" 
    });
    console.log(`✅ Sent to ${phone}`);
  } catch (err) {
    console.error(`❌ Send failed for ${phone}`);
  }
}

// ── COMPLETE SYSTEM PROMPT ──────────────────────────────────────
const SYSTEM_PROMPT = `You are Radhya (AI bot), a professional skin specialist at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi (near Janakpuri West Metro).

═══ LANGUAGE RULE ═══
Start conversations in ENGLISH. If customer replies in Hindi/Hinglish → SWITCH to Hinglish. If English → CONTINUE English. Match their preference.

═══ CRITICAL RULES (NEVER BREAK) ═══
R1. MESSAGE LENGTH: Keep MAXIMUM 2-3 lines. NO long paragraphs.
R2. NO REPETITION: Never ask the same question twice in conversation.
R3. ONE IDEA PER MESSAGE: Don't mix answer + question + explanation.
R4. ANSWER FIRST: Answer their question BEFORE asking next question.
R5. TONE: Warm, natural, professional. NO fake enthusiasm ("Amazing!", "Wow!"), NO scripted phrases.

═══ PATH A: BEAUTY & HAIR SERVICES ═══
Services: Facials, waxing, hair care
Flow: Ask which service → Share relevant price → Offer booking
Prices: Hair spa Rs.799, Facial Rs.549-2,199, Waxing Rs.199-1,999, D-Tan Rs.499, Hair cut Rs.149-249, Nanoplastia Rs.2,499, Manicure/Pedicure Rs.349, Full Body Polishing Rs.1,999, Threading Rs.30, Upper lips Rs.20-50

═══ PATH B: HYDRA FACIAL PACKAGE ═══
For: Skin hydration, dark circles, dryness, dullness
Flow: 1) Ask skin concern 2) Explain benefit (personalized) 3) Share pricing 4) Ask when to start
Pricing: Single Rs.999 / 3-Sitting Package Rs.2,799 (Rs.933 per sitting)
Key: Natural, conversational, 2-3 lines per message

═══ PATH C: PRE-BRIDAL PACKAGE ═══
For: Wedding within 1-2 months
12 Services in 3 Sittings: O3+ Facial (x2), Bleach/D-Tan (x2), Full Body Bleach, Full Body Wax, Full Body Polishing, Hair Spa, Manicure, Pedicure, Nail Extension, Face Bleach, Threading & Upper Lips
Price: Rs.7,499 (saves Rs.6,351 vs individual)
Flow: Ask wedding date → Share package → Confirm booking

═══ PATH D: PRE-BRIDAL + BRIDAL MAKEUP COMBO ═══
Pre-Bridal: Rs.7,499 (12 services, 3 sittings)
Bridal Makeup: Rs.11,000 (Waterproof, HD finish, soft glam, lashes, draping, hairstyle)
Combo Total: Rs.16,500 (saves Rs.1,999)
Flow: Share combo naturally → Ask wedding date → Confirm

═══ PATH E: NAIL SERVICES ═══
Offer: Rs.499 for ANY nail service (normal Rs.1,200-1,500)
Staff: Professional nail team (not Garima personally)
Flow: Ask nail service type (extension, polish, etc.) → Share offer → Ask location → Offer studio visit

═══ METRO TIMES (ONLY IF ASKED) ═══
From Janakpuri West Metro: Dwarka 15min, CP 25min, South Delhi 35min

═══ SPECIAL SCENARIOS ═══
HOME VISIT: "We serve at studio only. Can you visit?"
FAMILY APPROVAL: "Absolutely, discuss with family and decide 😊"
STILL THINKING: "No pressure. I'm here whenever you're ready"
WEDDING FAR AWAY (6+ months): Suggest Hydra Facial package Rs.2,799 for skincare prep
NOT INTERESTED: Acknowledge genuinely, offer to help anytime

═══ TONE & PERSONALITY ═══
✓ Warm, natural, professional - like a friend who's an expert
✓ Short messages (2-3 lines typical)
✓ Always end with question or next step
✓ No pressure - build trust through honesty
✓ Acknowledge concerns genuinely
✓ Personalize when possible

═══ IMPORTANT ═══
- This is an AI bot (Radhya AI bot)
- Short, efficient responses
- Check history before asking anything
- One idea per message
- Build trust through honest communication
- Metro info: Vikaspuri, near Janakpuri West Metro Station`;

// ── CLAUDE API ───────────────────────────────────────────────────
async function getAIReply(phone, msg) {
  addToHistory(phone, "user", msg);
  try {
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
    const reply = res.data.content?.[0]?.text || "One moment.";
    addToHistory(phone, "assistant", reply);
    return reply;
  } catch (err) {
    console.error("Claude API error:", err.message);
    return "One moment.";
  }
}

// ── WEBHOOK PARSING ─────────────────────────────────────────────
function parseWebhook(body) {
  try {
    const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (messages?.length > 0) {
      const msg = messages[0];
      const phone = msg?.from || "";
      let text = msg?.text?.body || "";
      
      if (msg?.type === "interactive") {
        const id = msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || "";
        text = id;
      }
      
      return { phone, text };
    }
    return null;
  } catch (e) {
    return null;
  }
}

// ── META DETECTION ───────────────────────────────────────────────
function isMetaLead(text) {
  const lower = (text || "").toLowerCase();
  return lower.includes("i filled in your form") || 
         lower.includes("more info on this") ||
         lower.includes("form");
}

function extractLeadDetails(text) {
  const d = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.substring(0, idx).toLowerCase();
    const val = line.substring(idx + 1).trim();
    if (key.includes("name")) d.name = val;
    if (key.includes("wedding")) d.wedding = val;
    if (key.includes("city")) d.city = val;
  }
  return d;
}

// ── WEBHOOK HANDLER ─────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  try {
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone || !parsed.text) {
      return res.sendStatus(200);
    }

    const phone = normalizePhone(parsed.phone);
    const text = parsed.text.trim();

    // Admin commands
    if (phone === normalizePhone(ADMIN_PHONE)) {
      console.log("📲 Admin message received");
      return res.sendStatus(200);
    }

    // Check if customer in Google Sheet
    const customerData = await getCustomerData(phone);
    const isNew = isMetaLead(text);

    // Unknown number + not a Meta lead = ignore
    if (!customerData && !isNew) {
      console.log(`⏭️ Ignored (unknown): ${phone}`);
      return res.sendStatus(200);
    }

    // If in sheet with Bot Intervention = YES, stay silent
    if (customerData && customerData.botIntervention === "YES") {
      console.log(`📝 Manual mode: ${phone} - bot silent`);
      addToHistory(phone, "user", text);
      await updateActiveLead(phone, { lastMsg: text });
      return res.sendStatus(200);
    }

    // NEW LEAD (from Meta/Ad)
    if (isNew) {
      console.log(`🎯 New lead: ${phone}`);
      const lead = extractLeadDetails(text);
      await addActiveLead(phone, lead.name || "", lead.wedding || "", lead.city || "", "Meta");
      
      await new Promise(r => setTimeout(r, 500));
      await sendMenu(phone);
      pendingMenuSelect.add(phone);
      conversations.delete(phone);
      addToHistory(phone, "assistant", MENU_TEXT);
      return res.sendStatus(200);
    }

    // MENU SELECTION
    if (pendingMenuSelect.has(phone)) {
      const selection = detectMenuSelection(text);
      
      if (selection && ["A", "B", "C", "D", "E"].includes(selection)) {
        pendingMenuSelect.delete(phone);
        console.log(`✅ Path ${selection} selected by ${phone}`);
        
        await updateActiveLead(phone, { 
          status: `📂 Path ${selection}`,
          servicePath: `Path ${selection}`
        });

        const reply = await getAIReply(phone, `Customer selected service ${selection}. Help them with this service.`);
        const parts = reply.split("|").filter(p => p.trim()).slice(0, 2);

        await new Promise(r => setTimeout(r, 500));
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 300));
          await sendText(phone, parts[i].trim());
        }
        return res.sendStatus(200);
      }

      // Invalid selection
      await sendText(phone, "Please reply with A, B, C, D or E");
      return res.sendStatus(200);
    }

    // NORMAL CONVERSATION
    const reply = await getAIReply(phone, text);
    const parts = reply.split("|").filter(p => p.trim()).slice(0, 2);

    await new Promise(r => setTimeout(r, 500));
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300));
      await sendText(phone, parts[i].trim());
    }

    await updateActiveLead(phone, { lastMsg: text });
    res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(200);
  }
});

// ── WEBHOOK VERIFICATION (Facebook requirement) ──────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// ── HEALTH CHECK ─────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    bot: "Radhya (AI bot)",
    version: "v3.0 - Complete",
    status: "🟢 Online",
    features: [
      "English start + Hinglish adaptation",
      "Google Sheet filtering",
      "Menu A/B/C/D/E",
      "10-12s response",
      "Bot Intervention control"
    ]
  });
});

// ── STARTUP ──────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n${"═".repeat(50)}`);
  console.log(`🚀 Radhya (AI bot) v3.0 - COMPLETE & STABLE`);
  console.log(`${"═".repeat(50)}`);
  console.log(`✨ English start → Hinglish adaptation`);
  console.log(`📊 Google Sheet filtering active`);
  console.log(`⚡ Response time: 10-12 seconds`);
  console.log(`💚 Ready for production!\n`);
  await initSheets();
  console.log(`${"═".repeat(50)}\n`);
});

module.exports = app;
