/* ------------------------------------------------------------------ *
 *  License codes — offline validation
 *
 *  WHAT THIS IS
 *  A code is 12 characters in Crockford base32 (no I, L, O, U — the four
 *  characters people mistype). The first 9 carry the value, the last 3 are
 *  a checksum derived from them.
 *
 *  WHAT THIS IS NOT
 *  This is not encryption and it is not copy protection. Every line here is
 *  sent to the browser, so anyone who can read JavaScript can read the rule.
 *  What it actually buys you is friction: a stranger cannot invent a working
 *  code by typing one, and a leaked code is traceable to whichever batch it
 *  came from. Do not tell users this is "secure". Say what it is.
 *
 *  The real conversion mechanic is elsewhere — paying is one click, and the
 *  person has already seen the value before buying. That is the part worth
 *  defending; the code itself is just the receipt.
 * ------------------------------------------------------------------ */

var LIC_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var LIC_SALT     = "resume-match-2026";

function fnv1a(s){
  var h = 0x811c9dc5;
  for(var i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    // multiply by the FNV prime keeping it in unsigned 32-bit space
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

function licChecksum(payload){
  var h = fnv1a(payload + "|" + LIC_SALT);
  var n = LIC_ALPHABET.length;
  var out = "";
  for(var i = 0; i < 3; i++){
    out = LIC_ALPHABET.charAt(h % n) + out;
    h = Math.floor(h / n);
  }
  return out;
}

/* Accepts anything vaguely shaped like a code and returns whether it is valid.
   Strips case, spaces and dashes so pasted emails and mobile keyboards work. */
function licValid(raw){
  if(!raw) return false;
  var s = String(raw).toUpperCase().replace(/[^0-9A-Z]/g, "");

  // Crockford: people read O as 0 and I/L as 1. Rewrite instead of rejecting.
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");

  if(s.length !== 12) return false;
  if(s.indexOf(LIC_ALPHABET.charAt(0)) === -1 && !/^[0-9A-Z]+$/.test(s)) return false;

  for(var i = 0; i < s.length; i++){
    if(LIC_ALPHABET.indexOf(s.charAt(i)) === -1) return false;
  }
  return licChecksum(s.slice(0, 9)) === s.slice(9);
}

function licFormat(raw){
  var s = String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if(s.length !== 12) return s;
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12);
}

if(typeof window !== "undefined"){
  // Deliberately mirrors what the Node build exports, so the same file can be
  // tested offline and shipped to the browser with no build step.
  window.__rmLicense = { valid: licValid, format: licFormat, checksum: licChecksum };
}

if(typeof module !== "undefined" && module.exports){
  module.exports = { licValid: licValid, licChecksum: licChecksum, licFormat: licFormat };
}
