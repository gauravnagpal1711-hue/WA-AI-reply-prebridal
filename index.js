const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// CONFIG
const PORT = process.env.PORT || 8080;
const WAPI_VENDOR_UID = process.env.WAPI_VENDOR_UID || "";
const WAPI_TOKEN = process.env.WAPI_TOKEN || "";
const SHEET_ID = process.env.SHEET_ID || "";
const PREBRIDAL_PDF_URL = process.env.PREBRIDAL_PDF_URL || "https://bit.ly/4fbKIox";
const BRIDAL_MAKEUP_PDF_URL = process.env.BRIDAL_MAKEUP_PDF_URL || "";
const ADMIN_PHONE = "919560277217";
const GARIMA_PHONE = "919354260517";
const STUDIO_ADDRESS = "H1/11, near Gurudwara, Vikaspuri, Delhi";
const INSTAGRAM_ID = "@garimanagpalmua";
const INSTAGRAM_URL = "https://www.instagram.com/garimanagpalmua/";

let sheetsClient;
let BOT_ACTIVE = false;

// MEMORY
const conversations = new Map();
const customerPath = new Map();
const customerState = new Map();
const customerData = new Map(); // Track collected data per customer
const pendingMenuSelect = new Set();

const MENU_TEXT_EN = `Welcome to Beauty Box Makeup Studio 💄

Which service would you like to know about?

*A* -- Pre-Bridal Package
*B* -- Pre-Bridal + Bridal Makeup Combo
*C* -- Hydra Facial Package
*D* -- Nail Services
*E* -- Other Beauty Services

Reply A, B, C, D or E`;

const MENU_TEXT_HI = `Welcome to Beauty Box Makeup Studio 💄

Aap kaunsi service ke baare mein jaanna chahti hain?

*A* -- Pre-Bridal Package
*B* -- Pre Bridal+ Bridal Makeup Combo
*C* -- Hydra Facial Package
*D* -- Nail Services
*E* -- Other Beauty Services

Reply A, B, C, D ya E karein`;

// ==================== INIT ====================

async function initSheets() {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS || "{}"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    sheetsClient = google.sheets({ version: "v4", auth });
    console.log("✅ Google Sheets connected");
  } catch (err) {
    console.error("❌ Sheets init error:", err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`\n🎉 BEAUTY BOX BOT v6.2 - STARTING`);
  console.log(`Port: ${PORT}`);
  console.log(`🔗 WAPI: Connected`);
  await initSheets();
  console.log(`📋 PDF: ${PREBRIDAL_PDF_URL}`);
  console.log(`💄 Studio: ${STUDIO_ADDRESS}`);
  console.log(`📸 Instagram: ${INSTAGRAM_ID}`);
  console.log(`✅ Ready for WhatsApp messages!\n`);
  BOT_ACTIVE = true;
});

// ==================== HELPERS ====================

function isHinglish(text) {
  const hinglishWords = ["kab", "kaunsa", "kya", "aap", "ho", "hai", "nahi", "haan", "bilkul", "theek", "mein", "ke", "se", "ko", "aur", "ya", "hum", "tum", "mere", "iska", "woh", "yeh", "agar", "to", "lekin", "shaadi"];
  const lower = text.toLowerCase();
  return hinglishWords.some(word => lower.includes(word));
}

function detectMenuSelection(text) {
  const t = (text || "").trim().toUpperCase();
  if (t === "A" || t === "1") return "A";
  if (t === "B" || t === "2") return "B";
  if (t === "C" || t === "3") return "C";
  if (t === "D" || t === "4") return "D";
  if (t === "E" || t === "5") return "E";
  return null;
}

function getHistory(phone) {
  if (!conversations.has(phone)) {
    conversations.set(phone, []);
  }
  return conversations.get(phone);
}

// ==================== WAPI FUNCTIONS ====================

async function sendText(toPhone, text, retries = 2) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, {
      phone_number: toPhone,
      message_body: text,
      message_type: "text",
    });
    console.log(`✅ Text sent to ${toPhone}`);
  } catch (err) {
    const status = err?.response?.status;
    console.error(`❌ Send failed (Status ${status}): ${err?.response?.data?.message || err.message}`);
    
    if ((status === 503 || status === 429) && retries > 0) {
      console.log(`⏳ Retrying in 2 seconds... (${retries} retries left)`);
      await new Promise(r => setTimeout(r, 2000));
      return sendText(toPhone, text, retries - 1);
    }
  }
}

