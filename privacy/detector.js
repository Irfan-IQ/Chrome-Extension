// privacy/detector.js  —  runs in the PAGE (content-script isolated world)
//
// Deterministic, rule-based DOM PII detector. NO AI model, NO network.
//
// PRIVACY RULES ENFORCED HERE:
//   * We only ever read element *metadata* (tag, type, name, id, placeholder,
//     autocomplete, aria-label, associated <label> text). We never read, store,
//     or log an element's *value*.
//   * console output describes the category only ("Detected email field"),
//     never the value.
//
// Output: an array of detection objects (see buildDetection) plus a list of
// cross-origin iframes that could not be inspected.

(function (root) {
  "use strict";

  var CU = root.CoordinateUtils;

  // Categories we support in V2.
  var CATEGORY = {
    NAME: "name",
    EMAIL: "email",
    PASSWORD: "password",
    AGE: "age",
    PHONE: "phone",
    ADDRESS: "address",
    USERNAME: "username",
    DOB: "date_of_birth",
    CREDIT_CARD: "credit_card",
  };

  // ---------------------------------------------------------------------------
  // String helpers
  // ---------------------------------------------------------------------------

  function lc(v) {
    return (v == null ? "" : String(v)).toLowerCase().trim();
  }

  // Split a string into alphanumeric tokens: "first_name-2" -> ["first","name","2"]
  function tokens(s) {
    return lc(s)
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  // Whole-token match — used for short, ambiguous words like "age" / "name"
  // so we do NOT match "page", "image", "username", "filename", ...
  function hasToken(tokenList, word) {
    return tokenList.indexOf(word) !== -1;
  }

  function hasAnyToken(tokenList, words) {
    for (var i = 0; i < words.length; i++) {
      if (hasToken(tokenList, words[i])) return true;
    }
    return false;
  }

  // Substring match — used for long, distinctive strings ("password", "cc-number")
  function containsAny(hay, needles) {
    for (var i = 0; i < needles.length; i++) {
      if (hay.indexOf(needles[i]) !== -1) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Associated label text
  // ---------------------------------------------------------------------------

  function getAssociatedLabelText(el) {
    var parts = [];

    // 1. element.labels (native label association)
    try {
      if (el.labels && el.labels.length) {
        for (var i = 0; i < el.labels.length; i++) {
          parts.push(el.labels[i].textContent || "");
        }
      }
    } catch (e) {
      /* some elements throw on .labels */
    }

    // 2. aria-labelledby -> referenced element text
    var labelledby = el.getAttribute && el.getAttribute("aria-labelledby");
    if (labelledby) {
      labelledby.split(/\s+/).forEach(function (id) {
        var ref = id && el.ownerDocument.getElementById(id);
        if (ref) parts.push(ref.textContent || "");
      });
    }

    // 3. wrapping <label>
    if (el.closest) {
      var wrap = el.closest("label");
      if (wrap) parts.push(wrap.textContent || "");
    }

    // 4. label[for=id]
    if (el.id) {
      try {
        var forLabel = el.ownerDocument.querySelector(
          'label[for="' + (root.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]'
        );
        if (forLabel) parts.push(forLabel.textContent || "");
      } catch (e) {
        /* invalid selector — ignore */
      }
    }

    // 5. a preceding sibling that looks like a caption (best effort)
    var prev = el.previousElementSibling;
    if (prev && /^(label|span|div|p|strong|b)$/i.test(prev.tagName)) {
      var t = (prev.textContent || "").trim();
      if (t && t.length <= 40) parts.push(t);
    }

    return lc(parts.join(" ").replace(/\s+/g, " ")).slice(0, 200);
  }

  // ---------------------------------------------------------------------------
  // Signal extraction — MULTIPLE attributes, all normalised to lowercase
  // ---------------------------------------------------------------------------

  function extractSignals(el) {
    var attr = function (n) {
      return lc(el.getAttribute && el.getAttribute(n));
    };
    return {
      tag: lc(el.tagName),
      type: lc(el.getAttribute && el.getAttribute("type")) || lc(el.type),
      name: attr("name"),
      id: attr("id"),
      placeholder: attr("placeholder"),
      autocomplete: attr("autocomplete"),
      ariaLabel: attr("aria-label"),
      title: attr("title"),
      inputmode: attr("inputmode"),
      labelText: getAssociatedLabelText(el),
    };
  }

  // ---------------------------------------------------------------------------
  // Category rules
  // ---------------------------------------------------------------------------
  //
  // Each rule returns { category, confidence } or null.
  // "high"   = an unambiguous structural signal (type=, autocomplete=)
  // "medium" = a keyword match across name/id/placeholder/aria/label
  // We only emit detections at medium or high confidence.

  function classify(s) {
    // Combined keyword haystack + token list from the "soft" attributes.
    var soft = [s.name, s.id, s.placeholder, s.ariaLabel, s.title, s.labelText, s.autocomplete].join(" ");
    var tk = tokens(soft);
    var ac = s.autocomplete;

    // --- PASSWORD ---------------------------------------------------------
    if (s.type === "password") return { category: CATEGORY.PASSWORD, confidence: "high" };
    if (ac === "current-password" || ac === "new-password")
      return { category: CATEGORY.PASSWORD, confidence: "high" };
    if (containsAny(soft, ["password", "passwd", "passphrase"]) || hasAnyToken(tk, ["pwd", "pass"]))
      return { category: CATEGORY.PASSWORD, confidence: "medium" };

    // --- EMAIL -----------------------------------------------------------
    if (s.type === "email") return { category: CATEGORY.EMAIL, confidence: "high" };
    if (ac === "email") return { category: CATEGORY.EMAIL, confidence: "high" };
    if (containsAny(soft, ["e-mail", "email"]) || hasToken(tk, "email"))
      return { category: CATEGORY.EMAIL, confidence: "medium" };

    // --- CREDIT / DEBIT CARD -------------------------------------------
    // Check before "number"/"address" style rules to avoid mis-bucketing.
    if (containsAny(ac, ["cc-number", "cc-num"]))
      return { category: CATEGORY.CREDIT_CARD, confidence: "high" };
    if (
      containsAny(soft, ["creditcard", "credit-card", "credit_card", "cardnumber", "card-number", "card_number", "ccnumber", "cc-number", "debitcard"]) ||
      (hasToken(tk, "card") && hasAnyToken(tk, ["number", "num", "no"]))
    )
      return { category: CATEGORY.CREDIT_CARD, confidence: "medium" };

    // --- ADDRESS -------------------------------------------------------
    if (containsAny(ac, ["street-address", "address-line1", "address-line2", "address-level1", "address-level2", "postal-code"]))
      return { category: CATEGORY.ADDRESS, confidence: "high" };
    // keyword: require a distinctive address token, and never when it is
    // really "email address" / "ip address".
    if (!containsAny(soft, ["email", "e-mail", "ip "])) {
      if (
        hasAnyToken(tk, ["address", "addr", "street", "postcode", "zipcode"]) ||
        containsAny(soft, ["street_address", "street-address", "postal_code", "postal-code", "billing_address", "shipping_address"])
      )
        return { category: CATEGORY.ADDRESS, confidence: "medium" };
    }

    // --- PHONE / MOBILE ---------------------------------------------
    if (s.type === "tel") return { category: CATEGORY.PHONE, confidence: "high" };
    if (containsAny(ac, ["tel", "tel-national"]))
      return { category: CATEGORY.PHONE, confidence: "high" };
    if (hasAnyToken(tk, ["phone", "mobile", "telephone", "tel", "msisdn", "cellphone", "cell"]) ||
        containsAny(soft, ["phone", "mobile", "telephone", "contact_number", "contact-number"]))
      return { category: CATEGORY.PHONE, confidence: "medium" };

    // --- DATE OF BIRTH -------------------------------------------
    if (containsAny(ac, ["bday", "bday-day", "bday-month", "bday-year"]))
      return { category: CATEGORY.DOB, confidence: "high" };
    if (
      containsAny(soft, ["date_of_birth", "date-of-birth", "dateofbirth", "birthdate", "birth_date", "birthday"]) ||
      hasAnyToken(tk, ["dob", "bday"]) ||
      (hasToken(tk, "birth") && hasAnyToken(tk, ["date", "day"]))
    )
      return { category: CATEGORY.DOB, confidence: "medium" };

    // --- AGE -----------------------------------------------------
    // Whole token only: avoids "page", "image", "message", "usage", "manage".
    if (hasToken(tk, "age") || (s.type === "number" && hasToken(tokens(s.name + " " + s.id), "age")))
      return { category: CATEGORY.AGE, confidence: "medium" };

    // --- USERNAME ---------------------------------------------
    if (ac === "username") return { category: CATEGORY.USERNAME, confidence: "high" };
    if (
      containsAny(soft, ["username", "user_name", "user-name", "userid", "user_id", "user-id", "screenname", "screen_name", "login_id", "loginname"]) ||
      hasAnyToken(tk, ["username", "userid", "login", "handle", "nickname", "nick"])
    )
      return { category: CATEGORY.USERNAME, confidence: "medium" };

    // --- NAME (person's name) -------------------------------
    if (containsAny(ac, ["name", "given-name", "family-name", "additional-name", "honorific-prefix"]))
      return { category: CATEGORY.NAME, confidence: "high" };
    // keyword: distinctive name tokens, but NOT username/filename/company etc.
    var nameBlocked = containsAny(soft, ["username", "user_name", "user-name", "filename", "file_name", "file-name", "nickname", "company", "business", "brand", "product", "hostname", "domain"]);
    if (!nameBlocked) {
      if (
        hasAnyToken(tk, ["fullname", "firstname", "lastname", "surname", "givenname", "middlename", "forename", "lname", "fname"]) ||
        containsAny(soft, ["full_name", "full-name", "first_name", "first-name", "last_name", "last-name", "given_name", "family_name", "middle_name"]) ||
        (hasToken(tk, "name") && hasAnyToken(tk, ["full", "first", "last", "given", "middle", "your", "legal", "real"]))
      )
        return { category: CATEGORY.NAME, confidence: "medium" };
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Selector generation (best-effort, non-throwing)
  // ---------------------------------------------------------------------------

  function cssEscape(v) {
    if (root.CSS && CSS.escape) return CSS.escape(v);
    return String(v).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function buildSelector(el) {
    if (el.id) return "#" + cssEscape(el.id);
    var tag = lc(el.tagName);
    var nm = el.getAttribute && el.getAttribute("name");
    if (nm) return tag + '[name="' + nm + '"]';
    // nth-of-type path, capped depth
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      var t = lc(node.tagName);
      var parent = node.parentElement;
      if (!parent) {
        parts.unshift(t);
        break;
      }
      var sibs = Array.prototype.filter.call(parent.children, function (c) {
        return lc(c.tagName) === t;
      });
      var idx = sibs.indexOf(node) + 1;
      parts.unshift(t + ":nth-of-type(" + idx + ")");
      node = parent;
      depth++;
    }
    return parts.join(" > ");
  }

  // ---------------------------------------------------------------------------
  // Detection object
  // ---------------------------------------------------------------------------

  function buildDetection(el, signals, verdict, rect) {
    return {
      category: verdict.category,
      elementType: el.tagName, // "INPUT" | "TEXTAREA" | "SELECT" | ...
      type: signals.type || null,
      selector: buildSelector(el),
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      confidence: verdict.confidence,
      // internal-only handle to the live element; STRIPPED before sending
      // anywhere (see contentScript.js). Never serialised.
      _el: el,
    };
  }

  // ---------------------------------------------------------------------------
  // Scan a single document (may be the top document or a same-origin iframe doc)
  // ---------------------------------------------------------------------------

  var SCAN_SELECTOR =
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

  function scanDocument(doc, viewport, frameOffset) {
    var out = [];
    var uninspectable = [];
    var els;
    try {
      els = doc.querySelectorAll(SCAN_SELECTOR);
    } catch (e) {
      return { detections: out, uninspectable: uninspectable };
    }

    for (var i = 0; i < els.length; i++) {
      var el = els[i];

      // Skip inputs that never render a value the user could leak.
      var t = lc(el.getAttribute && el.getAttribute("type"));
      if (el.tagName === "INPUT" && (t === "hidden" || t === "submit" || t === "button" || t === "reset" || t === "image" || t === "file" || t === "checkbox" || t === "radio")) {
        continue;
      }

      var rect;
      try {
        rect = el.getBoundingClientRect();
      } catch (e) {
        continue;
      }

      // Translate iframe-local coords into top-viewport coords.
      var vRect = {
        left: rect.left + frameOffset.x,
        top: rect.top + frameOffset.y,
        width: rect.width,
        height: rect.height,
      };

      // VISIBILITY: bounding rect must intersect the viewport with real size.
      if (!CU.intersectsViewport(
            { x: vRect.left, y: vRect.top, width: vRect.width, height: vRect.height },
            viewport.width, viewport.height)) {
        continue;
      }

      var signals = extractSignals(el);
      var verdict = classify(signals);
      if (!verdict) continue;

      // Privacy-safe log: category only, never the value.
      try {
        console.debug("[V2 privacy] Detected " + verdict.category + " field (" + verdict.confidence + ")");
      } catch (e) {}

      out.push(buildDetection(el, signals, verdict, vRect));
    }

    // --- iframes -------------------------------------------------------
    var frames;
    try {
      frames = doc.querySelectorAll("iframe, frame");
    } catch (e) {
      frames = [];
    }
    for (var f = 0; f < frames.length; f++) {
      var frame = frames[f];
      var fr;
      try {
        fr = frame.getBoundingClientRect();
      } catch (e) {
        continue;
      }
      var fvRect = {
        x: fr.left + frameOffset.x,
        y: fr.top + frameOffset.y,
        width: fr.width,
        height: fr.height,
      };
      if (!CU.intersectsViewport(fvRect, viewport.width, viewport.height)) continue;

      var childDoc = null;
      try {
        childDoc = frame.contentDocument;
      } catch (e) {
        childDoc = null; // cross-origin — SecurityError
      }

      if (childDoc) {
        // Same-origin: recurse (V2 basic support). Structured so deeper /
        // richer iframe handling can be added later.
        var nested = scanDocument(childDoc, viewport, { x: fvRect.x, y: fvRect.y });
        out = out.concat(nested.detections);
        uninspectable = uninspectable.concat(nested.uninspectable);
      } else {
        // Cross-origin: we CANNOT see inside. Do not pretend we scanned it.
        uninspectable.push({
          kind: "iframe",
          reason: "cross-origin",
          src: safeHost(frame.getAttribute("src")),
          rect: {
            x: Math.round(fvRect.x),
            y: Math.round(fvRect.y),
            width: Math.round(fvRect.width),
            height: Math.round(fvRect.height),
          },
        });
      }
    }

    return { detections: out, uninspectable: uninspectable };
  }

  function safeHost(url) {
    if (!url) return null;
    try {
      return new URL(url, location.href).host || null;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public entry — always scans LIVE, right now (never a stale snapshot).
  // ---------------------------------------------------------------------------

  function scan() {
    var viewport = {
      width: root.innerWidth,
      height: root.innerHeight,
      dpr: root.devicePixelRatio || 1,
      scrollX: root.scrollX || 0,
      scrollY: root.scrollY || 0,
    };
    var res = scanDocument(document, viewport, { x: 0, y: 0 });
    return {
      detections: res.detections,
      uninspectable: res.uninspectable,
      viewport: viewport,
    };
  }

  root.PrivacyDetector = { scan: scan, CATEGORY: CATEGORY };
})(typeof window !== "undefined" ? window : self);
