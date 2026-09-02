// privacy/detectionFusion.js  —  runs in the SIDE PANEL
//
// Detection fusion layer — merges detections from multiple independent sources
// (DOM, OCR+pattern, OCR+context, OCR+NER) into a single deduplicated list.
//
// This is the "multiple independent detectors agreeing → higher confidence"
// step described in the V3 spec. It does NOT produce new detections; it only
// merges and scores existing ones.
//
// INPUTS:
//   domDetections   — from V2 detector.js, rects in CSS pixels
//   ocrDetections   — from PatternAnalyzer + ContextAnalyzer, rects in
//                     SCREENSHOT pixels (from Tesseract bounding boxes)
//   viewport        — { width, height } in CSS pixels
//   screenshotSize  — { width, height } in screenshot pixels
//
// OUTPUT:
//   Unified array, all rects in CSS pixels (same coordinate space as the
//   existing V2 redaction pipeline — screenshotRedactor converts them to
//   screenshot px internally).
//
// CONFIDENCE SCORING (transparent, no ML):
//   Each source contributes evidence. Scores are additive, capped at 0.99.
//   DOM high     → base 0.80
//   DOM medium   → base 0.60
//   OCR+regex    → adds 0.15 per confirming detection
//   OCR+context  → adds 0.12
//   OCR+NER      → adds 0.08
//   Spatial overlap between DOM and OCR → adds 0.10 bonus
//
// THRESHOLDS (matches PatternAnalyzer.THRESHOLDS):
//   HIGH   ≥ 0.80 → always redact
//   MEDIUM ≥ 0.60 → redact
//   LOW    < 0.60 → skip (do not redact)

