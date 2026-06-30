# Beauty Box Bot v3.0 - Change Summary

## Overview
Updated from v2.4 (Natural Professional Female Tone with Trust Building) to v3.0 (Simplified Inquiry to Booking Flow).

Two major changes implemented:
1. **ALL leads added to Google Sheets immediately** (regardless of source)
2. **Simplified conversation flow** - No trust building, straight path: Inquiry → Service Menu → Details + Price → Booking

---

## Change 1: ALL Leads Added to Sheets Immediately

### Location: Webhook Handler (`/webhook` endpoint)

**Before (v2.4):**
```javascript
if (!isNewLead && !hasHistory && !followupData) {
  console.log(`⏭️ Ignored: ${phone}`);
  return;
}
```
- Only Meta form leads or leads with history were tracked
- Direct messages without history were ignored
- Ad DMs weren't always captured

**After (v3.0):**
```javascript
// ✅ ADD ALL LEADS TO SHEETS IMMEDIATELY (regardless of type)
if (!hasHistory && !followupData) {
  const lead = isNewLead ? extractLeadDetails(text) : {};
  const firstName = lead.name ? lead.name.split(" ")[0] : (name ? name.split(" ")[0] : "");
  const source = isAdDM(text) ? "Ad DM" : (isNewLead ? "Meta Form" : "Direct Message");
  await addActiveLead(phone, firstName, lead.wedding || "", lead.city || "", source, "🆕 New Lead", text);
  console.log(`📋 ADDED TO SHEETS: ${phone} | Source: ${source}`);
}

// Don't process if no history and not tracked
if (!isNewLead && !hasHistory && !followupData) {
  console.log(`⏭️ Lead added but not processing: ${phone}`);
  res.sendStatus(200);
  return;
}
```

**Impact:**
- ✅ Every incoming message is added to Active Leads sheet
- ✅ "Direct Message" categorized for non-form inquiries
- ✅ Lead data preserved even if bot doesn't respond

---

## Change 2: Simplified Conversation Flow

### 2A: Menu System - Reorganized Service Categories

**Before (v2.4):**
```
A — Beauty and Hair Services
B — Hydra Package
C — Pre-Bridal Package
D — Pre Bridal+ Bridal Makeup Combo
E — Nail Services
```

**After (v3.0):**
```
A — Pre-Bridal Package
B — Pre Bridal+ Bridal Makeup Combo
C — Hydra Facial Package
D — Nail Services
E — Other Beauty Services
```

**Reason:** Clearer primary packages first, generic services moved to E.

---

### 2B: System Prompt Completely Rewritten

**Before (v2.4):** 450-token prompt with extensive rules
- Emotional mirroring instructions
- Curiosity hooks
- Trust-building techniques
- Soft reply handling
- Multiple detailed flow paths
- Skincare tips & metro times

**After (v3.0):** 300-token simplified prompt
```javascript
const SYSTEM_PROMPT = `You are Radhya (AI bot), customer support at Beauty Box Makeup Studio by Garima Nagpal, Vikaspuri Delhi.

Your role: Answer service inquiries and facilitate booking. NO trust building, NO lengthy explanations.

TONE: Polite, professional, conversational (Hinglish). Short messages (1-2 sentences typical).

