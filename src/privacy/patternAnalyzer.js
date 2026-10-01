// privacy/patternAnalyzer.js  —  runs in the SIDE PANEL
//
// Regex/pattern-based PII classifier. Takes TEXT (from OCR or anywhere)
// and answers: "Does this string match a structured PII pattern?"
//
// PRIVACY RULE: classified text is only used for category labelling and
// bounding-box redaction. Values are NEVER forwarded to Gemini or logged.
// Log format: "Detected EMAIL: ra***@gm***" (first 2 chars + stars).

import { debug } from '../debug.js';

var THRESHOLDS = {
  HIGH: 0.80,
  MEDIUM: 0.60,
  LOW: 0.40,
};

function luhn(num) {
  var str = String(num).replace(/\D/g, "");
  if (str.length < 13 || str.length > 19) return false;
  var sum = 0;
  var alt = false;
  for (var i = str.length - 1; i >= 0; i--) {
    var n = parseInt(str[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

var PATTERNS = [
  {
    category: "email",
    confidence: 0.95,
    test: function (t) {
      return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(t.trim()) ||
             /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(t);
    },
    extract: function (t) {
      var m = t.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      return m ? m[0] : null;
    },
  },
  {
    category: "credit_card",
    confidence: 0.88,
    test: function (t) {
      var digits = t.replace(/[\s\-]/g, "");
      if (!/^\d{13,19}$/.test(digits)) return false;
      return luhn(digits);
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "ssn",
    confidence: 0.90,
    test: function (t) { return /^\d{3}[-\s]\d{2}[-\s]\d{4}$/.test(t.trim()); },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "bank_account",
    confidence: 0.80,
    test: function (t) {
      return /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/i.test(t.replace(/\s/g, ""));
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "phone",
    confidence: 0.75,
    test: function (t) {
      var clean = t.replace(/[\s\-.()+]/g, "");
      if (!/^\+?\d{7,15}$/.test(clean)) return false;
      return clean.replace(/\D/g, "").length >= 7;
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "date_of_birth",
    confidence: 0.55,
    test: function (t) {
      var s = t.trim();
      return /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(s) ||
             /^\d{4}[\/\-]\d{2}[\/\-]\d{2}$/.test(s) ||
             /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{2,4}$/i.test(s);
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "ssn",
    confidence: 0.92,
    test: function (t) {
      var digits = t.replace(/\s/g, "");
      return /^\d{12}$/.test(digits) && !/^\d{13,}$/.test(digits);
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "ssn",
    confidence: 0.90,
    test: function (t) { return /^[A-Z]{5}\d{4}[A-Z]$/i.test(t.trim()); },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "bank_account",
    confidence: 0.78,
    test: function (t) {
      var digits = t.replace(/\s/g, "");
      return /^\d{9,18}$/.test(digits);
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "username",
    confidence: 0.88,
    test: function (t) {
      return /linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i.test(t) ||
             /^in\/[A-Za-z0-9][A-Za-z0-9\-]+-[a-f0-9]{6,}/i.test(t.trim());
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "username",
    confidence: 0.85,
    test: function (t) {
      return /github\.com\/[A-Za-z0-9][A-Za-z0-9\-]{0,38}(?:$|[^\/A-Za-z0-9\-])/i.test(t);
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "username",
    confidence: 0.78,
    test: function (t) {
      var s = t.trim();
      if (/^@[A-Za-z0-9_][A-Za-z0-9_.]{1,49}$/.test(s)) return true;
      if (/^[A-Za-z0-9][A-Za-z0-9\-]{0,38}$/.test(s) && s.length >= 3 && s.length <= 39 &&
          /[A-Za-z]/.test(s) && /[\-]/.test(s)) return true;
      return false;
    },
    extract: function (t) { return t.trim(); },
  },
  {
    category: "api_key",
    confidence: 0.70,
    test: function (t) {
      var s = t.trim();
      return s.length >= 32 && s.length <= 512 &&
             /^[A-Za-z0-9+/=_\-]+$/.test(s) &&
             /[A-Za-z]/.test(s) && /\d/.test(s) &&
             !/^https?:/.test(s);
    },
    extract: function (t) { return t.trim(); },
  },
];

function safeLog(category, text) {
  try {
    var preview = String(text || "").slice(0, 2) + "***";
    debug("[V3 pattern] Detected " + category + ": " + preview);
  } catch (e) {}
}

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
        return { category: p.category, confidence: p.confidence, matchedText: matched };
      }
    } catch (e) {}
  }
  return null;
}

function classifyWords(words) {
  var results = [];
  if (!Array.isArray(words)) return results;

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

  for (var win = 2; win <= 4; win++) {
    for (var j = 0; j <= words.length - win; j++) {
      var group = words.slice(j, j + win);
      var y0 = group[0].boundingBox.y;
      var allSameLine = group.every(function (wd) {
        return Math.abs(wd.boundingBox.y - y0) < 20;
      });
      if (!allSameLine) continue;

      var combined = group.map(function (wd) { return wd.text; }).join(" ");
      var verdict2 = classify(combined);
      if (verdict2 && verdict2.confidence >= THRESHOLDS.LOW) {
        var merged = mergeBBoxes(group.map(function (wd) { return wd.boundingBox; }));
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

export const PatternAnalyzer = {
  classify,
  classifyWords,
  THRESHOLDS,
  PATTERNS,
};
