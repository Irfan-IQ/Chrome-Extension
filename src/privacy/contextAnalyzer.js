// privacy/contextAnalyzer.js  —  runs in the SIDE PANEL
//
// Context-aware and NER-style classification layer. See docs/ARCHITECTURE.md.
// PRIVACY RULE: logged output shows category + masked preview only.

import { debug } from '../debug.js';

var LABEL_RULES = [
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

var NON_NAME_WORDS = new Set([
  "The", "And", "Or", "In", "On", "At", "To", "By", "For", "Of", "An",
  "This", "That", "Is", "Are", "Was", "Were", "Has", "Have", "Had",
  "Will", "Would", "Could", "Should", "May", "Can", "Do", "Did", "Does",
  "Not", "No", "Yes", "Ok", "Hi", "Hello", "Dear", "Mr", "Mrs", "Ms",
  "Dr", "Prof", "Sir", "Madam",
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
]);

function looksLikePersonName(text, allowSingleWord) {
  var parts = text.trim().split(/\s+/);
  var minParts = allowSingleWord ? 1 : 2;
  if (parts.length < minParts || parts.length > 4) return false;
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (!/^[A-Z][a-zA-Z'\-]{1,}$/.test(p)) return false;
    if (NON_NAME_WORDS.has(p)) return false;
  }
  return true;
}

function looksLikeAddressFragment(text) {
  return /^\d+\s+[A-Za-z]/.test(text.trim()) ||
         /\b(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Blvd|Way|Place|Pl)\b/i.test(text);
}

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
    if (Math.abs(w2.boundingBox.y - word.boundingBox.y) > mvg) continue;
    var gap = w2.boundingBox.x - wordRight;
    if (gap >= 0 && gap <= mhg && gap < bestGap) {
      bestGap = gap;
      bestWord = w2;
    }
  }
  return bestWord;
}

function analyze(words, lines) {
  var results = [];
  if (!Array.isArray(words)) return results;

  var allLines = Array.isArray(lines) ? lines : [];

  for (var li = 0; li < allLines.length; li++) {
    var line = allLines[li];
    var lineText = (line.text || "").trim();

    for (var ri = 0; ri < LABEL_RULES.length; ri++) {
      var rule = LABEL_RULES[ri];
      if (!rule.pattern.test(lineText)) continue;

      var nextLine = allLines[li + 1];
      if (!nextLine) continue;

      var valueText = (nextLine.text || "").trim();
      if (!valueText || valueText.length < 1) continue;

      var seemsLikeLabel = /:\s*$/.test(valueText) && valueText.length < 40;
      if (seemsLikeLabel) continue;

      var labelBox = line.boundingBox;
      if (labelBox && nextLine.boundingBox) {
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

      if (rule.category === "name" && valueText.length > 0) {
        if (!looksLikePersonName(valueText, true)) continue;
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

    var colonIdx = lineText.indexOf(":");
    if (colonIdx > 0 && colonIdx < lineText.length - 2) {
      var labelPart  = lineText.slice(0, colonIdx).trim();
      var valuePart  = lineText.slice(colonIdx + 1).trim();
      if (labelPart && valuePart) {
        for (var ri2 = 0; ri2 < LABEL_RULES.length; ri2++) {
          var rule2 = LABEL_RULES[ri2];
          if (!rule2.pattern.test(labelPart + ":")) continue;
          if (valuePart.length < 2) continue;
          safeLog("context-inline-" + rule2.category, valuePart);
          results.push({
            category: rule2.category,
            confidence: Math.min(0.90, 0.45 + rule2.bonus),
            boundingBox: line.boundingBox,
            sources: ["ocr", "context"],
            evidence: "inline-label:" + labelPart.slice(0, 30),
          });
          break;
        }
      }
    }
  }

  var hasNameLabelContext = results.some(function (r) {
    return r.category === "name" && r.sources.indexOf("context") !== -1;
  });

  for (var wi = 0; wi < words.length; wi++) {
    var word = words[wi];
    if (!word.text || word.text.length < 2) continue;

    if (hasNameLabelContext && looksLikePersonName(word.text, true)) {
      var alreadyCovered = results.some(function (r) {
        return r.category === "name" && r.boundingBox &&
               Math.abs(r.boundingBox.y - word.boundingBox.y) < 30;
      });
      if (!alreadyCovered) {
        safeLog("NER-name-single", word.text);
        results.push({
          category: "name",
          confidence: 0.62,
          boundingBox: word.boundingBox,
          sources: ["ocr", "ner", "context"],
          evidence: "single-word-name+label-context",
        });
      }
    }

    var w2 = findRightNeighbor(words, wi, 120, 15);
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
          confidence: 0.65,
          boundingBox: mergedBox,
          sources: ["ocr", "ner"],
          evidence: "person-name-pattern",
        });
        var w2idx = words.indexOf(w2);
        if (w2idx !== -1) {
          var w3 = findRightNeighbor(words, w2idx, 120, 15);
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
                confidence: 0.63,
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

  for (var phi = 0; phi < allLines.length; phi++) {
    var phLine = allLines[phi];
    var phText = (phLine.text || "").trim();
    if (!phText || phText.length > 60 || phText.length < 3) continue;
    if (!looksLikePersonName(phText, false)) continue;
    var phBox = phLine.boundingBox;
    if (!phBox || phBox.height < 16) continue;
    var phCovered = results.some(function (r) {
      return r.category === "name" && r.boundingBox &&
             Math.abs(r.boundingBox.y - phBox.y) < phBox.height * 1.5;
    });
    if (phCovered) continue;
    safeLog("NER-name-heading", phText);
    results.push({
      category: "name",
      confidence: 0.68,
      boundingBox: phBox,
      sources: ["ocr", "ner"],
      evidence: "profile-heading-name",
    });
  }

  var hasAddressLabel = results.some(function (r) {
    return r.category === "address" && r.sources.indexOf("context") !== -1;
  });
  if (hasAddressLabel) {
    for (var ai = 0; ai < allLines.length; ai++) {
      var aLine = allLines[ai];
      if (looksLikeAddressFragment(aLine.text || "")) {
        var alreadyCovered2 = results.some(function (r) {
          return r.category === "address" && r.boundingBox &&
                 Math.abs(r.boundingBox.y - aLine.boundingBox.y) < 30;
        });
        if (!alreadyCovered2) {
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

function safeLog(type, text) {
  try {
    var preview = String(text || "").slice(0, 3) + "***";
    debug("[V3 context] " + type + " ← " + preview);
  } catch (e) {}
}

export const ContextAnalyzer = {
  analyze,
  looksLikePersonName,
};
