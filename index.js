// ═══════════════════════════════════════════════════════════════
// WEBHOOK DIAGNOSTIC TEST - Add to index.js temporarily
// ═══════════════════════════════════════════════════════════════

// Add this BEFORE the webhook endpoint (before line 860 in your code)

// Create a separate diagnostic webhook to log EVERYTHING
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

// Add this endpoint to VIEW the logs
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

// Add this endpoint to CLEAR logs
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
// TESTING INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════

/*

HOW TO TEST:

1. DEPLOY this diagnostic code to Railway
   git add index.js
   git commit -m "Add webhook diagnostic test"
   git push

2. GET THE DIAGNOSTIC ENDPOINT
   https://your-railway-url/webhook-logs

3. CONFIGURE WAPI.IN.NET TO SEND TO DIAGNOSTIC
   Go to wapi.in.net settings
   Change webhook URL to: https://your-railway-url/webhook-diagnostic
   (Use THIS instead of /webhook temporarily)

4. RUN TEST SEQUENCE:
   
   Step A: Clear old logs
   POST to: https://your-railway-url/webhook-logs/clear
   
   Step B: Send test messages
   - Customer sends: "Hello bot"
   - Garima manually replies: "Hi! This is Garima"
   - Customer replies: "Thanks!"
   
   Step C: Check logs
   GET: https://your-railway-url/webhook-logs
   
   ANALYZE RESULTS:
   - Do you see INFLOW messages from customer? ✓
   - Do you see STATUS messages when Garima sends? 
   - Do you see anything showing Garima's manual message?

5. WHAT TO LOOK FOR:
   
   ✅ INFLOW MESSAGE (customer):
   {
     "type": "INFLOW - text message from customer",
     "from": "919999999999",
     "messageType": "text"
   }

   ❓ OUTFLOW MESSAGE (Garima):
   {
     "type": "STATUS UPDATE - Message sent/delivered/read",
     "status": "sent",
     "messageId": "wamid..."
   }
   
   OR
   
   {
     "type": "INFLOW - text message from customer",
     "from": "919354260517"  ← Would be from Garima's number
   }

6. SHARE THE RESULTS:
   POST the /webhook-logs JSON output back to me

*/

// ═══════════════════════════════════════════════════════════════
// AFTER TESTING: Switch back to real webhook
// ═══════════════════════════════════════════════════════════════

/*
Once testing is complete:
1. Switch wapi.in.net webhook back to: /webhook
2. Remove this diagnostic code
3. We'll know for sure if Garima's messages appear in webhook
*/