async function sendPDF(toPhone, pdfUrl, caption, retries = 2) {
  try {
    const url = `https://panel.wapi.in.net/api/${WAPI_VENDOR_UID}/contact/send-message?token=${WAPI_TOKEN}`;
    await axios.post(url, {
      phone_number: toPhone,
      message_type: "media",
      media: {
        url: pdfUrl,
        type: "document",
        caption: caption || "",
      },
    });
    console.log(`✅ PDF sent to ${toPhone}`);
  } catch (err) {
    const status = err?.response?.status;
    console.error(`❌ PDF failed (Status ${status}): ${err?.response?.data?.message || err.message}`);
    
    if ((status === 503 || status === 429) && retries > 0) {
      console.log(`⏳ Retrying PDF in 2 seconds... (${retries} retries left)`);
      await new Promise(r => setTimeout(r, 2000));
      return sendPDF(toPhone, pdfUrl, caption, retries - 1);
    }
    
    await sendText(toPhone, `PDF: ${pdfUrl}`);
  }
}

// ==================== GOOGLE SHEETS ====================

async function findRow(sheetName, phone) {
  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:A`,
    });
    const rows = res.data.values || [];
    const row = rows.findIndex(r => r[0] && r[0].toString().includes(phone.replace(/\D/g, "")));
    return row >= 0 ? row + 1 : -1;
  } catch (err) {
    console.error("❌ findRow error:", err.message);
    return -1;
  }
}

async function addActiveLead(phone, name, source, firstMsg) {
  if (!sheetsClient) return;
  try {
    const row = await findRow("Active Leads", phone);
    if (row >= 1) {
      console.log(`📌 Lead exists at row ${row}`);
      return;
    }

    const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const values = [
      [
        phone,
        name || "Unknown",
        "",
        "",
        "WhatsApp",
        "New Lead",
        firstMsg || "Initial",
        now,
        now,
        "",
        "",
      ],
    ];

    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "Active Leads!A:K",
      valueInputOption: "RAW",
      resource: { values },
    });
    console.log(`✅ Lead added to Sheets: ${phone}`);
  } catch (err) {
    console.error("❌ addActiveLead error:", err.message);
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
    
    const current = res.data.values?.[0] || [];
    const updated = [...current];

    if (updates.weddingDate) updated[2] = updates.weddingDate;
    if (updates.serviceDate) updated[2] = updates.serviceDate;
    if (updates.location) updated[3] = updates.location;
    if (updates.servicePath) updated[9] = updates.servicePath;
    if (updates.status) updated[5] = updates.status;
    if (updates.lastMsg) updated[6] = updates.lastMsg;
    updated[8] = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Active Leads!A${row}:K${row}`,
      valueInputOption: "RAW",
      resource: { values: [updated] },
    });
    console.log(`📊 Sheet updated for ${phone}`);
  } catch (err) {
    console.error("❌ updateActiveLead error:", err.message);
  }
}

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
    const isOn = val.toString().trim().toLowerCase() === "yes" || val.toString().trim() === "" || val.toString().trim().toLowerCase() === "y";
    
    console.log(`🔍 Bot Intervention for ${phone}: ${isOn ? "✅ ON" : "❌ OFF"}`);
    return isOn;
  } catch (err) {
    return true;
  }
}

// ==================== WEBHOOK PARSING ====================

function parseWebhook(body) {
  try {
    console.log("🔍 Parsing payload:", JSON.stringify(body).substring(0, 150));
    
    if (body?.contact?.phone_number || body?.data?.contact?.phone_number) {
      const phone = body?.contact?.phone_number || body?.data?.contact?.phone_number || "";
      const text = body?.message?.body || body?.data?.message?.body || "";
      const name = body?.contact?.first_name || body?.data?.contact?.first_name || null;

      console.log(`✅ WAPI format - Phone: ${phone}, Text: ${text.substring(0, 50)}`);
      return { phone, name, text, hasMedia: false };
    }

    console.log("❌ Could not parse payload");
    return null;
  } catch (e) {
    console.error("❌ Parse error:", e.message);
    return null;
  }
}

// ==================== WEBHOOK HANDLER ====================

