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

    // 6. Walk UP ancestor chain looking for a container that has a short
    //    text-only sibling or heading — handles Google Forms, Material-UI,
    //    Ant Design, etc. where labels are divs above inputs (up to 5 levels).
    if (parts.length === 0 && el.closest) {
      var node = el.parentElement;
      for (var lvl = 0; lvl < 5 && node; lvl++) {
        // Try: previous sibling of this ancestor
        var ps = node.previousElementSibling;
        if (ps) {
          var psText = (ps.textContent || "").trim();
          if (psText && psText.length <= 80) { parts.push(psText); break; }
        }
        // Try: first child text of parent that is clearly a heading / label role
        var fc = node.firstElementChild;
        if (fc && fc !== el) {
          var fcText = (fc.textContent || "").trim();
          // Only grab it if it's short and looks like a label (not the input itself)
          if (fcText && fcText.length <= 60 &&
              !/^\s*(password|email)\s*$/i.test(fcText) === false ||
              fcText.length <= 60) {
            parts.push(fcText); break;
          }
        }
        node = node.parentElement;
      }
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

    // --- USERNAME / STUDENT / REGISTRATION ID --------------------
    if (ac === "username") return { category: CATEGORY.USERNAME, confidence: "high" };
    if (
      containsAny(soft, ["username", "user_name", "user-name", "userid", "user_id", "user-id", "screenname", "screen_name", "login_id", "loginname"]) ||
      hasAnyToken(tk, ["username", "userid", "login", "handle", "nickname", "nick"])
    )
      return { category: CATEGORY.USERNAME, confidence: "medium" };
    // Student / institutional identifiers (register number, roll number, etc.)
    if (containsAny(soft, [
      "register number", "register no", "reg number", "reg no",
      "roll number", "roll no", "rollno",
      "student id", "student number", "student no",
      "enrolment", "enrollment", "admission number", "admission no",
      "application id", "application no", "applicant id",
    ]))
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

      // Plain "Name" label alone (common in simple forms / Google Forms):
      // accept medium confidence when the *only* meaningful token is "name" and
      // the element is a plain text input (not search, number, etc.)
      if (hasToken(tk, "name") && s.type !== "search" && s.type !== "number" &&
          s.type !== "email" && s.type !== "tel" && s.tag !== "select") {
        return { category: CATEGORY.NAME, confidence: "medium" };
      }
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

  // Regex for structural PII visible in static DOM text (not form fields).
  // These patterns are distinctive enough to flag without needing label context.
  var TEXT_NODE_PATTERNS = [
    { re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, category: CATEGORY.EMAIL },
    { re: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/, category: "ssn" },
  ];

  // Scan visible TEXT nodes in an element's subtree for structural PII patterns.
  // Returns detections (with _el = the element whose rect we use for masking).
  function scanTextNodes(doc, viewport, frameOffset) {
    var out = [];
    // Walk label, span, div, p, td elements that may contain PII as plain text.
    var candidates;
    try {
      candidates = doc.querySelectorAll("label, span, p, div, td, li");
    } catch (e) { return out; }

    var seen = new Set ? new Set() : { _s: [], has: function(v){ return this._s.indexOf(v) !== -1; }, add: function(v){ this._s.push(v); } };

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      // Skip elements that contain child elements (to avoid double-counting).
      // We only want leaf-ish nodes.
      if (el.children && el.children.length > 3) continue;
      var text = (el.textContent || "").trim();
      if (!text || text.length > 300) continue;

      for (var pi = 0; pi < TEXT_NODE_PATTERNS.length; pi++) {
        var pat = TEXT_NODE_PATTERNS[pi];
        var m = text.match(pat.re);
        if (!m) continue;
        var matched = m[0];
        // Deduplicate by matched text to avoid flagging the same email 10 times
        if (seen.has(matched)) continue;
        seen.add(matched);

        var rect;
        try { rect = el.getBoundingClientRect(); } catch (e) { continue; }
        var vRect = {
          left: rect.left + frameOffset.x,
          top:  rect.top  + frameOffset.y,
          width: rect.width,
          height: rect.height,
        };
        if (!CU.intersectsViewport(
              { x: vRect.left, y: vRect.top, width: vRect.width, height: vRect.height },
              viewport.width, viewport.height)) continue;
        if (vRect.width < 4 || vRect.height < 4) continue;

        try {
          console.debug("[V3 dom] Detected " + pat.category + " in text node");
        } catch (e) {}

        out.push({
          category: pat.category,
          elementType: el.tagName,
          type: null,
          selector: buildSelector(el),
          rect: {
            x: Math.round(vRect.left),
            y: Math.round(vRect.top),
            width: Math.round(vRect.width),
            height: Math.round(vRect.height),
          },
          confidence: "high",
          _el: el,
          _isTextNode: true,   // tells domSanitizer to mask in screenshot only
        });
        break; // one pattern match per element is enough
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Label-keyword → PII category mapping for static display elements.
  // Applied to the TEXT of a label/header element to infer what the adjacent
  // value element contains.
  // ---------------------------------------------------------------------------
  var LABEL_PII_RULES = [
    // Name variations (must not match "username", "filename", "company", etc.)
    { re: /\b(applicant|student|candidate|full|first|last|given|family|middle|your|member|customer|account)\s*name\b/i, category: CATEGORY.NAME },
    { re: /\bname\b(?!.*\b(user|file|company|domain|host|product|brand|nick)\b)/i,                                     category: CATEGORY.NAME },
    // Email
    { re: /\be-?mail\b/i,                                                                                               category: CATEGORY.EMAIL },
    // Phone / mobile
    { re: /\b(phone|mobile|telephone|contact\s*number|cell)\b/i,                                                       category: CATEGORY.PHONE },
    // Address
    { re: /\b(address|street|city|zip|postal|pincode|postcode)\b/i,                                                     category: CATEGORY.ADDRESS },
    // Date of birth
    { re: /\b(date\s*of\s*birth|d\.?o\.?b|birth\s*date|birthday)\b/i,                                                  category: CATEGORY.DOB },
    // Age
    { re: /^\s*age\s*:?\s*$/i,                                                                                          category: CATEGORY.AGE },
    // Username / login
    { re: /\b(username|user\s*id|login|handle|screen\s*name)\b/i,                                                      category: CATEGORY.USERNAME },
    // Student / institutional identifiers
    { re: /\b(register\s*(no|num|number)|reg\s*(no|num|number)|roll\s*(no|num|number)|rollno|student\s*(id|no|num|number)|enrolment|enrollment|admission\s*(no|num|number)|application\s*(id|no))\b/i, category: CATEGORY.USERNAME },
    // Credit / debit card
    { re: /\b(credit\s*card|debit\s*card|card\s*number|cc\s*no)\b/i,                                                   category: CATEGORY.CREDIT_CARD },
    // National / government IDs
    { re: /\b(ssn|social\s*security|national\s*id|aadhaar|aadhar|pan\s*(card|no)?|passport\s*no|id\s*number)\b/i,      category: "ssn" },
  ];

  function classifyLabelText(labelText) {
    for (var i = 0; i < LABEL_PII_RULES.length; i++) {
      if (LABEL_PII_RULES[i].re.test(labelText)) {
        return LABEL_PII_RULES[i].category;
      }
    }
    return null;
  }

  // Find the value element paired with a label element.
  // Tries: nextElementSibling of the label, then nextElementSibling of the
  // label's parent container (handles patterns where label + value share a
  // wrapper div and the value is the sibling of the wrapper).
  function findValueElement(labelEl) {
    // Most common: immediate next sibling
    var sib = labelEl.nextElementSibling;
    if (sib) {
      var t = (sib.textContent || "").trim();
      if (t && t.length > 0 && t.length < 300) return sib;
    }
    // Also try: the label's parent container's next sibling
    var parent = labelEl.parentElement;
    if (parent) {
      var psib = parent.nextElementSibling;
      if (psib) {
        var pt = (psib.textContent || "").trim();
        if (pt && pt.length > 0 && pt.length < 300) return psib;
      }
    }
    return null;
  }

  // Scan for label→value pairs in static (non-form) display content.
  // Works without OCR — reads the DOM directly.
  function scanLabeledStaticValues(doc, viewport, frameOffset) {
    var out = [];
    // Cast a wide net: any small inline/block element could be a label.
    // We filter by text content below.
    var candidates;
    try {
      // Query elements that are typically used as labels in card/profile UIs.
      // Also include <dt> (definition list term) and <th>.
      candidates = doc.querySelectorAll(
        'span, div, p, label, dt, th, ' +
        '[class*="label"], [class*="key"], [class*="header"], [class*="title"], ' +
        '[class*="caption"], [class*="field-name"]'
      );
    } catch (e) { return out; }

    // Track value elements we've already emitted to avoid duplicates.
    var emitted = new Set ? new Set() : {
      _s: [], has: function(v){ return this._s.indexOf(v)!==-1; }, add: function(v){ this._s.push(v); }
    };

    for (var i = 0; i < candidates.length; i++) {
      var labelEl = candidates[i];

      // Only consider true leaf elements — no child elements at all.
      // Container divs (e.g. a wrapper holding a label+value pair) have
      // children.length >= 1 and must be excluded, otherwise their combined
      // textContent (label text + value text) falsely matches a PII keyword
      // and their next sibling gets flagged as the "value".
      if (labelEl.childElementCount > 0) continue;

      var labelText = (labelEl.textContent || "").trim();
      // Labels are short; skip anything long
      if (!labelText || labelText.length > 80) continue;

      var category = classifyLabelText(labelText);
      if (!category) continue;

      var valueEl = findValueElement(labelEl);
      if (!valueEl) continue;
      // Don't emit if we already captured this element
      if (emitted.has(valueEl)) continue;
      // Skip if the value element is a form field (already handled by form scanner)
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(valueEl.tagName)) continue;

      var valueText = (valueEl.textContent || "").trim();
      if (!valueText || valueText.length < 1) continue;

      // Skip elements that are punctuation-only or too short to be real values.
      // This filters out required-field indicators like "*" or "†" that appear
      // as the next sibling of a label span in Google Forms and similar UIs.
      var alphanumLen = valueText.replace(/[^a-zA-Z0-9]/g, "").length;
      if (alphanumLen < 2) continue;

      // Also skip if the value element is itself a form field — the form-field
      // scanner already handles inputs; don't double-detect with a wrong rect.
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(valueEl.tagName)) continue;

      // For name fields: do a basic sanity check — value should look like a name
      // (not a date, number, or URL). At least one alphabetic word.
      if (category === CATEGORY.NAME && !/[A-Za-z]{2}/.test(valueText)) continue;

      var rect;
      try { rect = valueEl.getBoundingClientRect(); } catch (e) { continue; }

      var vRect = {
        left: rect.left + frameOffset.x,
        top:  rect.top  + frameOffset.y,
        width: rect.width,
        height: rect.height,
      };

      if (!CU.intersectsViewport(
            { x: vRect.left, y: vRect.top, width: vRect.width, height: vRect.height },
            viewport.width, viewport.height)) continue;
      if (vRect.width < 4 || vRect.height < 4) continue;

      emitted.add(valueEl);

      try {
        console.debug("[V3 dom] label->value: " + category + " (label: '" + labelText.slice(0, 20) + "')");
      } catch (e) {}

      out.push({
        category: category,
        elementType: valueEl.tagName,
        type: null,
        selector: buildSelector(valueEl),
        rect: {
          x: Math.round(vRect.left),
          y: Math.round(vRect.top),
          width: Math.round(vRect.width),
          height: Math.round(vRect.height),
        },
        confidence: "high",
        _el: valueEl,
        _isTextNode: true,   // screenshot-only mask — don't mutate display text
      });
    }
    return out;
  }

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

    // Also scan visible text nodes for structural PII (emails in labels, etc.)
    var textNodeDets = scanTextNodes(doc, viewport, frameOffset);
    out = out.concat(textNodeDets);

    // Scan label→value pairs in static display content (cards, profile pages,
    // dashboards — any place where a label div/span precedes a value div/span).
    var labelValueDets = scanLabeledStaticValues(doc, viewport, frameOffset);
    out = out.concat(labelValueDets);

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
