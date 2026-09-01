// privacy/coordinateUtils.js
//
// Pure geometry helpers shared by BOTH execution contexts:
//   - the injected page content script (reports DOM rects)
//   - the side panel (maps those rects onto the captured screenshot)
//
// No DOM access, no chrome.* calls — just math, so it is safe to load anywhere.
//
// PRIVACY / CORRECTNESS NOTE:
// CSS pixels (getBoundingClientRect) are NOT the same as screenshot pixels.
// captureVisibleTab returns an image whose size is roughly
// viewport_CSS_size * devicePixelRatio, and is further affected by browser
// zoom and OS display scaling. Rather than trust devicePixelRatio alone, we
// derive the scale empirically from (actual screenshot size / actual viewport
// size). That single ratio absorbs DPR + zoom + scaling in one step.

(function (root) {
  "use strict";

  /**
   * Derive screenshot<->viewport scale factors from real measured sizes.
   * @param {number} shotW  screenshot width in image pixels
   * @param {number} shotH  screenshot height in image pixels
   * @param {{width:number,height:number}} viewport  CSS-pixel viewport size
   * @returns {{scaleX:number, scaleY:number}}
   */
  function computeViewportScale(shotW, shotH, viewport) {
    const vw = viewport && viewport.width ? viewport.width : shotW;
    const vh = viewport && viewport.height ? viewport.height : shotH;
    return {
      scaleX: vw > 0 ? shotW / vw : 1,
      scaleY: vh > 0 ? shotH / vh : 1,
    };
  }

  /**
   * Convert a viewport-relative DOM rect into a screenshot-pixel rect.
   * A few px of padding is added so anti-aliased edges are fully covered.
   * @param {{x:number,y:number,width:number,height:number}} rect
   * @param {{scaleX:number,scaleY:number}} scale
   * @param {number} [pad=3] padding in CSS pixels applied before scaling
   * @returns {{x:number,y:number,w:number,h:number}}
   */
  function domRectToImageRect(rect, scale, pad) {
    const p = typeof pad === "number" ? pad : 3;
    const x = (rect.x - p) * scale.scaleX;
    const y = (rect.y - p) * scale.scaleY;
    const w = (rect.width + p * 2) * scale.scaleX;
    const h = (rect.height + p * 2) * scale.scaleY;
    return {
      x: Math.max(0, Math.floor(x)),
      y: Math.max(0, Math.floor(y)),
      w: Math.ceil(w),
      h: Math.ceil(h),
    };
  }

  /**
   * True when a DOM rect meaningfully intersects the viewport and has a
   * usable size. Used as the "visible in viewport" test.
   * @param {{x:number,y:number,width:number,height:number}} rect
   * @param {number} vpW viewport width (CSS px)
   * @param {number} vpH viewport height (CSS px)
   * @param {number} [minSize=8] minimum width AND height in CSS px
   */
  function intersectsViewport(rect, vpW, vpH, minSize) {
    const m = typeof minSize === "number" ? minSize : 8;
    if (rect.width < m || rect.height < m) return false;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    return right > 0 && bottom > 0 && rect.x < vpW && rect.y < vpH;
  }

  /** Clamp an image rect to the image bounds so fillRect never overflows. */
  function clampImageRect(r, imgW, imgH) {
    const x = Math.min(Math.max(0, r.x), imgW);
    const y = Math.min(Math.max(0, r.y), imgH);
    return {
      x: x,
      y: y,
      w: Math.min(r.w, imgW - x),
      h: Math.min(r.h, imgH - y),
    };
  }

  const api = {
    computeViewportScale,
    domRectToImageRect,
    intersectsViewport,
    clampImageRect,
  };

  // Expose on whatever global object exists (window in both content script
  // world and side panel; self in a worker).
  root.CoordinateUtils = api;
})(typeof window !== "undefined" ? window : self);