app.post("/webhook", async (req, res) => {
  try {
    console.log("\n📨 WEBHOOK REQUEST RECEIVED");
    
    const parsed = parseWebhook(req.body);
    if (!parsed?.phone) {
      console.log("⏭️ No phone found in payload");
      return res.sendStatus(200);
    }

    const { phone, name, text } = parsed;
    if (!text || text.trim() === "") {
      console.log("⏭️ No text in message");
      return res.sendStatus(200);
    }

    console.log(`📱 [${new Date().toLocaleTimeString()}] ${phone}: "${text.substring(0, 60)}"`);

    // Skip admin
    if (phone.replace(/\D/g, "").endsWith("9560277217")) {
      console.log("🔐 Admin message - skipping");
      return res.sendStatus(200);
    }

    if (!BOT_ACTIVE) {
      console.log("⛔ BOT_ACTIVE = false");
      return res.sendStatus(200);
    }

    const hasHistory = conversations.has(phone) && getHistory(phone).length > 0;
    const isExactTrigger = text.trim().toLowerCase() === "Hello! Can I get more info on this?".toLowerCase();
    const selection = detectMenuSelection(text);

    // ==================== MENU SELECTION ====================
    if (pendingMenuSelect.has(phone) && selection) {
      console.log(`📋 PATH ${selection}: ${phone}`);
      pendingMenuSelect.delete(phone);
      customerPath.set(phone, selection);
      const useHinglish = isHinglish(text);
      customerState.set(phone, { stage: "intro", useHinglish });
      customerData.set(phone, {});

      await new Promise(r => setTimeout(r, 500));

      // PATH A: PRE-BRIDAL
      if (selection === "A") {
        const msg1 = "Sharing complete pre-bridal offer details in PDF below 👇";
        await sendText(phone, msg1);
        await new Promise(r => setTimeout(r, 1500));
        await sendPDF(phone, PREBRIDAL_PDF_URL, "Pre-Bridal Package Details");
        await new Promise(r => setTimeout(r, 2000));
        const msg2 = useHinglish ? "Aapki shaadi kab hai?" : "When is your marriage?";
        await sendText(phone, msg2);
        customerState.set(phone, { stage: "waiting_date_a", useHinglish });
        await updateActiveLead(phone, { status: "Path A - Waiting for Wedding Date", servicePath: "A" });
        return res.sendStatus(200);
      }

      // PATH B: PRE-BRIDAL + BRIDAL
      else if (selection === "B") {
        const msg1 = "Sharing complete pre-bridal & bridal makeup offer details in PDF below 👇";
        await sendText(phone, msg1);
        await new Promise(r => setTimeout(r, 1500));
        await sendPDF(phone, PREBRIDAL_PDF_URL, "Pre-Bridal Package");
        if (BRIDAL_MAKEUP_PDF_URL) {
          await new Promise(r => setTimeout(r, 1500));
          await sendPDF(phone, BRIDAL_MAKEUP_PDF_URL, "Bridal Makeup Details");
        }
        await new Promise(r => setTimeout(r, 1500));
        const msg2 = useHinglish ? "Aapki shaadi kab hai?" : "When is your marriage?";
        await sendText(phone, msg2);
        customerState.set(phone, { stage: "waiting_date_b", useHinglish });
        await updateActiveLead(phone, { status: "Path B - Waiting for Wedding Date", servicePath: "B" });
        return res.sendStatus(200);
      }

      // PATH C: HYDRA FACIAL
      else if (selection === "C") {
        const msg = useHinglish
          ? `💧 *Hydra Facial Special Offer:*\n\n• Single Sitting: Rs.1,199\n• 3-Sitting Combo: Rs.2,999 (Recommended)\n\nKab service lena chahti ho?`
          : `💧 *Hydra Facial Special Offer:*\n\n• Single Sitting: Rs.1,199\n• 3-Sitting Combo: Rs.2,999 (Recommended)\n\nWhen would you like to take the service?`;
        await sendText(phone, msg);
        customerState.set(phone, { stage: "waiting_date_c", useHinglish });
        await updateActiveLead(phone, { status: "Path C - Waiting for Service Date", servicePath: "C" });
        return res.sendStatus(200);
      }

      // PATH D: NAIL SERVICES
      else if (selection === "D") {
        const msg = `💅 *Nail Services*\n\nStarting from Rs.399 onwards\n\nDesign options available:\n• French\n• Ombre\n• Glitter\n• Bridal Designs\n• Custom Designs`;
        await sendText(phone, msg);
        await new Promise(r => setTimeout(r, 1500));
        const msg2 = useHinglish ? "Kab visit kar sakte ho?" : "When would you like to visit?";
        await sendText(phone, msg2);
        customerState.set(phone, { stage: "waiting_date_d", useHinglish });
        await updateActiveLead(phone, { status: "Path D - Waiting for Service Date", servicePath: "D" });
        return res.sendStatus(200);
      }

      // PATH E: OTHER BEAUTY SERVICES
      else if (selection === "E") {
        const msg = useHinglish
          ? "Aap kaunsi beauty service lena chahti hain?\n\n(Facials, Hair Care, Waxing, Bleach, Threading, etc.)"
          : "Which beauty service are you interested in?\n\n(Facials, Hair Care, Waxing, Bleach, Threading, etc.)";
        await sendText(phone, msg);
        customerState.set(phone, { stage: "waiting_service_e", useHinglish });
        await updateActiveLead(phone, { status: "Path E - Waiting for Service", servicePath: "E" });
        return res.sendStatus(200);
      }
    }

    // ==================== NEW LEAD ====================
    if (!hasHistory && isExactTrigger) {
      console.log(`🎯 NEW LEAD: ${phone}`);
      const firstName = name ? name.split(" ")[0] : "Unknown";
      const useHinglish = isHinglish(text);
      
      await addActiveLead(phone, firstName, "WhatsApp", text);
      conversations.set(phone, []);
      await new Promise(r => setTimeout(r, 1000));
      
      const menuText = useHinglish ? MENU_TEXT_HI : MENU_TEXT_EN;
      await sendText(phone, menuText);
      pendingMenuSelect.add(phone);
      
      console.log(`🗣️ Customer language: ${useHinglish ? "Hinglish" : "English"}`);
      return res.sendStatus(200);
    }

    // ==================== CONTINUING CONVERSATION ====================
    if (hasHistory) {
      console.log(`💬 Continuing conversation: ${phone}`);

      // CHECK BOT INTERVENTION
      const canReply = await checkBotIntervention(phone);
      if (!canReply) {
        console.log(`🔕 Bot Intervention OFF - SILENT`);
        return res.sendStatus(200);
      }

      const lower = text.toLowerCase().trim();
      const selection = customerPath.get(phone);
      const state = customerState.get(phone) || {};
      const data = customerData.get(phone) || {};

      // Check for Instagram/Location requests FIRST
      if (lower.includes("instagram") || lower.includes("insta") || lower.includes("follow")) {
        console.log(`📸 Instagram request`);
        await new Promise(r => setTimeout(r, 500));
        const instaMsg = `Follow us! 💄\n\n${INSTAGRAM_ID}\n${INSTAGRAM_URL}`;
        await sendText(phone, instaMsg);
        // Then ask the next question
        await new Promise(r => setTimeout(r, 1000));
        const useHinglish = state.useHinglish;
        
        if (["A", "B", "C", "D"].includes(selection) && !data.date) {
          const dateQ = (selection === "A" || selection === "B") 
            ? (useHinglish ? "Aapki shaadi kab hai?" : "When is your marriage?")
            : (useHinglish ? "Kab visit kar sakte ho?" : "When would you like to visit?");
          await sendText(phone, dateQ);
        }
        
        return res.sendStatus(200);
      }

      if (lower.includes("location") || lower.includes("address") || lower.includes("kahan") || lower.includes("studio") || lower.includes("where")) {
        console.log(`📍 Location request`);
        await new Promise(r => setTimeout(r, 500));
        const locMsg = `*Studio Address:*\n${STUDIO_ADDRESS}\n\n🚇 Near: Janakpuri West Metro Station`;
        await sendText(phone, locMsg);
        // Then ask the next question
        await new Promise(r => setTimeout(r, 1000));
        const useHinglish = state.useHinglish;
        
        if (["A", "B", "C", "D"].includes(selection) && !data.location) {
          const locQ = useHinglish ? "Aap kaunse area se ho?" : "Which area are you from?";
          await sendText(phone, locQ);
        }
        
        return res.sendStatus(200);
      }

      // PATH A & B: COLLECT DATE AND LOCATION
      if (selection === "A" || selection === "B") {
        if (state.stage === "waiting_date_a" || state.stage === "waiting_date_b") {
          console.log(`📅 Received date for path ${selection}`);
          data.date = text;
          customerData.set(phone, data);
          await new Promise(r => setTimeout(r, 500));
          const useHinglish = state.useHinglish;
          const locQ = useHinglish ? "Aap kaunse area se ho?" : "Which area are you from?";
          await sendText(phone, locQ);
          const newStage = selection === "A" ? "waiting_location_a" : "waiting_location_b";
          customerState.set(phone, { stage: newStage, useHinglish });
          await updateActiveLead(phone, { weddingDate: text, lastMsg: text, status: `Path ${selection} - Waiting for Location` });
          return res.sendStatus(200);
        }

        if (state.stage === "waiting_location_a" || state.stage === "waiting_location_b") {
          console.log(`📌 Received location for path ${selection}`);
          data.location = text;
          customerData.set(phone, data);
          customerState.set(phone, { stage: "done" });
          await updateActiveLead(phone, { location: text, lastMsg: text, status: `Path ${selection} - Complete` });
          console.log(`✅ Path ${selection} complete - conversation ended`);
          return res.sendStatus(200);
        }
      }

      // PATH C: COLLECT DATE AND LOCATION
      if (selection === "C") {
        if (state.stage === "waiting_date_c") {
          console.log(`📅 Received date for path C`);
          data.date = text;
          customerData.set(phone, data);
          await new Promise(r => setTimeout(r, 500));
          const useHinglish = state.useHinglish;
          const locQ = useHinglish ? "Aap kaunse area se ho?" : "Which area are you from?";
          await sendText(phone, locQ);
          customerState.set(phone, { stage: "waiting_location_c", useHinglish });
          await updateActiveLead(phone, { serviceDate: text, lastMsg: text, status: "Path C - Waiting for Location" });
          return res.sendStatus(200);
        }

        if (state.stage === "waiting_location_c") {
          console.log(`📌 Received location for path C`);
          data.location = text;
          customerData.set(phone, data);
          customerState.set(phone, { stage: "done" });
          await updateActiveLead(phone, { location: text, lastMsg: text, status: "Path C - Complete" });
          console.log(`✅ Path C complete - conversation ended`);
          return res.sendStatus(200);
        }
      }

      // PATH D: COLLECT DATE AND LOCATION
      if (selection === "D") {
        if (state.stage === "waiting_date_d") {
          console.log(`📅 Received date for path D`);
          data.date = text;
          customerData.set(phone, data);
          await new Promise(r => setTimeout(r, 500));
          const useHinglish = state.useHinglish;
          const locQ = useHinglish ? "Aap kaunse area se ho?" : "Which area are you from?";
          await sendText(phone, locQ);
          customerState.set(phone, { stage: "waiting_location_d", useHinglish });
          await updateActiveLead(phone, { serviceDate: text, lastMsg: text, status: "Path D - Waiting for Location" });
          return res.sendStatus(200);
        }

        if (state.stage === "waiting_location_d") {
          console.log(`📌 Received location for path D`);
          data.location = text;
          customerData.set(phone, data);
          customerState.set(phone, { stage: "done" });
          await updateActiveLead(phone, { location: text, lastMsg: text, status: "Path D - Complete" });
          console.log(`✅ Path D complete - conversation ended`);
          return res.sendStatus(200);
        }
      }

      // PATH E: COLLECT SERVICE, DATE, AND LOCATION
      if (selection === "E") {
        if (state.stage === "waiting_service_e") {
          console.log(`💅 Received service: ${text}`);
          data.service = text;
          customerData.set(phone, data);
          await new Promise(r => setTimeout(r, 500));
          const useHinglish = state.useHinglish;
          const dateQ = useHinglish ? "Kab service lena chahti ho?" : "When would you like to take the service?";
          await sendText(phone, dateQ);
          customerState.set(phone, { stage: "waiting_date_e", useHinglish });
          await updateActiveLead(phone, { lastMsg: text, status: `Path E - Service: ${text} - Waiting for Date` });
          return res.sendStatus(200);
        }

        if (state.stage === "waiting_date_e") {
          console.log(`📅 Received date for path E`);
          data.date = text;
          customerData.set(phone, data);
          await new Promise(r => setTimeout(r, 500));
          const useHinglish = state.useHinglish;
          const locQ = useHinglish ? "Aap kaunse area se ho?" : "Which area are you from?";
          await sendText(phone, locQ);
          customerState.set(phone, { stage: "waiting_location_e", useHinglish });
          await updateActiveLead(phone, { serviceDate: text, lastMsg: text, status: "Path E - Waiting for Location" });
          return res.sendStatus(200);
        }

        if (state.stage === "waiting_location_e") {
          console.log(`📌 Received location for path E`);
          data.location = text;
          customerData.set(phone, data);
          customerState.set(phone, { stage: "done" });
          await updateActiveLead(phone, { location: text, lastMsg: text, status: "Path E - Complete" });
          console.log(`✅ Path E complete - conversation ended`);
          return res.sendStatus(200);
        }
      }

      // OTHERWISE STAY SILENT
      console.log(`🤐 Unexpected message - staying silent`);
      return res.sendStatus(200);
    }

    // Ignore messages without history or trigger
    console.log(`⏭️ IGNORED: No history, no trigger, no selection`);
    return res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ==================== TEST ENDPOINT ====================

app.get("/test-webhook", (req, res) => {
  console.log("🧪 TEST WEBHOOK RECEIVED!");
  res.json({ status: "Bot is working", time: new Date() });
});

app.get("/", (req, res) => {
  res.json({ status: "Beauty Box Bot v6.2 - Active" });
});

module.exports = app;
