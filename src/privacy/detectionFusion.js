// privacy/detectionFusion.js  —  runs in the SIDE PANEL
//
// Detection fusion layer — merges detections from multiple independent sources
// (DOM, OCR+pattern, OCR+context, OCR+NER, vision) into a single deduplicated list.
// See docs/ARCHITECTURE.md for the confidence scoring rules.

import { debug } from '../debug.js';

var THRESHOLDS = {
  HIGH: 0.80,
  MEDIUM: 0.60,
  LOW: 0.40,
};

var MIN_IOU = 0.20;
var MAX_CENTRE_DIST = 80;

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

function centre(r) { return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }

function dist(c1, c2) {
  var dx = c1.x - c2.x;
  var dy = c1.y - c2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

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

function shotToCss(rect, scale) {
  return {
    x: rect.x / scale.scaleX,
    y: rect.y / scale.scaleY,
    width: rect.width / scale.scaleX,
    height: rect.height / scale.scaleY,
  };
}

function makeDomDet(domDet, matchingOcr) {
  var sources = ["dom"];
  var baseConf = domBaseConfidence(domDet);
  var extraBonus = 0;

  for (var i = 0; i < matchingOcr.length; i++) {
    var o = matchingOcr[i];
    (o.sources || []).forEach(function (s) {
      if (sources.indexOf(s) === -1) sources.push(s);
    });
    extraBonus += sourceBonus(o.sources || []) * 0.5;
    extraBonus += 0.10;
  }

  var finalConf = Math.min(0.99, baseConf + extraBonus);

  return {
    category: domDet.category,
    confidence: finalConf,
    confidenceLabel: confLabel(finalConf),
    rect: domDet.rect,
    sources: sources,
    elementType: domDet.elementType || null,
    selector: domDet.selector || null,
    ocrEvidence: matchingOcr.map(function (o) {
      return { sources: o.sources, evidence: o.evidence || null };
    }),
  };
}

function makeOcrDet(ocrDet, scale) {
  var sources = ocrDet.sources || ["ocr"];
  var baseConf = typeof ocrDet.confidence === "number" ? ocrDet.confidence : 0.50;
  if (sources.indexOf("vision") === -1) {
    baseConf = Math.min(0.99, baseConf + sourceBonus(sources));
  }

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

function fuse(domDetections, ocrDetections, viewport, screenshotSize) {
  var dom = Array.isArray(domDetections) ? domDetections : [];
  var ocr = Array.isArray(ocrDetections) ? ocrDetections : [];

  var scale = {
    scaleX: screenshotSize && screenshotSize.width && viewport && viewport.width
      ? screenshotSize.width / viewport.width : 1,
    scaleY: screenshotSize && screenshotSize.height && viewport && viewport.height
      ? screenshotSize.height / viewport.height : 1,
  };

  // Group OCR detections by category up-front so each DOM detection only
  // iterates its own category's bucket instead of the full OCR list. For
  // pages with large N × M across many categories this cuts the inner loop
  // from O(dom × ocr) to roughly O(dom + ocr) in practice.
  var ocrByCategory = Object.create(null);
  var ocrCss = new Array(ocr.length);
  for (var k = 0; k < ocr.length; k++) {
    var withCss = Object.assign({}, ocr[k], {
      _cssPxRect: shotToCss(ocr[k].boundingBox || { x: 0, y: 0, width: 0, height: 0 }, scale),
      _idx: k,
    });
    ocrCss[k] = withCss;
    var cat = withCss.category;
    (ocrByCategory[cat] || (ocrByCategory[cat] = [])).push(withCss);
  }

  var usedOcr = new Array(ocrCss.length).fill(false);
  var fused = [];

  for (var di = 0; di < dom.length; di++) {
    var domDet = dom[di];
    var domRect = domDet.rect;
    var matches = [];
    var bucket = ocrByCategory[domDet.category] || [];
    var domCentre = centre(domRect);

    for (var bi = 0; bi < bucket.length; bi++) {
      var ocrDet = bucket[bi];
      var ocrRect = ocrDet._cssPxRect;

      // Cheap AABB-overlap short-circuit before computing IoU / distance.
      // Treat MAX_CENTRE_DIST as a Chebyshev-ish neighbourhood.
      var dx = (ocrRect.x + ocrRect.width / 2) - domCentre.x;
      var dy = (ocrRect.y + ocrRect.height / 2) - domCentre.y;
      if (Math.abs(dx) > MAX_CENTRE_DIST && Math.abs(dy) > MAX_CENTRE_DIST) continue;

      var ioScore = iou(domRect, ocrRect);
      var centDist = Math.sqrt(dx * dx + dy * dy);

      if (ioScore >= MIN_IOU || centDist <= MAX_CENTRE_DIST) {
        matches.push(ocrDet);
        usedOcr[ocrDet._idx] = true;
      }
    }

    fused.push(makeDomDet(domDet, matches));
  }

  for (var oi2 = 0; oi2 < ocrCss.length; oi2++) {
    if (usedOcr[oi2]) continue;
    var ocrOnly = ocrCss[oi2];

    var ocrConf = typeof ocrOnly.confidence === "number" ? ocrOnly.confidence : 0;
    if (ocrConf < THRESHOLDS.LOW) continue;

    fused.push(makeOcrDet(ocrOnly, scale));
  }

  fused = deduplicateRects(fused);

  fused = fused.filter(function (d) {
    return d.confidence >= THRESHOLDS.MEDIUM;
  });

  debug(
    "[V3 fusion] DOM:" + dom.length +
    " OCR:" + ocr.length +
    " → fused:" + fused.length
  );

  return fused;
}

function deduplicateRects(detections) {
  // Bucket by category first so the pairwise scan only touches same-category
  // pairs. For a page with K categories the worst case drops from
  // O(N^2) to O(sum_k n_k^2), typically much smaller when K > 1.
  var buckets = Object.create(null);
  for (var i = 0; i < detections.length; i++) {
    var cat = detections[i].category;
    (buckets[cat] || (buckets[cat] = [])).push(i);
  }

  var dropped = new Array(detections.length).fill(false);

  for (var catKey in buckets) {
    var idxs = buckets[catKey];
    for (var ai = 0; ai < idxs.length; ai++) {
      var i0 = idxs[ai];
      if (dropped[i0]) continue;
      for (var aj = ai + 1; aj < idxs.length; aj++) {
        var i1 = idxs[aj];
        if (dropped[i1]) continue;
        if (iou(detections[i0].rect, detections[i1].rect) >= 0.50) {
          if (detections[i1].confidence > detections[i0].confidence) {
            detections[i1].sources = uniqueArr(
              detections[i1].sources.concat(detections[i0].sources)
            );
            dropped[i0] = true;
            break;
          } else {
            detections[i0].sources = uniqueArr(
              detections[i0].sources.concat(detections[i1].sources)
            );
            dropped[i1] = true;
          }
        }
      }
    }
  }

  var kept = [];
  for (var r = 0; r < detections.length; r++) {
    if (!dropped[r]) kept.push(detections[r]);
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

export const DetectionFusion = {
  fuse,
  THRESHOLDS,
};
