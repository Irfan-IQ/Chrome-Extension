// privacy/patternAnalyzer.js  —  runs in the SIDE PANEL
//
// Regex/pattern-based PII classifier.
// This layer takes TEXT (from OCR or anywhere) and answers:
//   "Does this string match a structured PII pattern?"
//
// It does NOT decide context or provenance — the fusion layer handles that.
// It is the authoritative source for STRUCTURED PII (email, phone, card, etc.)
//
// PRIVACY RULE: classified text is only used for category labelling and bounding-
// box redaction. Actual values are NEVER forwarded to Gemini or logged in full.
// Log format: "Detected EMAIL: ra***@gm***" (first 2 chars + stars).

(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configurable thresholds
  // ---------------------------------------------------------------------------
  var THRESHOLDS = {
    HIGH: 0.80,
    MEDIUM: 0.60,
    LOW: 0.40,
  };

  // ---------------------------------------------------------------------------
  // Luhn algorithm (credit-card validation)
  // ---------------------------------------------------------------------------
  function luhn(num) {
    var str = String(num).replace(/\D/g, "");
    if (str.length < 13 || str.length > 19) return false;
    var sum = 0;
    var alt = false;
    for (var i = str.length - 1; i >= 0; i--) {
      var n = parseInt(str[i], 10);
      if (alt) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // ---------------------------------------------------------------------------
  // Pattern registry — ordered by specificity (most specific first)
  // ---------------------------------------------------------------------------
  var PATTERNS = [
    // ---- Email ---------------------------------------------------------------
    {
      category: "email",
      confidence: 0.95,
      // Standard email regex — deliberately not too strict to catch OCR artifacts
      test: function (t) {
        return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(t.trim()) ||
               /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(t);
      },
      extract: function (t) {
        var m = t.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        return m ? m[0] : null;
      },
    },

    // ---- Credit / debit card -------------------------------------------------
    {
      category: "credit_card",
      confidence: 0.88,
      test: function (t) {
        // 13-19 digits, optionally grouped with spaces or dashes
        var digits = t.replace(/[\s\-]/g, "");
        if (!/^\d{13,19}$/.test(digits)) return false;
        return luhn(digits);
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- SSN (US) -----------------------------------------------------------
    {
      category: "ssn",
      confidence: 0.90,
      test: function (t) {
        return /^\d{3}[-\s]\d{2}[-\s]\d{4}$/.test(t.trim());
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- IBAN / bank account ------------------------------------------------
    {
      category: "bank_account",
      confidence: 0.80,
      test: function (t) {
        // Basic IBAN: 2 letters + 2 digits + up to 30 alphanumeric
        return /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/i.test(t.replace(/\s/g, ""));
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- Phone number -------------------------------------------------------
    {
      category: "phone",
      confidence: 0.75,
      test: function (t) {
        var clean = t.replace(/[\s\-.()+]/g, "");
        // 7-15 digits; reject pure numbers that look like card/SSN (already matched above)
        if (!/^\+?\d{7,15}$/.test(clean)) return false;
        // Avoid matching things that are too short or look like zip codes
        return clean.replace(/\D/g, "").length >= 7;
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- Date patterns (could be DOB) ----------------------------------------
    {
      category: "date_of_birth",
      confidence: 0.55,       // medium — needs context to confirm DOB vs. other date
      test: function (t) {
        var s = t.trim();
        // DD/MM/YYYY, MM-DD-YYYY, YYYY-MM-DD, DD MMM YYYY, etc.
        return /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(s) ||
               /^\d{4}[\/\-]\d{2}[\/\-]\d{2}$/.test(s) ||
               /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{2,4}$/i.test(s);
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- Aadhaar (India) — 12 digits, optionally grouped ---------------
    {
      category: "ssn",   // reuse ssn category for national ID numbers
      confidence: 0.92,
      test: function (t) {
        // 12 digits, optionally in groups of 4 separated by spaces
        var digits = t.replace(/\s/g, "");
        return /^\d{12}$/.test(digits) && !/^\d{13,}$/.test(digits);
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- PAN (India) — ABCDE1234F format -----------------------------------
    {
      category: "ssn",
      confidence: 0.90,
      test: function (t) {
        return /^[A-Z]{5}\d{4}[A-Z]$/i.test(t.trim());
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- Indian bank account (9-18 digits) ---------------------------------
    {
      category: "bank_account",
      confidence: 0.78,
      test: function (t) {
        var digits = t.replace(/\s/g, "");
        return /^\d{9,18}$/.test(digits);
      },
      extract: function (t) { return t.trim(); },
    },

    // ---- API key / token (32+ hex or base64 chars) --------------------------
    {
      category: "api_key",
      confidence: 0.70,
      test: function (t) {
        var s = t.trim();
        // 32–512 char strings of hex or base64 (no spaces)
        return s.length >= 32 && s.length <= 512 &&
               /^[A-Za-z0-9+/=_\-]+$/.test(s) &&
               // Must have good entropy: not all same char, not purely numeric
               /[A-Za-z]/.test(s) && /\d/.test(s) &&
               // Filter common false positives (long words, URLs)
               !/^https?:/.test(s);
      },
      extract: function (t) { return t.trim(); },
    },
  ];

  // ---------------------------------------------------------------------------
  // Privacy-safe log helper: show category + partially masked value
  // ---------------------------------------------------------------------------
  function safeLog(category, text) {
    try {
      var preview = String(text || "").slice(0, 2) + "***";
      console.debug("[V3 pattern] Detected " + category + ": " + preview);
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // classify(text)
  //   Returns { category, confidence, matchedText } or null.
  //   Tests all patterns in order; returns the first match.
  // ---------------------------------------------------------------------------
  function classify(text) {
    if (!text || typeof text !== "string") return null;
    var t = text.trim();
    if (!t) return null;

    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      try {
        if (p.test(t)) {
          var matched = p.extract ? p.extract(t) : t;
          safeLog(p.category, matched);
          return {
            category: p.category,
            confidence: p.confidence,
            matchedText: matched,
          };
        }
      } catch (e) {}
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // classifyWords(words)
  //   Input:  [{ text, confidence, boundingBox, source }]  (from OcrAnalyzer)
  //   Output: [{ category, confidence, boundingBox, sources, matchedText }]
  //
  //   Also tries CONSECUTIVE word groups (2-4 words) to catch multi-word
  //   patterns like "4111 1111 1111 1111" or "01 / 2030".
  // ---------------------------------------------------------------------------
  function classifyWords(words) {
    var results = [];
    if (!Array.isArray(words)) return results;

    // Single-word pass
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var verdict = classify(w.text);
      if (verdict && verdict.confidence >= THRESHOLDS.LOW) {
        results.push({
          category: verdict.category,
          confidence: Math.min(0.99, verdict.confidence * (w.confidence || 1)),
          boundingBox: w.boundingBox,
          sources: ["ocr", "regex"],
          matchedText: verdict.matchedText,
          ocrConfidence: w.confidence,
        });
      }
    }

    // Multi-word sliding window (window of 2 to 4 consecutive words)
    for (var win = 2; win <= 4; win++) {
      for (var j = 0; j <= words.length - win; j++) {
        var group = words.slice(j, j + win);
        // Only group words on approximately the same line
        var y0 = group[0].boundingBox.y;
        var allSameLine = group.every(function (wd) {
          return Math.abs(wd.boundingBox.y - y0) < 20;
        });
        if (!allSameLine) continue;

        var combined = group.map(function (wd) { return wd.text; }).join(" ");
        var verdict2 = classify(combined);
        if (verdict2 && verdict2.confidence >= THRESHOLDS.LOW) {
          // Merge bounding boxes
          var merged = mergeBBoxes(group.map(function (wd) { return wd.boundingBox; }));
          // Average OCR confidence
          var avgOcr = group.reduce(function (s, wd) { return s + (wd.confidence || 1); }, 0) / group.length;
          results.push({
            category: verdict2.category,
            confidence: Math.min(0.99, verdict2.confidence * avgOcr),
            boundingBox: merged,
            sources: ["ocr", "regex"],
            matchedText: verdict2.matchedText,
            ocrConfidence: avgOcr,
            wordCount: win,
          });
        }
      }
    }

    return results;
  }

  function mergeBBoxes(boxes) {
    var x = Infinity, y = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      x = Math.min(x, b.x);
      y = Math.min(y, b.y);
      x2 = Math.max(x2, b.x + b.width);
      y2 = Math.max(y2, b.y + b.height);
    }
    return { x: x, y: y, width: x2 - x, height: y2 - y };
  }

  root.PatternAnalyzer = {
    classify: classify,
    classifyWords: classifyWords,
    THRESHOLDS: THRESHOLDS,
    PATTERNS: PATTERNS,
  };
})(typeof window !== "undefined" ? window : self);
