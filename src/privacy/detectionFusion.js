// privacy/detectionFusion.js  —  runs in the SIDE PANEL
//
// Detection fusion layer — merges detections from multiple independent sources
// (DOM, OCR+pattern, OCR+context, OCR+NER, vision) into a single deduplicated list.
// See docs/ARCHITECTURE.md for the confidence scoring rules.

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

  var ocrCss = ocr.map(function (o) {
    return Object.assign({}, o, {
      _cssPxRect: shotToCss(o.boundingBox || { x: 0, y: 0, width: 0, height: 0 }, scale),
    });
  });

  var usedOcr = new Array(ocrCss.length).fill(false);
  var fused = [];

  for (var di = 0; di < dom.length; di++) {
    var domDet = dom[di];
    var domRect = domDet.rect;
    var matches = [];

    for (var oi = 0; oi < ocrCss.length; oi++) {
      var ocrDet = ocrCss[oi];
      if (ocrDet.category !== domDet.category) continue;

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

  console.debug(
    "[V3 fusion] DOM:" + dom.length +
    " OCR:" + ocr.length +
    " → fused:" + fused.length
  );

  return fused;
}

function deduplicateRects(detections) {
  var kept = [];
  var dropped = new Array(detections.length).fill(false);

  for (var i = 0; i < detections.length; i++) {
    if (dropped[i]) continue;
    for (var j = i + 1; j < detections.length; j++) {
      if (dropped[j]) continue;
      if (detections[i].category !== detections[j].category) continue;
      if (iou(detections[i].rect, detections[j].rect) >= 0.50) {
        if (detections[j].confidence > detections[i].confidence) {
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

export const DetectionFusion = {
  fuse,
  THRESHOLDS,
};