(function (root) {
  "use strict";

  var THRESHOLDS = {
    HIGH: 0.80,
    MEDIUM: 0.60,
    LOW: 0.40,
  };

  // Minimum IoU (intersection over union) to consider two rects the same region.
  var MIN_IOU = 0.20;
  // Max pixel distance (in screenshot px) between centres to consider "nearby".
  var MAX_CENTRE_DIST = 80;

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  function area(r) { return r.width * r.height; }

  function intersectionArea(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return ix * iy;
  }

  function iou(a, b) {
    var inter = intersectionArea(a, b);
    if (inter <= 0) return 0;
    return inter / (area(a) + area(b) - inter);
  }

  function centre(r) {
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }

  function dist(c1, c2) {
    var dx = c1.x - c2.x;
    var dy = c1.y - c2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function unionRect(a, b) {
    var x = Math.min(a.x, b.x);
    var y = Math.min(a.y, b.y);
    var x2 = Math.max(a.x + a.width, b.x + b.width);
    var y2 = Math.max(a.y + a.height, b.y + b.height);
    return { x: x, y: y, width: x2 - x, height: y2 - y };
  }

  // ---------------------------------------------------------------------------
  // Confidence scoring helpers
  // ---------------------------------------------------------------------------

  function domBaseConfidence(domDet) {
    if (domDet.confidence === "high") return 0.85;
    if (domDet.confidence === "medium") return 0.65;
    return 0.50;
  }

  function sourceBonus(sources) {
    var bonus = 0;
    if (sources.indexOf("regex") !== -1)   bonus += 0.15;
    if (sources.indexOf("context") !== -1) bonus += 0.12;
    if (sources.indexOf("ner") !== -1)     bonus += 0.08;
    return bonus;
  }

  // ---------------------------------------------------------------------------
  // Convert OCR/screenshot-pixel rect to CSS-pixel rect
  // ---------------------------------------------------------------------------
  function shotToCss(rect, scale) {
    return {
      x: rect.x / scale.scaleX,
      y: rect.y / scale.scaleY,
      width: rect.width / scale.scaleX,
      height: rect.height / scale.scaleY,
    };
  }

  // ---------------------------------------------------------------------------
  // Build a fused detection from one DOM detection (possibly enriched by OCR)
  // ---------------------------------------------------------------------------
  function makeDomDet(domDet, matchingOcr) {
    var sources = ["dom"];
    var baseConf = domBaseConfidence(domDet);
    var extraBonus = 0;

    for (var i = 0; i < matchingOcr.length; i++) {
      var o = matchingOcr[i];
      (o.sources || []).forEach(function (s) {
        if (sources.indexOf(s) === -1) sources.push(s);
      });
      extraBonus += sourceBonus(o.sources || []) * 0.5; // partial credit for each
      extraBonus += 0.10; // spatial overlap bonus
    }

    var finalConf = Math.min(0.99, baseConf + extraBonus);

    return {
      category: domDet.category,
      confidence: finalConf,
      confidenceLabel: confLabel(finalConf),
      rect: domDet.rect,          // CSS px — existing V2 format
      sources: sources,
      elementType: domDet.elementType || null,
      selector: domDet.selector || null,
      ocrEvidence: matchingOcr.map(function (o) {
        return { sources: o.sources, evidence: o.evidence || null };
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Build a fused detection from an OCR-only detection (no matching DOM field)
  // ---------------------------------------------------------------------------
  function makeOcrDet(ocrDet, scale) {
    var sources = ocrDet.sources || ["ocr"];
    var baseConf = typeof ocrDet.confidence === "number" ? ocrDet.confidence : 0.50;
    baseConf = Math.min(0.99, baseConf + sourceBonus(sources));

    // Convert bbox (screenshot px) → CSS px
    var cssPxRect = shotToCss(ocrDet.boundingBox, scale);

    return {
      category: ocrDet.category,
      confidence: baseConf,
      confidenceLabel: confLabel(baseConf),
      rect: {
        x: Math.round(cssPxRect.x),
        y: Math.round(cssPxRect.y),
        width: Math.round(cssPxRect.width),
        height: Math.round(cssPxRect.height),
      },
      sources: sources,
      elementType: null,
      selector: null,
      ocrEvidence: [{ sources: sources, evidence: ocrDet.evidence || null }],
    };
  }

  function confLabel(c) {
    if (c >= THRESHOLDS.HIGH) return "high";
    if (c >= THRESHOLDS.MEDIUM) return "medium";
    return "low";
  }

  // ---------------------------------------------------------------------------
  // Main fusion entry point
  //
  //   domDetections  — V2 DOM detections (rect in CSS px)
  //   ocrDetections  — combined OCR detections (boundingBox in screenshot px)
  //   viewport       — { width, height } CSS px
  //   screenshotSize — { width, height } screenshot px
  //
  //   Returns array of fused detections (rect in CSS px, ready for V2 redactor).
  // ---------------------------------------------------------------------------
  function fuse(domDetections, ocrDetections, viewport, screenshotSize) {
    var dom = Array.isArray(domDetections) ? domDetections : [];
    var ocr = Array.isArray(ocrDetections) ? ocrDetections : [];

    // Compute scale for coordinate conversion
    var scale = {
      scaleX: screenshotSize && screenshotSize.width && viewport && viewport.width
        ? screenshotSize.width / viewport.width : 1,
      scaleY: screenshotSize && screenshotSize.height && viewport && viewport.height
        ? screenshotSize.height / viewport.height : 1,
    };

    // Convert all OCR bboxes (screenshot px) to CSS px for comparison
    var ocrCss = ocr.map(function (o) {
      return Object.assign({}, o, {
        _cssPxRect: shotToCss(o.boundingBox || { x: 0, y: 0, width: 0, height: 0 }, scale),
      });
    });

    var usedOcr = new Array(ocrCss.length).fill(false);
    var fused = [];

    // ---- Step 1: For each DOM detection, find matching OCR detections -------
    for (var di = 0; di < dom.length; di++) {
      var domDet = dom[di];
      var domRect = domDet.rect; // CSS px
      var matches = [];

      for (var oi = 0; oi < ocrCss.length; oi++) {
        var ocrDet = ocrCss[oi];
        if (ocrDet.category !== domDet.category) continue; // different category

        var ocrRect = ocrDet._cssPxRect;
        var ioScore = iou(domRect, ocrRect);
        var centDist = dist(centre(domRect), centre(ocrRect));

        if (ioScore >= MIN_IOU || centDist <= MAX_CENTRE_DIST) {
          matches.push(ocrDet);
          usedOcr[oi] = true;
        }
      }

      fused.push(makeDomDet(domDet, matches));
    }

    // ---- Step 2: OCR-only detections (no matching DOM field) ----------------
    for (var oi2 = 0; oi2 < ocrCss.length; oi2++) {
      if (usedOcr[oi2]) continue;
      var ocrOnly = ocrCss[oi2];

      // Filter by minimum confidence threshold
      var ocrConf = typeof ocrOnly.confidence === "number" ? ocrOnly.confidence : 0;
      if (ocrConf < THRESHOLDS.LOW) continue;

      fused.push(makeOcrDet(ocrOnly, scale));
    }

    // ---- Step 3: De-duplicate remaining overlapping same-category rects -----
    fused = deduplicateRects(fused);

    // ---- Step 4: Filter by confidence threshold ----------------------------
    fused = fused.filter(function (d) {
      return d.confidence >= THRESHOLDS.MEDIUM;
    });

    console.debug(
      "[V3 fusion] DOM:" + dom.length +
      " OCR:" + ocr.length +
      " → fused:" + fused.length
    );

    return fused;
  }

  // ---------------------------------------------------------------------------
  // Remove duplicate rects (same category, high spatial overlap)
  // ---------------------------------------------------------------------------
  function deduplicateRects(detections) {
    var kept = [];
    var dropped = new Array(detections.length).fill(false);

    for (var i = 0; i < detections.length; i++) {
      if (dropped[i]) continue;
      for (var j = i + 1; j < detections.length; j++) {
        if (dropped[j]) continue;
        if (detections[i].category !== detections[j].category) continue;
        if (iou(detections[i].rect, detections[j].rect) >= 0.50) {
          // Keep the higher-confidence one; merge sources
          if (detections[j].confidence > detections[i].confidence) {
            // j is better: absorb i's sources into j
            detections[j].sources = uniqueArr(
              detections[j].sources.concat(detections[i].sources)
            );
            dropped[i] = true;
          } else {
            detections[i].sources = uniqueArr(
              detections[i].sources.concat(detections[j].sources)
            );
            dropped[j] = true;
          }
        }
      }
      if (!dropped[i]) kept.push(detections[i]);
    }
    return kept;
  }

  function uniqueArr(arr) {
    var seen = {};
    return arr.filter(function (v) {
      if (seen[v]) return false;
      seen[v] = true;
      return true;
    });
  }

  root.DetectionFusion = {
    fuse: fuse,
    THRESHOLDS: THRESHOLDS,
  };
})(typeof window !== "undefined" ? window : self);
