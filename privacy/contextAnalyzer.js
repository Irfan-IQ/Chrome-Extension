// privacy/contextAnalyzer.js  —  runs in the SIDE PANEL
//
// Context-aware and NER-style classification layer.
//
// This layer DOES NOT produce detections on its own. It:
//   1. Looks at OCR lines for "label: value" patterns and infers the VALUE's
//      category from the LABEL text (e.g. "Name: Rahul Kumar" → PERSON).
//   2. Applies lightweight rule-based NER to identify person names, addresses,
//      and similar entities that have no distinctive regex pattern.
//   3. Returns enhanced detections — existing pattern detections with boosted
//      confidence, PLUS new context-inferred detections.
//
// Architecture note: Context evidence ADDS to confidence but never replaces
// pattern or DOM evidence. Multiple independent signals → higher confidence.
//
// PRIVACY RULE: logged output shows category + masked preview only, never the
// full detected value.

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Label → category mapping (OCR text near a field acts as a label)
  // ---------------------------------------------------------------------------
  var LABEL_RULES = [
    // Each entry: { pattern: RegExp (matches the label text), category: string, bonus: number }
    // Pattern uses :? so it matches both "Name:" and "Name" (label-only lines like
    // "APPLICANT NAME" from admissions portals don't have a trailing colon).
    { pattern: /\b(full\s*name|your\s*name|customer\s*name|applicant\s*name|student\s*name|candidate\s*name|member\s*name|account\s*name|name)\s*:?\s*$/i, category: "name", bonus: 0.30 },
    { pattern: /\b(first\s*name|given\s*name|forename)\s*:?\s*$/i,                 category: "name",          bonus: 0.28 },
    { pattern: /\b(last\s*name|surname|family\s*name)\s*:?\s*$/i,                  category: "name",          bonus: 0.28 },
    { pattern: /\b(e-?mail|email\s*address|contact\s*email)\s*:?\s*$/i,            category: "email",         bonus: 0.25 },
    { pattern: /\b(phone|mobile|telephone|tel|cell\s*phone|contact)\s*:?\s*$/i,    category: "phone",         bonus: 0.25 },
    { pattern: /\b(address|street|mailing|shipping|billing)\s*:?\s*$/i,            category: "address",       bonus: 0.30 },
    { pattern: /\b(zip|postal\s*code|pincode|postcode)\s*:?\s*$/i,                 category: "address",       bonus: 0.25 },
    { pattern: /\b(date\s*of\s*birth|d\.?o\.?b|birthday|born)\s*:?\s*$/i,         category: "date_of_birth", bonus: 0.30 },
    { pattern: /\b(age)\s*:?\s*$/i,                                                category: "age",           bonus: 0.25 },
    { pattern: /\b(username|user\s*name|handle|login|screen\s*name)\s*:?\s*$/i,   category: "username",      bonus: 0.25 },
    { pattern: /\b(password|passphrase|secret)\s*:?\s*$/i,                        category: "password",      bonus: 0.20 },
    { pattern: /\b(card\s*number|credit\s*card|debit\s*card|cc\s*no)\s*:?\s*$/i,  category: "credit_card",   bonus: 0.30 },
    { pattern: /\b(ssn|social\s*security|national\s*id|id\s*number|aadhaar|aadhar|pan\s*card|pan\s*no)\s*:?\s*$/i, category: "ssn", bonus: 0.30 },
    { pattern: /\b(api\s*key|token|secret\s*key|access\s*key)\s*:?\s*$/i,         category: "api_key",       bonus: 0.25 },
    { pattern: /\b(bank\s*account|account\s*number|iban|routing)\s*:?\s*$/i,      category: "bank_account",  bonus: 0.25 },
  ];

  // ---------------------------------------------------------------------------
  // Simple rule-based person-name detector
  //   Matches: 2-4 consecutive capitalised words, no digits, common given names
  //   False-positive guard: must not be a common English non-name word.
  // ---------------------------------------------------------------------------
  var NON_NAME_WORDS = new Set([
    "The", "And", "Or", "In", "On", "At", "To", "By", "For", "Of", "An",
    "This", "That", "Is", "Are", "Was", "Were", "Has", "Have", "Had",
    "Will", "Would", "Could", "Should", "May", "Can", "Do", "Did", "Does",
    "Not", "No", "Yes", "Ok", "Hi", "Hello", "Dear", "Mr", "Mrs", "Ms",
    "Dr", "Prof", "Sir", "Madam",
    // Month names
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
    // Day names
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ]);

  function looksLikePersonName(text, allowSingleWord) {
    var parts = text.trim().split(/\s+/);
    var minParts = allowSingleWord ? 1 : 2;
    if (parts.length < minParts || parts.length > 4) return false;
    // Every part must start with uppercase, be alphabetic only
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!/^[A-Z][a-zA-Z'\-]{1,}$/.test(p)) return false;
      if (NON_NAME_WORDS.has(p)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Address fragment detector (heuristic — single-signal, needs label context)
  // ---------------------------------------------------------------------------
  function looksLikeAddressFragment(text) {
    // Matches things like "12 MG Road", "123 Main St", "Apt 4B"
    return /^\d+\s+[A-Za-z]/.test(text.trim()) ||
           /\b(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Blvd|Way|Place|Pl)\b/i.test(text);
  }

  // ---------------------------------------------------------------------------
  // Spatial proximity helper
  //   Two bounding boxes are "near" if they are within `maxGap` pixels of each
  //   other (in the screenshot coordinate system).
  // ---------------------------------------------------------------------------
  function isNearby(box1, box2, maxGap) {
    var mg = maxGap || 60; // px in screenshot coords
    var h1b = box1.y + box1.height;
    var h2b = box2.y + box2.height;
    // Vertically adjacent (box2 below box1 or same line)
    var vertOk = box2.y >= box1.y - 5 && box2.y <= h1b + mg;
    // Horizontally overlapping or close
    var h1r = box1.x + box1.width;
    var h2r = box2.x + box2.width;
    var horizOk = !(box2.x > h1r + mg || h2r < box1.x - mg);
    return vertOk && horizOk;
  }

  // ---------------------------------------------------------------------------
  // Find the spatially closest word to the RIGHT of words[wi] on the same line.
  // Uses bounding-box positions rather than array index so multi-column layouts
  // don't cause words from other columns to be treated as neighbors.
  // ---------------------------------------------------------------------------
  function findRightNeighbor(words, wi, maxHorizGap, maxVertGap) {
    var mhg = maxHorizGap || 60;
    var mvg = maxVertGap || 10;
    var word = words[wi];
    var wordRight = word.boundingBox.x + word.boundingBox.width;
    var bestWord = null;
    var bestGap = Infinity;
    for (var j = 0; j < words.length; j++) {
      if (j === wi) continue;
      var w2 = words[j];
      // Must be on approximately the same line
      if (Math.abs(w2.boundingBox.y - word.boundingBox.y) > mvg) continue;
      // Must be to the right
      var gap = w2.boundingBox.x - wordRight;
      if (gap >= 0 && gap <= mhg && gap < bestGap) {
        bestGap = gap;
        bestWord = w2;
      }
    }
    return bestWord;
  }

  // ---------------------------------------------------------------------------
  // Main analysis function
  //
  //  words:   [{ text, confidence, boundingBox:{x,y,width,height}, source }]
  //           — bounding boxes are in SCREENSHOT pixel coordinates
  //  lines:   [{ text, boundingBox }] — OCR lines (groups of nearby words)
  //
  //  Returns: [{ category, confidence, boundingBox, sources, evidence }]
  //           — bounding boxes still in SCREENSHOT pixels
  // ---------------------------------------------------------------------------
  function analyze(words, lines) {
    var results = [];
    if (!Array.isArray(words)) return results;

    var allLines = Array.isArray(lines) ? lines : [];

    // ---- Pass 1: label → value inference -----------------------------------
    // For each line, check if it looks like a label. If so, examine the NEXT
    // line (or the suffix of the same line) for the associated value.

    for (var li = 0; li < allLines.length; li++) {
      var line = allLines[li];
      var lineText = (line.text || "").trim();

      for (var ri = 0; ri < LABEL_RULES.length; ri++) {
        var rule = LABEL_RULES[ri];
        if (!rule.pattern.test(lineText)) continue;

        // This line IS a label. Look at the words on the next line.
        var nextLine = allLines[li + 1];
        if (!nextLine) continue;

        var valueText = (nextLine.text || "").trim();
        if (!valueText || valueText.length < 1) continue;

        // Only emit a context detection if the value text could plausibly be
        // a real value (not another label).
        var seemsLikeLabel = /:\s*$/.test(valueText) && valueText.length < 40;
        if (seemsLikeLabel) continue;

        // In multi-column layouts OCR may merge values from multiple columns
        // into one line. Narrow the value to words whose X position overlaps
        // with the label's column (±150 px tolerance).
        var labelBox = line.boundingBox;
        if (labelBox && nextLine.boundingBox) {
          // Find words in the next line that are within the label's X column
          var narrowed = (allLines[li + 1]._words || []).filter(function (w) {
            return w.boundingBox &&
                   w.boundingBox.x >= labelBox.x - 150 &&
                   w.boundingBox.x <= labelBox.x + labelBox.width + 150;
          });
          if (narrowed.length > 0) {
            valueText = narrowed.map(function (w) { return w.text; }).join(" ").trim();
          }
        }
        if (!valueText) continue;

        // For name category: allow single capitalised words (e.g. "Irfan")
        if (rule.category === "name" && valueText.length > 0) {
          if (!looksLikePersonName(valueText, true /* allowSingleWord */)) continue;
        }

        safeLog("context-" + rule.category, valueText);
        results.push({
          category: rule.category,
          confidence: Math.min(0.90, 0.45 + rule.bonus),
          boundingBox: nextLine.boundingBox,
          sources: ["ocr", "context"],
          evidence: "label:" + lineText.slice(0, 30),
        });
      }

      // ---- Also check for "Label: Value" on the SAME line -------------------
      var colonIdx = lineText.indexOf(":");
      if (colonIdx > 0 && colonIdx < lineText.length - 2) {
        var labelPart  = lineText.slice(0, colonIdx).trim();
        var valuePart  = lineText.slice(colonIdx + 1).trim();
        if (labelPart && valuePart) {
          for (var ri2 = 0; ri2 < LABEL_RULES.length; ri2++) {
            var rule2 = LABEL_RULES[ri2];
            // Test label part with a colon appended
            if (!rule2.pattern.test(labelPart + ":")) continue;
            if (valuePart.length < 2) continue;
            safeLog("context-inline-" + rule2.category, valuePart);
            results.push({
              category: rule2.category,
              confidence: Math.min(0.90, 0.45 + rule2.bonus),
              // Use the line's full bounding box (good enough for masking)
              boundingBox: line.boundingBox,
              sources: ["ocr", "context"],
              evidence: "inline-label:" + labelPart.slice(0, 30),
            });
            break;
          }
        }
      }
    }

    // ---- Pass 2: NER — person name detection --------------------------------
    // Did any label context already identify a name label nearby?
    var hasNameLabelContext = results.some(function (r) {
      return r.category === "name" && r.sources.indexOf("context") !== -1;
    });

    // Run on individual words and short word groups
    for (var wi = 0; wi < words.length; wi++) {
      var word = words[wi];
      if (!word.text || word.text.length < 2) continue;

      // Single-word name — only emit when a name label was seen in context
      // (avoids false-positives on proper nouns that aren't person names)
      if (hasNameLabelContext && looksLikePersonName(word.text, true)) {
        // Only add if not already covered by a context detection
        var alreadyCovered = results.some(function (r) {
          return r.category === "name" && r.boundingBox &&
                 Math.abs(r.boundingBox.y - word.boundingBox.y) < 30;
        });
        if (!alreadyCovered) {
          safeLog("NER-name-single", word.text);
          results.push({
            category: "name",
            confidence: 0.62,     // medium-high — label context gives us confidence
            boundingBox: word.boundingBox,
            sources: ["ocr", "ner", "context"],
            evidence: "single-word-name+label-context",
          });
        }
      }

      // Two-word names: find the spatially nearest word to the RIGHT on the same
      // line rather than relying on array order (which breaks in multi-column
      // layouts where words from other columns interleave in the array).
      var w2 = findRightNeighbor(words, wi, 60, 10);
      if (w2) {
        var twoWordText = word.text + " " + w2.text;
        if (looksLikePersonName(twoWordText)) {
          var mergedBox = {
            x: Math.min(word.boundingBox.x, w2.boundingBox.x),
            y: Math.min(word.boundingBox.y, w2.boundingBox.y),
            width: (Math.max(word.boundingBox.x + word.boundingBox.width,
                             w2.boundingBox.x + w2.boundingBox.width)) -
                   Math.min(word.boundingBox.x, w2.boundingBox.x),
            height: Math.max(word.boundingBox.height, w2.boundingBox.height),
          };
          safeLog("NER-name", twoWordText);
          results.push({
            category: "name",
            confidence: 0.60,  // bumped from 0.55 — spatial match is more reliable
            boundingBox: mergedBox,
            sources: ["ocr", "ner"],
            evidence: "person-name-pattern",
          });
          // Also look for a three-word name (wi → w2 → w3)
          var w2idx = words.indexOf(w2);
          if (w2idx !== -1) {
            var w3 = findRightNeighbor(words, w2idx, 60, 10);
            if (w3) {
              var threeWordText = word.text + " " + w2.text + " " + w3.text;
              if (looksLikePersonName(threeWordText)) {
                var mergedBox3 = {
                  x: Math.min(word.boundingBox.x, w3.boundingBox.x),
                  y: Math.min(word.boundingBox.y, w3.boundingBox.y),
                  width: (Math.max(word.boundingBox.x + word.boundingBox.width,
                                   w3.boundingBox.x + w3.boundingBox.width)) -
                         Math.min(word.boundingBox.x, w3.boundingBox.x),
                  height: Math.max(word.boundingBox.height, w3.boundingBox.height),
                };
                safeLog("NER-name-3", threeWordText);
                results.push({
                  category: "name",
                  confidence: 0.58,
                  boundingBox: mergedBox3,
                  sources: ["ocr", "ner"],
                  evidence: "person-name-3-word",
                });
              }
            }
          }
        }
      }
    }

    // ---- Pass 3: address fragment detection (label-gated) -------------------
    // Only emit address detection when an address-related label was seen nearby.
    var hasAddressLabel = results.some(function (r) {
      return r.category === "address" && r.sources.indexOf("context") !== -1;
    });
    if (hasAddressLabel) {
      for (var ai = 0; ai < allLines.length; ai++) {
        var aLine = allLines[ai];
        if (looksLikeAddressFragment(aLine.text || "")) {
          // Check if this line is already covered by a context detection.
          var alreadyCovered = results.some(function (r) {
            return r.category === "address" && r.boundingBox &&
                   Math.abs(r.boundingBox.y - aLine.boundingBox.y) < 30;
          });
          if (!alreadyCovered) {
            results.push({
              category: "address",
              confidence: 0.55,
              boundingBox: aLine.boundingBox,
              sources: ["ocr", "context", "ner"],
              evidence: "address-fragment",
            });
          }
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Privacy-safe log
  // ---------------------------------------------------------------------------
  function safeLog(type, text) {
    try {
      var preview = String(text || "").slice(0, 3) + "***";
      console.debug("[V3 context] " + type + " ← " + preview);
    } catch (e) {}
  }

  root.ContextAnalyzer = {
    analyze: analyze,
    looksLikePersonName: looksLikePersonName,
  };
})(typeof window !== "undefined" ? window : self);