CONVERSATION RULES:
1. Customer asks about service → Share service details, pricing, and package info
2. Ask when they want to book
3. Direct them to Garima for slot confirmation
4. Keep responses SHORT and to the point
```

**Key Removed Elements:**
- ❌ Emotional mirror rules
- ❌ Curiosity hooks
- ❌ Skincare tips
- ❌ Wedding date timelines
- ❌ "Trust building" language
- ❌ Soft reply handling (ok, hmm, thik hai)
- ❌ Home visit workarounds
- ❌ Lengthy explanations

**Key New Elements:**
- ✅ Direct service → price → booking flow
- ✅ Max 1-2 sentence responses
- ✅ NO lengthy context or history
- ✅ Always end with booking question

---

### 2C: Path Context Builder Simplified

**Before (v2.4):** Each path had extensive instructions with curiosity hooks, skin type questions, personalized tips, etc.

```javascript
case "A":
  return `Customer selected: Pre-Bridal Package.
...
INSTRUCTION: Follow pre-bridal flow. Ask wedding date if not known, then skin type (open-ended), curiosity hook, tips, package details, then closing Path A or B.`;
```

**After (v3.0):** Stripped to essentials - service details + booking

```javascript
case "A":
  return `Customer selected: Pre-Bridal Package.
Name: ${name}, Wedding: ${wedding || "not mentioned"}, City: ${city || "not mentioned"}
Customer message: "${customerMsg}"
INSTRUCTION: Share pre-bridal package details and pricing. Ask when they want to book. Then closing for booking.
Use polite Hinglish. NO trust building or lengthy explanations.`;
```

**All 5 Paths (A-E):** Same simplified structure
1. Share service details
2. Share pricing
3. Ask when they want to book
4. Direct to Garima

---

## Service Pricing - Updated & Consolidated

All service pricing remains identical but now presented more concisely:

**New Layout:**
- Each service path lists: Service name → Price → What's included
- NO elaborate "trust building" narratives
- NO "why you should try" explanations
- Clean, scannable format

**Example - Pre-Bridal Package:**
```
*12 Services in 3 Sittings* — *Rs.7,499*
Services: O3+ Facial (x2), Bleach/D-Tan (x2), ...
*Market value: Rs.13,850 → Save Rs.6,351 (46% OFF)*
```

---

## Booking Flow - Straightforward

**Before (v2.4):** Complex paths A/B with conditions
- Path A: Advance payment required
- Path B: Studio visit with hesitation handling

**After (v3.0):** Single unified booking flow
```
1. Share service + price
2. Ask: "Kab convenient hoga aapko studio visit ke liye?"
3. If agreed: "Perfect! Garima ma'am aapko confirm karengi. +91 93542 60517"
4. If hesitant: "Aap ek baar studio visit kar sakte ho — koi pressure nahi. Kab suitable hai?"
5. For advance/slot: "Garima ma'am QR code bhejegi booking ke liye."
```

---

## What REMAINS UNCHANGED

✅ Google Sheets integration
✅ Lead tracking (phone, name, wedding date, city, source)
✅ Bot intervention control (K column)
✅ Admin panel at /admin
✅ Nudge system (24h silence)
✅ Webhook parsing
✅ WAPI integration
✅ Conversation history (limited to 10 messages)
✅ Admin trainer mode
✅ Location/wedding date extraction
✅ Status detection logic

---

## Deployment Instructions

1. **Backup current code** (if in production):
   ```bash
   git checkout -b backup/v2.4
   ```

2. **Replace with v3.0:**
   ```bash
   cp bot-updated.js index.js
   ```

3. **Test locally:**
   ```bash
   BOT_ACTIVE=true npm start
   ```

4. **Deploy to Railway:**
   ```bash
   git add .
   git commit -m "v3.0: All leads tracked + simplified booking flow"
   git push origin main
   ```

5. **Verify in logs:**
   ```
   📋 ADDED TO SHEETS: 919999999999 | Source: Direct Message
   ✨ Flow: Inquiry → Service Menu → Details + Price → Booking
   ```

---

## Testing Checklist

- [ ] Send direct message (not Meta form) → Should appear in Sheets
- [ ] Test each service path (A-B-C-D-E) → Should show pricing only
- [ ] Verify bot doesn't ask wedding date unless on followup
- [ ] Confirm no "trust building" language in responses
- [ ] Check max 2 sentences per bot reply
- [ ] Verify Garima phone # shared for booking

---

## Rollback Plan

If issues arise:
```bash
git revert HEAD
git push origin main
```

Original v2.4 code will be restored from git history.
