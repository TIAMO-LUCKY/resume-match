/* Resume <-> JD Match
   Everything below runs in the browser. No network calls are made, by design. */

/* ------------------------------------------------------------------ *
 *  0. SETTINGS — the two things you change before going live
 * ------------------------------------------------------------------ */

var FREE_MISSING = 5;      // how many missing keywords are shown before the unlock

// Put your real Lemon Squeezy / Gumroad checkout URL here. Everything else on
// the page is already wired to this one variable.
var CHECKOUT_URL = "";

// Shown when CHECKOUT_URL is still empty. Lets the page ship while the payment
// provider is still reviewing the store -- an honest waiting list beats a dead
// button, and it starts collecting the emails you will want on launch day.
var NOTIFY_EMAIL = "1728023981@qq.com";

// A demo code so the paywall can be tried without paying. Delete this before
// deploying, otherwise "RM-DEMO-0000-0000" style codes float around forever.
var DEMO_CODE = "";

var UNLOCK_STORE = "resume-match-unlocked-v1";

var state = { unlocked:false, resumeXml:null, hfXml:"", resumeText:"", fromDocx:false, result:null };

/* Unlocking persists. Someone paid for this — a refresh taking their report
   away is how refunds happen, so the code is kept in localStorage and also
   accepted from ?unlock= so the checkout can hand it straight back. */
function unlockFns(){
  var fns = window.__rmLicense;
  return fns || { valid:function(){ return false; }, format:function(s){ return String(s||""); } };
}
function isValidCode(c){
  return unlockFns().valid(c);
}
function storeUnlock(code){
  try { localStorage.setItem(UNLOCK_STORE, code); } catch(e){ /* private mode */ }
}
function readStoredUnlock(){
  try {
    var c = localStorage.getItem(UNLOCK_STORE);
    return isValidCode(c) ? c : null;
  } catch(e){ return null; }
}
function applyUnlock(code){
  if(!isValidCode(code)) return false;
  state.unlocked = true;
  storeUnlock(code);
  return true;
}

/* Somebody who just paid lands back on a page that looks identical to the one
   they left. Nothing says it worked. That silence is where refunds come from,
   so it gets a banner they cannot miss. */
function announceUnlock(){
  function show(){
    if(!document.body) return;
    if(document.getElementById("paidbar")) return;
    var bar = document.createElement("div");
    bar.id = "paidbar";
    bar.className = "paidbar";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      "<span><b>Payment received &mdash; you are unlocked.</b> There is no account to " +
      "log into; this browser remembers it, so you can close the tab and come back.</span>" +
      "<button aria-label='Dismiss'>&times;</button>";
    bar.querySelector("button").onclick = function(){ bar.parentNode.removeChild(bar); };
    document.body.insertBefore(bar, document.body.firstChild);
    setTimeout(function(){
      if(!bar.parentNode) return;
      bar.style.opacity = "0";
      setTimeout(function(){ if(bar.parentNode) bar.parentNode.removeChild(bar); }, 400);
    }, 15000);
  }
  if(document.body) show();
  else document.addEventListener("DOMContentLoaded", show);
}

/* Runs once on load. Order matters: a fresh code in the URL beats whatever is
   already stored, because that is the person arriving back from paying. */
(function restoreUnlock(){
  var fromUrl = null;
  try {
    fromUrl = new URLSearchParams(location.search).get("unlock");
  } catch(e){}

  if(fromUrl && applyUnlock(fromUrl)){
    // Scrub it from the address bar so a bookmark or share does not leak it.
    try {
      var u = new URL(location.href);
      u.searchParams.delete("unlock");
      history.replaceState({}, "", u.toString());
    } catch(e){}
    announceUnlock();
    return;
  }
  var stored = readStoredUnlock();
  if(stored){ state.unlocked = true; }
})();

/* ------------------------------------------------------------------ *
 * 1. DOCX reading
 * ------------------------------------------------------------------ */

function readDocx(file){
  return JSZip.loadAsync(file).then(function(zip){
    var names = Object.keys(zip.files);
    if(!names.length) throw new Error("The file is empty — nothing is inside it.");

    // An encrypted docx is still a zip, but the body is wrapped in an opaque
    // package. Say so explicitly instead of failing with a zip error, because
    // the fix (save an unprotected copy) is three clicks and not obvious.
    if(names.some(function(n){ return /EncryptedPackage|DataSpaces\//.test(n); }))
      throw new Error("This document is password-protected. Open it in Word and save a copy without a password first.");

    if(names.indexOf("word/document.xml") === -1)
      throw new Error("There is no word/document.xml inside it, so it is not a real Word file despite the name.");

    var want  = ["word/document.xml"];
    names.forEach(function(n){ if(/^word\/(header|footer)\d*\.xml$/.test(n)) want.push(n); });

    var jobs = want.map(function(n){
      return zip.files[n] ? zip.files[n].async("string").then(function(s){ return [n, s]; })
                          : Promise.resolve([n, ""]);
    });
    return Promise.all(jobs);
  }).then(function(pairs){
    var doc = "", hf = "";
    pairs.forEach(function(p){
      if(p[0] === "word/document.xml") doc = p[1]; else hf += p[1];
    });
    if(!doc) throw new Error("That .docx has no readable body — it may be corrupt.");
    return { xml: doc, headerFooter: hf };
  });
}

/*
  PDF reading via pdf.js, loaded from the local lib folder like JSZip.
  pdf.js spawns a Web Worker, and browsers refuse workers from file:// — so on a
  double-clicked page this can fail. It is caught and the caller falls back to
  asking for pasted text, which still gives full keyword matching.
*/
function readPdf(file){
  return file.arrayBuffer().then(function(buf){
    if(typeof pdfjsLib === "undefined")
      throw new Error("PDF reader unavailable — pdf.js did not load from lib/.");
    try { pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js"; } catch(e){}
    return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise.then(function(pdf){
      var jobs = [];
      for(var i = 1; i <= pdf.numPages; i++) (function(n){
        jobs.push(pdf.getPage(n).then(function(page){
          return page.getTextContent().then(function(tc){
            // pdf.js hands back positioned fragments, not lines. Group them back
            // into lines by vertical position, otherwise words from different
            // columns arrive interleaved.
            var items = tc.items.slice().sort(function(a, b){
              var dy = b.transform[5] - a.transform[5];
              return Math.abs(dy) > 2 ? dy : a.transform[4] - b.transform[4];
            });
            var lines = [], cur = null;
            items.forEach(function(it){
              var s = it.str;
              if(!s || !s.trim()) return;
              var y = it.transform[5];
              if(cur === null || Math.abs(y - cur.y) > 3){ cur = { y: y, parts: [s] }; lines.push(cur); }
              else { cur.parts.push(s); }
            });
            return lines.map(function(l){ return l.parts.join(" ").replace(/\s+/g, " "); }).join("\n");
          });
        }));
      })(i);
      return Promise.all(jobs).then(function(ls){
        return { text: ls.join("\n").trim(), pages: pdf.numPages };
      });
    });
  });
}

function paragraphs(xml){
  var out = [];
  var re = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, m;
  while((m = re.exec(xml))){
    var body = m[1];
    var t = [], tm;
    var tre = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    while((tm = tre.exec(body))) t.push(tm[1]);
    var text = t.join("");
    // A paragraph holding a pict/textbox carries text that most parsers never
    // see. Flagging it matters: otherwise this tool would count a text-box
    // email address as "present in the body" and miss the exact failure it
    // exists to catch.
    out.push({
      text: text,
      isList:  /<w:numPr\b/.test(body),
      bold:    /<w:b\b/.test(body),
      size:    sizeOf(body),
      inBox:   /<w:txbxContent\b/.test(body) || /<w:pict\b/.test(body)
    });
  }
  return out;
}

function sizeOf(paraXml){
  var m = /<w:sz\b[^>]*w:val="(\d+)"/.exec(paraXml);
  if(m) return parseInt(m[1], 10) / 2;
  m = /<w:szCs\b[^>]*w:val="(\d+)"/.exec(paraXml);
  if(m) return parseInt(m[1], 10) / 2;
  return null;
}

function plainText(paras){
  return paras.map(function(p){ return p.text; }).join("\n");
}

// What a parser can actually see: body paragraphs, minus anything in a text box.
function visibleText(paras){
  var v = paras.filter(function(p){ return !p.inBox; });
  var t = plainText(v.length ? v : paras);
  return t.trim() ? t : plainText(paras);
}

/* ------------------------------------------------------------------ *
 * 2. Parsing checks — these read the DOCUMENT STRUCTURE, not just
 *    words. This is what a text-only checker cannot do.
 * ------------------------------------------------------------------ */

function parseChecks(xml, paras, headerFooter){
  var checks = [];
  var body   = paras.filter(function(p){ return !p.inBox; });
  if(!body.length) body = paras;
  var full   = plainText(body);
  var words  = (full.match(/[A-Za-z][A-Za-z'-]+/g) || []).length;

  var boxes = (xml.match(/<w:txbxContent\b/g) || []).length;
  var boxText = "";
  var bx = /<w:txbxContent\b[\s\S]*?<\/w:txbxContent>/g, bm;
  while((bm = bx.exec(xml))){
    var bt = [], btm; var bre = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    while((btm = bre.exec(bm[0]))) bt.push(btm[1]);
    boxText += bt.join(" ") + " ";
  }
  if(boxes){
    checks.push({
      level:"err",
      title: boxes + " text box" + (boxes > 1 ? "es" : "") + " found",
      desc: "Text boxes are the most common reason a resume parses as blank or half-blank. Many parsers read the surrounding paragraph and skip the box entirely.",
      fix: "Move this content into normal body paragraphs" +
           (boxText.trim() ? " — currently inside: \u201c" + boxText.trim().slice(0,90) + "\u201d" : "") + ".",
      locked:false
    });
  } else {
    checks.push({ level:"pass", title:"No text boxes", desc:"Nothing is hidden in a floating box a parser would skip.", fix:"", locked:false });
  }

  var tables = (xml.match(/<w:tbl\b/g) || []).length;
  if(tables){
    checks.push({
      level:"warn",
      title: tables + " table" + (tables > 1 ? "s" : "") + " in the layout",
      desc: "A small skills grid is fine, but parsers read cells left-to-right by row. A two-column layout built with tables often merges job titles into dates.",
      fix: "Keep tables only for genuinely tabular content. If a table is doing page layout, replace it with plain paragraphs.",
      locked:false
    });
  } else {
    checks.push({ level:"pass", title:"No layout tables", desc:"Content flows in reading order, which is how parsers read.", fix:"", locked:false });
  }

  var multi = /<w:cols\b[^>]*w:num="([2-9])"/.exec(xml);
  if(multi){
    checks.push({
      level:"err",
      title: "Multi-column section detected (" + multi[1] + " columns)",
      desc: "Column layouts are the classic parsing failure: the left column is read to the bottom before the right begins, so your chronology comes out scrambled.",
      fix: "Switch the section to a single column (Layout > Columns > One).",
      locked:false
    });
  }

  var imgs = (xml.match(/<w:drawing\b/g) || []).length + (xml.match(/<w:pict\b/g) || []).length;
  if(imgs > 1){
    checks.push({
      level:"warn",
      title: imgs + " embedded images",
      desc: "Logos, icons and skill-rating bars add nothing a parser can read, and icon-heavy contact lines often leave the contact details unreadable.",
      fix: "Delete decorative graphics. If you use icon+text for phone or email, replace with plain text.",
      locked:false
    });
  }

  var email = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
  var phone = /(\+?\d[\d\s().-]{7,}\d)/;
  var bodyHasEmail = email.test(full);
  var hfHasContact = email.test(headerFooter) || phone.test(headerFooter);

  if(!bodyHasEmail){
    checks.push({
      level:"err",
      title: "No email address found in the body",
      desc: "If your contact line lives in the header or a text box, a number of parsers return no email at all — and you become uncontactable.",
      fix: "Put your email as plain text in the first paragraph of the document body.",
      locked:false
    });
  } else if(hfHasContact){
    checks.push({
      level:"warn",
      title: "Contact details also sit in the header",
      desc: "Your body has them too, which is what matters. The header copy is harmless but may be read as duplicate text.",
      fix: "Optional: remove the header copy so only one version exists.",
      locked:false
    });
  } else {
    checks.push({ level:"pass", title:"Contact email is in the body", desc:"Parsers read the body first. This is where your email needs to be.", fix:"", locked:false });
  }

  var joined = full.toLowerCase();
  var wanted = { "experience":/experien|employ|work history|career/, "education":/education|academic|degree/, "skills":/skills|technolog|tools|competenc/ };
  var missingSections = [];
  Object.keys(wanted).forEach(function(k){ if(!wanted[k].test(joined)) missingSections.push(k); });
  if(missingSections.length){
    checks.push({
      level:"warn",
      title: "No heading found for: " + missingSections.join(", "),
      desc: "Parsers look for conventional section names to map your file into their fields. Creative headings like \u201cMy Journey\u201d land in the wrong field or get dropped.",
      fix: "Rename to the standard wording: \u201cWork Experience\u201d, \u201cEducation\u201d, \u201cSkills\u201d.",
      locked:false
    });
  } else {
    checks.push({ level:"pass", title:"Standard section headings present", desc:"Experience, Education and Skills are labelled the way parsers expect.", fix:"", locked:false });
  }

  var handBullets = body.filter(function(p){ return /^[\s]*[•·▪‣◦*\-]\s+/.test(p.text); }).length;
  var realLists   = body.filter(function(p){ return p.isList; }).length;
  if(handBullets > 3 && realLists === 0){
    checks.push({
      level:"warn",
      title: handBullets + " bullets typed as characters",
      desc: "Typing \u201c\u2022\u201d by hand works visually, but some parsers treat the whole block as one run-on line instead of separate achievements.",
      fix: "Use Word's bullet list button (Home > Bullets) instead of typing the character.",
      locked:false
    });
  }

  var small = body.filter(function(p){ return p.size !== null && p.size < 9 && p.text.trim().length > 30; }).length;
  if(small >= 1){
    checks.push({
      level:"warn",
      title: small + " paragraphs below 9pt",
      desc: "Very small text is usually a sign of cramming. It also survives OCR badly when a system re-scans a PDF made from this file.",
      fix: "Keep body text at 10–12pt and cut content instead of shrinking it.",
      locked:false
    });
  }

  if(words < 150){
    checks.push({
      level:"warn",
      title: "Only ~" + words + " words extracted",
      desc: "A thin resume gives a keyword matcher very little to work with. If your real resume is longer, content is probably trapped in a text box or header.",
      fix: "Check the text-box issue above first — it is the usual cause.",
      locked:false
    });
  }

  return checks;
}

/* ------------------------------------------------------------------ *
 * 3. Keyword extraction
 * ------------------------------------------------------------------ */

var STOP = ("a an the and or but if then than that this these those of in on at to for from by with without within across " +
  "as is are was were be been being am do does did doing have has had having will would shall should can could may might must " +
  "we you they he she it i our your their his her its us them me my mine ours yours theirs " +
  "about above after again all also any because before below between both during each few more most other some such " +
  "no nor not only own same so too very s t just don now up out off over under once here there when where why how what which who whom " +
  "into onto upon via per etc eg ie vs " +
  "job role position candidate applicant you'll we're we'll you're ideal successful qualified require required requirement requirements " +
  "responsibilities responsibility duties tasks work working works team teams company organization organisation our client clients " +
  "year years month months day days time times new good great strong excellent ability able skill skills experience experiences " +
  "plus bonus nice preferred preference including include includes " +
  "please apply application resume cv cover letter salary compensation benefits benefit opportunity opportunities " +
  "join help helps support supports develop developing build building create creating make making use using used " +
  "well like across various multiple several many much one two three first second next last least " +
  "looking look seeking seek find finding hire hiring employed employment full part remote hybrid office " +
  "senior junior mid level degree bachelors bachelor master masters phd equivalent field related relevant similar " +
  "knowledge familiarity familiar comfortable comfort proven track record understanding background exposure " +
  "deep solid advanced basic intermediate expertise expert proficiency proficient competency competent " +
  "modern current previous latest strong excellent outstanding exceptional " +
  "ensure ensuring deliver delivering drive driving own owning lead leading manage managing " +
  "both either neither whether while whilst upon among amongst " +
  "things thing stuff way ways quickly effectively efficiently closely alongside across " +
  "who's what's").split(/\s+/);

/* Verbs that open a bullet ("Write unit tests"). Stripped from the head of a
   phrase, because the noun that follows is the part a recruiter searches for.
   "design" is deliberately absent — it is a noun in "design systems". */
var VERBS = ("write writes writing wrote review reviews reviewing build builds building create creates creating " +
  "maintain maintains maintaining develop develops developing deliver delivers delivering ensure ensures ensuring " +
  "mentor mentors mentoring ship ships shipping implement implements implementing deploy deploys deploying " +
  "run runs running help helps helping support supports supporting drive drives driving own owns owning " +
  "lead leads leading work works working cut cuts cutting reduce reduces reducing increase increases increasing " +
  "improve improves improving handle handles handling perform performs performing").split(/\s+/);
var VERBSET = {}; VERBS.forEach(function(w){ VERBSET[w] = true; });

var STOPSET = {}; STOP.forEach(function(w){ STOPSET[w] = true; });

// Noise words that survive as the tail of a phrase but carry no meaning alone.
var TAILNOISE = ("pipelines pipeline workflows workflow processes process practices practice methodologies methodology " +
  "environment environments platforms platform tools tooling techniques technique frameworks apis api").split(/\s+/);
var TAILSET = {}; TAILNOISE.forEach(function(w){ TAILSET[w] = true; });

var TECH = ("react reactjs typescript javascript node nodejs python java golang rust ruby php swift kotlin scala " +
  "r sql mysql postgresql postgres mongodb redis elasticsearch dynamodb sqlite oracle " +
  "aws gcp azure docker kubernetes terraform ansible jenkins circleci github gitlab " +
  "graphql rest grpc websocket webpack vite babel eslint prettier jest mocha cypress playwright selenium " +
  "sass less tailwind bootstrap jquery angular vue svelte nuxt remix redux zustand mobx " +
  "figma sketch jira confluence notion linux unix bash powershell " +
  "pytorch tensorflow pandas numpy scikit-learn keras opencv " +
  "kafka rabbitmq nginx apache kafka serverless lambda microservices " +
  "wcag accessibility seo sem ga4 amplitude mixpanel " +
  "saas b2b b2c fintech healthtech edtech devops " +
  "nextjs next excel powerpoint photoshop illustrator autosql dbt airflow spark hadoop").split(/\s+/);
var TECHSET = {}; TECH.forEach(function(w){ TECHSET[w] = true; });

var SOFT = ("communication communicate communication collaboration collaborate leadership mentoring mentor coaching " +
  "stakeholder stakeholders problem-solving ownership proactive adaptability prioritization prioritize " +
  "cross-functional teamwork interpersonal initiative time-management analytical attention detail").split(/\s+/);

function escRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function tokenize(text){
  var cleaned = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  var raw = cleaned.match(/[A-Za-z][A-Za-z0-9+#.'/-]*/g) || [];
  return raw.map(function(t){ return t.replace(/^[./]+|[./]+$/g, ""); })
            .filter(function(t){ return t.length > 1; });
}

/*
  Split a job posting into "units". A unit is one line or one list item.
  n-grams never cross a unit boundary — that is what stops phrases like
  "load performance Write unit" from being manufactured out of two
  unrelated bullet points that happened to sit next to each other.
*/
function splitUnits(jd){
  return jd.split(/[\n\r\u2022;\u00b7]+/)
           .map(function(s){ return s.replace(/^\s*[-*]\s+/, "").trim(); })
           .filter(function(s){ return s.length > 1; });
}

/*
  Inside a unit, split enumeration: "React, TypeScript and modern CSS"
  becomes three separate candidate phrases.
*/
function splitEnum(unit){
  // brackets become commas so "(Redux or Zustand)" splits into Redux / Zustand
  // instead of gluing "Redux" onto the phrase before it.
  return unit.replace(/[()]/g, ",")
             .split(/\s*(?:,|\band\b|\bor\b|\/)\s*/i)
             .map(function(s){ return s.replace(/\s+/g, " ").trim(); })
             .filter(function(s){ return s.length > 1; });
}
// but keep slash-joined tech terms intact for the token check
function keepsSlash(unit){ return /[a-z]\/[a-z]/i.test(unit); }

function stem(w){
  w = w.toLowerCase();
  if(w.length > 5 && /ing$/.test(w)) return w.slice(0, -3);
  if(w.length > 4 && /(es|ed)$/.test(w)) return w.slice(0, -2);
  if(w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

var SYNONYMS = [
  ["javascript","js","ecmascript","es6"], ["react","react.js","reactjs"], ["node","node.js","nodejs"],
  ["typescript","ts"], ["kubernetes","k8s"], ["aws","amazon web services"],
  ["gcp","google cloud","google cloud platform"], ["azure","microsoft azure"],
  ["machine learning","ml"], ["artificial intelligence","ai"], ["natural language processing","nlp"],
  ["postgresql","postgres"], ["mongodb","mongo"],
  ["continuous integration","ci","ci/cd","cicd"], ["continuous delivery","cd"], ["quality assurance","qa"],
  ["user interface","ui"], ["user experience","ux"], ["project management","pm"],
  ["search engine optimization","seo"], ["software as a service","saas"],
  ["restful","rest","rest api","rest apis"],
  ["customer relationship management","crm"], ["enterprise resource planning","erp"],
  ["a/b testing","ab testing","split testing"],
  ["structured query language","sql"],
  ["stakeholder management","stakeholder"], ["cross-functional","cross functional"],
  ["bachelors","bachelor","bs"], ["masters","master","ms"],
  ["microsoft excel","excel"], ["microsoft office","ms office"],
  ["full stack","fullstack","full-stack"], ["front end","frontend","front-end"], ["back end","backend","back-end"],
  ["version control","git"], ["unit testing","unit tests"], ["test driven development","tdd"],
  ["core web vitals","web vitals"], ["accessibility","wcag","a11y"],
  ["ci/cd pipelines","ci/cd"], ["design systems","design system"]
];
var SYNMAP = {};
SYNONYMS.forEach(function(group){
  group.forEach(function(term){
    var k = term.toLowerCase();
    SYNMAP[k] = SYNMAP[k] || [];
    group.forEach(function(o){ if(o.toLowerCase() !== k) SYNMAP[k].push(o.toLowerCase()); });
  });
});

function isTechTerm(surface){
  var k = surface.toLowerCase();
  if(TECHSET[k]) return true;
  if(/[+#]/.test(surface)) return true;                 // c++, c#, f#
  if(/^[A-Za-z]+[.][A-Za-z]{1,4}$/.test(surface)) return true;  // node.js, next.js, react.js
  if(/^[A-Za-z]+\/[A-Za-z]+$/.test(surface)) return true;       // ci/cd, a/b
  if(/^[A-Z]{2,5}$/.test(surface)) return true;                 // AWS, SQL, GCP
  if(/^[a-z]+[A-Z][A-Za-z]*$/.test(surface)) return true;       // TypeScript, GraphQL, JavaScript
  return false;
}

// Requirements region of the posting, so we can weight what they actually ask for.
function requirementText(jd){
  var low = jd.toLowerCase();
  var heads = ["requirements","qualifications","what you'll need","what we're looking for","must have","you have","who you are","about you"];
  var start = -1;
  heads.forEach(function(h){ var i = low.indexOf(h); if(i > -1 && (start === -1 || i < start)) start = i; });
  if(start === -1) return jd;
  var ends = ["nice to have","nice-to-have","bonus","benefits","perks","what we offer","how to apply","equal opportunity","about us","compensation"];
  var end = jd.length;
  ends.forEach(function(h){ var i = low.indexOf(h, start + 10); if(i > -1 && i < end) end = i; });
  return jd.slice(start, end);
}

function extractKeywords(jd){
  var reqText = requirementText(jd);
  var grams = {};

  splitUnits(jd).forEach(function(unit){
    var pieces = keepsSlash(unit) ? [unit] : splitEnum(unit);
    pieces.forEach(function(piece){
      var toks = tokenize(piece);
      if(!toks.length) return;
      var lower = toks.map(function(t){ return t.toLowerCase(); });
      var n = lower.length;

      for(var size = 1; size <= 3; size++){
        for(var i = 0; i + size <= n; i++){
          var words = lower.slice(i, i + size);
          // a candidate phrase must contain no stopword at all
          var bad = false;
          for(var j = 0; j < words.length; j++){ if(STOPSET[words[j]]) { bad = true; break; } }
          if(bad) continue;

          var surface = toks.slice(i, i + size).join(" ");
          var tech = isTechTerm(surface);
          if(!tech && size === 1 && surface.length < 3) continue;

          var key = words.join(" ");
          if(!grams[key]) grams[key] = { term:surface, count:0, tech:tech, size:size };
          grams[key].count++;
        }
      }
    });
  });

  var list = Object.keys(grams).map(function(k){
    var g = grams[k];
    var score = g.count * (g.size === 3 ? 2.6 : g.size === 2 ? 1.9 : 1.0);
    if(g.tech) score *= 1.8;
    if(hasPhrase(reqText, k)) score *= 1.8;
    // a lone non-technical word ("management", "review", "testing") carries
    // little on its own — it matters as part of a phrase.
    if(g.size === 1 && !g.tech) score *= 0.45;
    return { term:g.term, key:k, count:g.count, tech:g.tech, size:g.size, score:score };
  });

  // "CI/CD pipelines" -> "CI/CD"  (drop a meaningless tail noun)
  list.forEach(function(c){
    var w = c.key.split(" ");
    if(w.length > 1 && TAILSET[w[w.length - 1]]){
      c.key  = w.slice(0, -1).join(" ");
      c.term = w.slice(0, -1).join(" ");
    }
  });

  // "Write unit tests" -> "unit tests"  (drop a leading bullet verb)
  list.forEach(function(c){
    var w = c.key.split(" ");
    if(w.length > 1 && VERBSET[w[0]]){
      c.key  = w.slice(1).join(" ");
      c.term = w.slice(1).join(" ");
    }
  });

  var merged = {};
  list.forEach(function(c){
    if(!merged[c.key] || c.score > merged[c.key].score){
      merged[c.key] = { term:c.term, key:c.key, count:(merged[c.key] ? merged[c.key].count : 0) + c.count,
                        tech:c.tech, size:c.key.split(" ").length, score:c.score };
    } else {
      merged[c.key].count += c.count;
    }
  });
  list = Object.keys(merged).map(function(k){ return merged[k]; });

  /*
    Containment pass, both directions. Whichever of two nested phrases scores
    higher wins, with one exception: a technical term is never dropped in
    favour of a longer phrase that merely happens to contain it, because
    "React" is worth listing even if "React component library" also appears.
  */
  list.sort(function(a,b){ return b.score - a.score; });
  var kept = [];
  list.forEach(function(cand){
    var drop = -1, skip = false;
    for(var i = 0; i < kept.length; i++){
      var k = kept[i];
      if(k.key === cand.key){ skip = true; break; }
      if(k.key.length > cand.key.length && k.key.indexOf(cand.key) > -1){
        if(!cand.tech && k.count >= cand.count * 0.5){ skip = true; break; }
      }
      if(cand.key.length > k.key.length && cand.key.indexOf(k.key) > -1){
        // keep the tech term; only replace when the longer one is at least as frequent
        if(!k.tech || cand.count >= k.count){ if(drop === -1) drop = i; }
      }
    }
    if(skip) return;
    if(drop > -1) kept.splice(drop, 1);
    kept.push(cand);
  });

  return kept.slice(0, 36);
}

/* ------------------------------------------------------------------ *
 * 4. Matching
 * ------------------------------------------------------------------ */

/*
  Word-boundary phrase test. Substring matching is the trap here:
  "ts" lives inside "tests", "ai" inside "maintain". Those false hits
  are worse than a miss, because they tell someone their resume is fine.
*/
function hasPhrase(hay, needle){
  if(!needle) return false;
  try{
    var body = escRe(needle).replace(/\s+/g, "[^a-z0-9]{0,3}");
    var re = new RegExp("(^|[^a-z0-9])" + body + "(?:e?s)?(?![a-z0-9])", "i");
    return re.test(hay);
  }catch(e){
    return hay.toLowerCase().indexOf(needle.toLowerCase()) > -1;
  }
}

function hasWord(hay, w){
  try{
    return new RegExp("(^|[^a-z0-9])" + escRe(w) + "s?(?![a-z0-9])", "i").test(hay);
  }catch(e){ return false; }
}

function matchState(resumeText, kw){
  if(hasPhrase(resumeText, kw.key)) return "ok";

  var syn = SYNMAP[kw.key] || [];
  for(var i = 0; i < syn.length; i++){
    if(hasPhrase(resumeText, syn[i])) return "mid";
  }

  var words = kw.key.split(" ");

  if(words.length === 1){
    // stem-level hit on a single word
    var toks = resumeText.toLowerCase().match(/[a-z0-9+#.'/-]+/g) || [];
    var target = stem(words[0]);
    for(var t = 0; t < toks.length; t++){ if(stem(toks[t]) === target) return "mid"; }
    return "bad";
  }

  // multi-word phrase. Two guards, both learned from false positives:
  //
  //   "state management" was being reported as a partial match because the
  //   resume said "State University". A phrase needs its HEAD NOUN to be
  //   present, not just any word in it.
  //
  //   "A/B testing" was being matched on "testing" alone. If the phrase
  //   contains a technical term, that term specifically has to be there.
  var content = words.filter(function(w){ return !STOPSET[w]; });
  if(content.length){
    var techWords = content.filter(function(w){ return isTechTerm(w) || TECHSET[w.toLowerCase()]; });
    if(techWords.length){
      var techHit = techWords.some(function(w){ return hasWord(resumeText, w); });
      if(!techHit) return "bad";
    }
    var head = content[content.length - 1];
    var headHit = hasWord(resumeText, head) || hasWord(resumeText, stem(head));
    if(!headHit) return "bad";

    var hits = 0;
    content.forEach(function(w){ if(hasWord(resumeText, w) || hasWord(resumeText, stem(w))) hits++; });
    if(hits >= Math.ceil(content.length / 2)) return "mid";
  }
  return "bad";
}

/* ------------------------------------------------------------------ *
 * 5. Rewrite guidance — the part paid scanners leave to you
 * ------------------------------------------------------------------ */

function isSoftSkill(term){
  var t = term.toLowerCase();
  return SOFT.some(function(s){ return t.indexOf(s) > -1 || s.indexOf(t) > -1; });
}
function isCert(term){
  return /^(pmp|cpa|cfa|cissp|csm|csa|itil|ceh|ccna|ccnp|six sigma)$/i.test(term.trim()) ||
         /\b(certified|certification|certificate)\b/i.test(term);
}

function rewriteFor(term){
  var t = term;
  if(isCert(t)){
    return { where:"Certifications",
      line:"Add a one-line Certifications entry under Education: \u201c" + t + " \u2014 <year>\u201d." };
  }
  if(isSoftSkill(t)){
    return { where:"Achievement bullet",
      line:"Do not list it as a trait — recruiters discount adjectives. Attach it to something you did: \u201c...by " +
           t.toLowerCase() + " across <N> teams, which cut <X> by <Y>.\u201d" };
  }
  if(isTechTerm(t) || TECHSET[t.toLowerCase()]){
    return { where:"Skills + one bullet",
      line:"1) Add \u201c" + t + "\u201d to the tools line of your Skills section. " +
           "2) Name it once in a bullet where you actually used it: \u201cBuilt <thing> using " + t +
           ", which <outcome with a number>.\u201d Use the posting's exact spelling — parsers compare strings, not meanings." };
  }
  return { where:"Summary or a bullet",
    line:"Work it in where it is true: \u201c<role> focused on " + t.toLowerCase() +
         ", delivering <result>.\u201d If you have not actually done it, leave it out — an inflated resume fails at the interview, not at the parser." };
}

/* ------------------------------------------------------------------ *
 * 6. Render
 * ------------------------------------------------------------------ */

function esc(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
  });
}

function analyze(){
  var jd = document.getElementById("jd").value.trim();
  var resumeText = state.resumeText || document.getElementById("resume").value.trim();
  if(jd.length < 120){ showError("The job description looks too short to extract keywords from. Paste the whole posting."); return; }
  if(resumeText.length < 80){ showError("Your resume text looks too short. Drop the .docx, or paste more of it."); return; }

  document.getElementById("error").hidden = true;

  var scored = extractKeywords(jd).map(function(k){ k.state = matchState(resumeText, k); return k; });
  scored.sort(function(a,b){
    var rank = { bad:0, mid:1, ok:2 };
    if(rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    return b.score - a.score;
  });

  var ok  = scored.filter(function(k){ return k.state === "ok";  });
  var mid = scored.filter(function(k){ return k.state === "mid"; });
  var bad = scored.filter(function(k){ return k.state === "bad"; });

  // weighted coverage: a keyword they repeated matters more than one they mentioned once
  var sumAll = 0, sumGot = 0;
  scored.forEach(function(k){ sumAll += k.score; sumGot += (k.state === "ok" ? k.score : k.state === "mid" ? k.score * 0.5 : 0); });
  var pct = sumAll ? Math.round(sumGot / sumAll * 100) : 0;

  state.result = { scored:scored, ok:ok, mid:mid, bad:bad, pct:pct, jd:jd, resumeText:resumeText };
  render();
}

function render(){
  var r = state.result;
  var un = state.unlocked;
  var pct = r.pct;

  document.getElementById("pct").textContent = pct;
  var C = 2 * Math.PI * 52;
  var arc = document.getElementById("arc");
  arc.style.strokeDasharray = C;
  arc.style.strokeDashoffset = C * (1 - pct / 100);
  arc.style.stroke = pct >= 70 ? "#047857" : pct >= 45 ? "#f59e0b" : "#b91c1c";

  document.getElementById("verdict").textContent =
    pct >= 70 ? "Good coverage. Do not keep stuffing past this point — a resume written for a parser starts reading badly to the human who eventually reads it."
    : pct >= 45 ? "You are in range. The gaps below are the difference between showing up in a recruiter's search and sitting at the bottom of it."
    : "Large gap. Either this posting is a stretch, or your resume describes the same work in different language — most often it is the second one.";

  var total = r.scored.length || 1;
  document.getElementById("nOk").textContent  = r.ok.length;
  document.getElementById("nMid").textContent = r.mid.length;
  document.getElementById("nBad").textContent = r.bad.length;
  document.getElementById("bOk").style.width  = (r.ok.length  / total * 100) + "%";
  document.getElementById("bMid").style.width = (r.mid.length / total * 100) + "%";
  document.getElementById("bBad").style.width = (r.bad.length / total * 100) + "%";

  var host = document.getElementById("kwList");
  host.innerHTML = "";
  r.scored.forEach(function(k){
    var d = document.createElement("div");
    d.className = "kw " + k.state;
    var pill = k.state === "ok" ? "matched" : k.state === "mid" ? "partial" : "missing";
    var note = "";

    if(k.state === "mid"){
      var syn = (SYNMAP[k.key] || []).filter(function(s){ return hasPhrase(r.resumeText, s); });
      var stemHit = "";
      if(!syn.length){
        var cw = k.key.split(" ").filter(function(w){ return !STOPSET[w] && hasWord(r.resumeText, w); });
        stemHit = cw.length ? cw[0] : "";
      }
      note = "You likely have this as \u201c" + (syn[0] || stemHit || "a different form") +
             "\u201d. Switch to the posting's wording — parsers compare strings, not meanings.";
    } else if(k.state === "bad" && un){
      var g = rewriteFor(k.term);
      note = "<b>Add to " + esc(g.where) + ":</b> " + esc(g.line);
    }

    var locked = (k.state !== "ok" && !un);
    d.innerHTML =
      '<div class="kwtop">' +
        '<span class="kwterm">' + esc(k.term) + '</span>' +
        '<span class="pill p-' + k.state + '">' + pill + '</span>' +
        '<span class="kwfreq">mentioned ' + k.count + "\u00d7" + (hasPhrase(requirementText(r.jd), k.key) ? " \u00b7 in the requirements" : "") + '</span>' +
      '</div>' +
      (note ? '<div class="kwnote">' + note + '</div>' : "") +
      (locked ? '<div class="kwlocked">The sentence to add is in the full report below.</div>' : "");
    host.appendChild(d);
  });

  var ch = document.getElementById("chkList");
  ch.innerHTML = "";
  if(state.fromDocx && state.resumeXml){
    parseChecks(state.resumeXml, paragraphs(state.resumeXml), state.hfXml || "").forEach(function(c){
      var d = document.createElement("div");
      d.className = "chk " + c.level;
      var mark = c.level === "err" ? "!" : c.level === "warn" ? "?" : "\u2713";
      d.innerHTML =
        '<div class="cic c-' + c.level + '">' + mark + '</div>' +
        '<div class="cbody"><div class="ctitle">' + esc(c.title) + '</div>' +
        '<div class="cdesc">' + esc(c.desc) + '</div>' +
        ((c.fix && (un || c.level !== "err")) ? '<div class="cfix"><b>Fix:</b> ' + esc(c.fix) + '</div>' : "") +
        ((c.fix && !un && c.level === "err") ? '<div class="kwlocked">Fix instructions are in the full report.</div>' : "") +
        '</div>';
      ch.appendChild(d);
    });
  } else {
    var src = state.source || "text";
    var title, desc;
    if(src === "pdf"){
      title = "Structural checks need the .docx version";
      desc  = "Keyword matching above is complete. The layout checks cannot read a PDF, because saving to PDF flattens away exactly the things that break parsing — the text boxes, columns and layout tables. Re-save from Word as .docx and drop it again to get them.";
    } else if(src === "text"){
      title = "Drop the .docx to run parsing checks";
      desc  = "Keyword matching works from pasted text. The structural checks need the actual file, because they read how the document is built — text boxes, columns and layout tables leave no trace in plain text.";
    } else {
      title = "No structural checks run yet";
      desc  = "Drop a .docx to have the document structure inspected.";
    }
    var d2 = document.createElement("div");
    d2.className = "chk";
    d2.innerHTML = '<div class="cic c-pass">i</div><div class="cbody">' +
      '<div class="ctitle">' + esc(title) + '</div>' +
      '<div class="cdesc">' + esc(desc) + '</div></div>';
    ch.appendChild(d2);
  }

  var gaps = r.bad.length + r.mid.length;
  document.getElementById("ctaTitle").textContent = gaps + " gap" + (gaps === 1 ? "" : "s") + " between your resume and this posting";
  document.getElementById("ctaBody").textContent =
    "You already have the list. The report turns each one into a sentence you can paste — and flags the three requirements this posting repeats most, which is what your cover letter should lead with.";

  syncUnlockedUI();

  document.getElementById("results").hidden = false;
  document.getElementById("results").scrollIntoView({ behavior:"smooth", block:"start" });
}

function showError(msg){
  var e = document.getElementById("error");
  e.textContent = msg;
  e.hidden = false;
}

/* ------------------------------------------------------------------ *
 * 7. Wiring
 * ------------------------------------------------------------------ */

/* SAMPLE_JD, SAMPLE_RESUME and DEMO_DOCX_B64 live in samples.js, which loads
   before this file. */

function el(id){ return document.getElementById(id); }

var MAX_BYTES = 20 * 1024 * 1024;

function setReading(on, msg){
  el("reading").hidden = !on;
  if(msg) el("readingText").textContent = msg;
}

function showWarn(msg){
  var w = el("warnbox");
  w.textContent = msg;
  w.hidden = false;
}
function clearMsg(){
  el("error").hidden = true;
  el("warnbox").hidden = true;
}

/* ------------------------------------------------------------------ *
 * File triage. Anything that is not usable gets a message saying what
 * it actually is and the shortest route to something that works.
 * ------------------------------------------------------------------ */

var GROUPED = [
  { exts:["doc"],
    title:"This is the old Word format (.doc), from the 1990s",
    body:"Browsers cannot read it — .doc is a binary blob, not the zip container that .docx uses. Open it in Word and choose File \u2192 Save As \u2192 Word Document (.docx). About ten seconds, and it also unlocks the structural checks below." },
  { exts:["rtf","odt","pages","wps","sxw","abw","docm","dot","dotx","ppt","pptx"],
    title:"Convert it to .docx first",
    body:"Open the file in Word, Pages or LibreOffice and choose File \u2192 Save As \u2192 .docx, then drop it here. If that is a hassle, just open it, select everything, and paste the text into the box below — keyword matching works the same, you only lose the layout checks." },
  { exts:["xlsx","csv","numbers","xls","ods","tsv"],
    title:"That is a spreadsheet, not a resume document",
    body:"If your resume genuinely lives inside it, open it, select the cells, and paste into the box below. Otherwise export it as .docx or .pdf from Word." },
  { exts:["png","jpg","jpeg","gif","webp","heic","bmp","tif","tiff","svg"],
    title:"That is an image, and nothing can read text out of it here",
    body:"A photo or screenshot of a resume has no text layer — no parser anywhere can recover it reliably. Open the original document instead. If you only have the image, retype the text into the box below, or run it through free OCR first." },
  { exts:["zip","rar","7z","gz","tar"],
    title:"That is an archive",
    body:"Unzip it first. If a .docx comes out, drop that one here." },
  { exts:["html","htm","xml","json","css","js","md","log","eml","msg"],
    title:"That is a web page or data file, not a resume",
    body:"Export or print it to PDF from your browser (Ctrl+P \u2192 Save as PDF), or save it as .docx, then drop it here." }
];

function extOf(name){
  var m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function rejectFor(name){
  var ext = extOf(name);
  for(var i = 0; i < GROUPED.length; i++){
    if(GROUPED[i].exts.indexOf(ext) > -1) return GROUPED[i];
  }
  return null;
}

/*
  Read the first bytes rather than trusting the file name. People rename files,
  and Word itself happily lets you save an old .doc as .docx — the contents stay
  a decade out of date either way.
*/
function sniff(file){
  return file.slice(0, 8).arrayBuffer().then(function(b){
    var u = new Uint8Array(b);
    if(u[0] === 0x50 && u[1] === 0x4B) return "zip";          // PK
    if(u[0] === 0x25 && u[1] === 0x50 && u[2] === 0x44 && u[3] === 0x46) return "pdf";  // %PDF
    if(u[0] === 0xD0 && u[1] === 0xCF) return "ole";          // old office / encrypted
    if(u[0] === 0xEF && u[1] === 0xBB) return "text";        // UTF-8 BOM
    return "text";
  }, function(){ return "text"; });
}

function rejectFile(title, body){
  clearMsg();
  var e = el("error");
  e.innerHTML = "<b>" + esc(title) + "</b><br>" + esc(body);
  e.hidden = false;
  return false;
}

/* Returns a promise resolving to true if something usable was loaded. */
function handleFile(f){
  clearMsg();

  if(!f) return Promise.resolve(false);

  if(/^~\$/.test(f.name))
    return Promise.resolve(rejectFile("That is a Word lock file",
      "Files starting with \u201c~$\u201d are temporary markers Word creates while a document is open. Close Word and pick the real file — same name without the \u201c~$\u201d prefix."));

  if(f.size === 0)
    return Promise.resolve(rejectFile("That file is empty",
      "Zero bytes. If it came out of a cloud sync, it may not have finished downloading — check that the copy on your desktop has a real size."));

  if(f.size > MAX_BYTES)
    return Promise.resolve(rejectFile("That file is unusually large (" + Math.round(f.size / 1048576) + " MB)",
      "A resume should be well under 1 MB, so this probably contains embedded images or fonts. Save a plain copy, or just paste the text into the box below."));

  return sniff(f).then(function(kind){
    if(kind === "ole")
      return rejectFile("This is the old binary Office format, whatever its file ending says",
        "Browsers cannot read it. Open it in Word and choose File \u2192 Save As \u2192 Word Document (.docx), then drop the new copy here.");

    if(kind === "pdf"){
      setReading(true, "Reading PDF\u2026");
      return readPdf(f).then(function(res){
        setReading(false);
        if(!res.text || res.text.replace(/\s/g, "").length < 40)
          return rejectFile("This PDF has no text layer — it is a scan or an image",
            "Every page of this file is a picture, so there are no words to read. This is the single most common reason a resume gets rejected: the ATS sees the same nothing I do. Re-export from the original Word file (Save As \u2192 PDF), never from a screenshot or a photo.");
        setLoaded(res.text, "pdf", f.name + "  \u00b7  " + res.pages + " page" + (res.pages > 1 ? "s" : "") + ", " + res.text.length + " characters read");
        return true;
      }, function(err){
        setReading(false);
        var m = String(err && err.message || err);
        if(/password|encrypt/i.test(m))
          return rejectFile("This PDF is password-protected",
            "Open it and re-save without a password, or unlock it and paste the text into the box below.");
        if(/worker|importScripts|script/i.test(m))
          return rejectFile("PDF reading is blocked when this page is opened straight from disk",
            "Browsers refuse to start the background helper pdf.js needs over file://. Either serve the folder (there is a start.bat in this folder) or paste your resume text into the box below — keyword matching is identical, you only lose nothing else.");
        return rejectFile("Could not read that PDF",
          "Something in the file tripped the reader: " + m + ". As a fallback, open it, select all, and paste the text into the box below — keyword matching does not need the layout.");
      });
    }

    if(kind === "zip"){
      // .docx, .xlsx and .pptx are all zip containers, so the bytes alone cannot
      // tell them apart. Consult the name before handing anything to the Word
      // reader — otherwise a spreadsheet surfaces as "corrupt zip", which tells
      // the person nothing useful.
      var ext = extOf(f.name);
      if(ext !== "docx"){
        var zg = rejectFor(f.name);
        if(zg) return rejectFile(zg.title, zg.body);
      }
      setReading(true, "Reading .docx\u2026");
      return readDocx(f).then(function(res){
        setReading(false);
        var txt = visibleText(paragraphs(res.xml));
        if(!txt || txt.replace(/\s/g, "").length < 40)
          return rejectFile("Nothing readable came out of that .docx",
            "The file opened, but almost no text was inside it. This is usually a resume built entirely out of text boxes and floating shapes — which is also exactly why parsers return it as blank.");
        setLoadedDocx(res.xml, res.headerFooter, f.name, txt);
        return true;
      }, function(err){
        setReading(false);
        return rejectFile("Could not read that Word file", esc ? String(err && err.message || err) : "");
      });
    }

    // plain text by elimination
    var g = rejectFor(f.name);
    if(g && !/\.(txt|text|md)$/i.test(f.name)) return rejectFile(g.title, g.body);

    return new Promise(function(resolve){
      var fr = new FileReader();
      fr.onload = function(){
        setReading(false);
        var t = String(fr.result || "");
        if(!t.trim()){ rejectFile("That file has no text in it", "It opened, but there was nothing to read."); return resolve(false); }
        setLoaded(t, "text", f.name + "  \u00b7  text file");
        resolve(true);
      };
      fr.onerror = function(){ rejectFile("Could not read that file", "Your browser would not allow it."); resolve(false); };
      setReading(true, "Reading file\u2026");
      fr.readAsText(f);
    });
  });
}

function setLoaded(text, source, label){
  state.resumeXml  = null;
  state.hfXml      = "";
  state.resumeText = text;
  state.source     = source;
  state.fromDocx   = false;
  el("resume").value = text.slice(0, 6000);
  el("resCount").textContent = text.length;
  el("fileName").textContent = label;
  el("fileOk").hidden = false;
  el("drop").hidden = true;
  showNote(source);
  refreshRun();
}

function setLoadedDocx(xml, hf, name, text){
  state.resumeXml  = xml;
  state.hfXml      = hf;
  state.resumeText = text;
  state.source     = "docx";
  state.fromDocx   = true;
  el("resume").value = text.slice(0, 6000);
  el("resCount").textContent = text.length;
  el("fileName").textContent = name + "  \u00b7  " + text.length + " characters read locally";
  el("fileOk").hidden = false;
  el("drop").hidden = true;
  showNote("docx");
  refreshRun();
}

function showNote(source){
  var n = el("fileNote");
  n.hidden = false;
  if(source === "docx"){
    n.className = "filenote fn-ok";
    n.innerHTML = "Read locally. <b>Structural checks are available</b> because this is a real Word file — that is the only way to see text boxes, columns and layout tables.";
  } else if(source === "pdf"){
    n.className = "filenote";
    n.innerHTML = "Read locally. Keyword matching is complete; structural checks need the <b>.docx</b>, because a PDF flattens away the text boxes and layout that break parsing. Re-save from Word as .docx to see them.";
  } else {
    n.className = "filenote";
    n.innerHTML = "Read locally. Structural checks need the original <b>.docx</b> — pasted text has no layout left to inspect.";
  }
}

function clearFileState(){
  state.resumeXml = null; state.hfXml = ""; state.resumeText = "";
  state.source = "text"; state.fromDocx = false;
  el("fileOk").hidden = true;
  el("fileNote").hidden = true;
  el("warnbox").hidden = true;
  el("drop").hidden = false;
  el("resume").value = "";
  el("resCount").textContent = "0";
  refreshRun();
}

function b64ToFile(b64, name){
  var bin = atob(b64);
  var arr = new Uint8Array(bin.length);
  for(var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function refreshRun(){
  var jdRaw = el("jd").value.trim();
  var jdOk  = jdRaw.length > 40;
  var resOk = (state.resumeText || el("resume").value.trim()).length > 40;
  el("run").disabled = !(jdOk && resOk);

  var hint = el("runHint");
  if(jdOk && resOk)          hint.textContent = "Ready \u2014 this runs on your machine, nothing is uploaded.";
  else if(!jdOk)             hint.textContent = "Paste the job description first (step 1).";
  else                       hint.textContent = "Add your resume \u2014 drop a file or paste the text (step 2).";

  el("jdHint").hidden = !(jdOk && jdRaw.length >= 400);
}

el("jd").addEventListener("input", function(){
  el("jdCount").textContent = this.value.length;
  refreshRun();
});
el("resume").addEventListener("input", function(){
  el("resCount").textContent = this.value.length;
  if(this.value.trim()){ state.resumeText = this.value; state.source = "text"; state.fromDocx = false; }
  refreshRun();
});

el("sampleJd").addEventListener("click", function(){
  el("jd").value = SAMPLE_JD;
  el("jdCount").textContent = SAMPLE_JD.length;
  clearMsg();
  refreshRun();
});
el("sampleResume").addEventListener("click", function(){
  state.resumeXml = null; state.hfXml = "";
  state.resumeText = SAMPLE_RESUME;
  state.source = "text"; state.fromDocx = false;
  el("resume").value = SAMPLE_RESUME;
  el("resCount").textContent = SAMPLE_RESUME.length;
  el("fileOk").hidden = true;
  el("fileNote").hidden = true;
  el("drop").hidden = false;
  clearMsg();
  refreshRun();
});
el("sampleDocx").addEventListener("click", function(){
  handleFile(b64ToFile(DEMO_DOCX_B64, DEMO_DOCX_NAME)).then(function(ok){
    if(ok) showWarn("This is the deliberately mangled sample resume — contact details sit in a text box, there is a two-column section, and the bullets are typed by hand. It is here so you can see what the structural checks catch before you hand over your own file.");
  });
});

el("fullDemo").addEventListener("click", function(){
  el("jd").value = SAMPLE_JD;
  el("jdCount").textContent = SAMPLE_JD.length;
  clearMsg();
  setReading(true, "Loading the sample\u2026");
  handleFile(b64ToFile(DEMO_DOCX_B64, DEMO_DOCX_NAME)).then(function(ok){
    setReading(false);
    if(!ok) return;
    analyze();
    showWarn("This is the deliberately mangled sample resume — contact details sit in a text box, there is a two-column section, and the bullets are typed by hand. It is here so you can see what the structural checks catch before you hand over your own file.");
  });
});

var drop = el("drop");
["dragenter","dragover"].forEach(function(ev){
  drop.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); drop.classList.add("over"); });
});
["dragleave","drop"].forEach(function(ev){
  drop.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); drop.classList.remove("over"); });
});
// Without this, dropping slightly outside the box makes the browser navigate
// away from the page and take everything typed in it with you.
["dragover","drop"].forEach(function(ev){
  window.addEventListener(ev, function(e){ e.preventDefault(); });
});
drop.addEventListener("drop", function(e){
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if(f) handleFile(f);
});
drop.addEventListener("click", function(){ el("file").click(); });
el("file").addEventListener("change", function(){
  if(this.files[0]) handleFile(this.files[0]);
  this.value = "";
});
el("clearFile").addEventListener("click", clearFileState);

el("run").addEventListener("click", analyze);

el("payBtn").addEventListener("click", function(){
  if(state.unlocked){
    openModal(
      "<h3>This browser is already unlocked</h3>" +
      "<p>It is stored locally, so it survives a refresh and a restart. It is not an account — nothing identifies you, and there is no way for me to reach you.</p>" +
      "<p style='margin-top:12px'>Clearing this browser's site data removes it. Paste your code again to restore.</p>"
    );
    return;
  }

  var pay;
  if(CHECKOUT_URL){
    pay = "<a class='paybtn' href='" + CHECKOUT_URL + "' target='_blank' rel='noopener'>Pay once &mdash; $7</a>" +
      "<p class='paynote'>Opens the payment page in a new tab. When it finishes, it brings you back here; " +
      "if nothing happens, paste the code from your receipt email below.</p>";
  } else if(NOTIFY_EMAIL){
    // No checkout yet: the report stays free and the button becomes a mailbox.
    // Saying so plainly costs nothing and is the only honest version of this.
    pay = "<a class='paybtn' href='mailto:" + NOTIFY_EMAIL +
      "?subject=" + encodeURIComponent("Notify me when the full report opens") +
      "&body=" + encodeURIComponent("I used the resume/JD matcher and want the launch price.") +
      "'>Email me when payment opens</a>" +
      "<p class='paynote'>Payment is not switched on yet, so everything here is free right now. " +
      "Leave your email and you get the launch price before it goes up.</p>";
  } else {
    pay = "<div class='unconfigured'>Payment is not configured on this copy yet.</div>";
  }

  openModal(
    "<h3>Unlock the full report</h3>" +
    "<p>One payment, no account, no subscription — which is also why nothing here can be tied back to you.</p>" +
    "<ul><li>A ready-to-paste sentence for every gap</li>" +
    "<li>Fix steps for each parsing issue</li>" +
    "<li>The requirements this posting repeats most, for your cover letter</li></ul>" +
    pay +
    "<div class='unlocksplit'><span>Already paid? Paste your code</span></div>" +
    "<div class='unlock'><input id='code' placeholder='" + (DEMO_CODE || "XXXX-XXXX-XXXX") +
      "' autocomplete='off' spellcheck='false'><button id='doUnlock'>Unlock</button></div>" +
    "<div class='unlockmsg' id='umsg'></div>"
  );

  el("doUnlock").addEventListener("click", tryUnlock);
  el("code").addEventListener("keydown", function(e){ if(e.key === "Enter") tryUnlock(); });
});

function tryUnlock(){
  var raw = el("code").value.trim();
  var m   = el("umsg");
  if(!raw){
    m.className = "unlockmsg u-bad"; m.textContent = "Paste the code from your receipt.";
    return;
  }
  if(applyUnlock(raw) || (DEMO_CODE && raw.toUpperCase() === DEMO_CODE)){
    state.unlocked = true;
    storeUnlock(isValidCode(raw) ? raw : DEMO_CODE);
    // Must not wait for render(): the results panel may be empty, and a paid
    // person staring at a button that still says "$7" is the whole problem.
    syncUnlockedUI();
    m.className = "unlockmsg u-ok"; m.textContent = "Unlocked — this browser will remember it.";
    setTimeout(function(){ closeModal(); render(); }, 500);
  } else {
    m.className = "unlockmsg u-bad";
    m.textContent = "That code is not valid. Check for missing characters — codes are 12 characters.";
  }
}

function openModal(html){
  el("modalBody").innerHTML = html;
  el("modal").hidden = false;
}
function closeModal(){ el("modal").hidden = true; }
/* Keeps the paywall button honest. Called on every render, and once at load —
   otherwise someone who already paid reloads the page and sees "Unlock for $7"
   again, which reads exactly like being charged twice. */
function syncUnlockedUI(){
  var cta = document.getElementById("cta");
  var payBtn = document.getElementById("payBtn");
  if(!cta || !payBtn) return;
  if(state.unlocked){
    cta.style.background = "linear-gradient(135deg,#065f46,#047857)";
    payBtn.textContent = "Full report unlocked";
    payBtn.disabled = true;
    payBtn.style.opacity = ".85";
    payBtn.style.cursor = "default";
  } else {
    cta.style.background = "linear-gradient(135deg,#312e81,#4338ca)";
    payBtn.textContent = "Unlock full report — $7";
    payBtn.disabled = false;
    payBtn.style.opacity = "1";
    payBtn.style.cursor = "pointer";
  }
}

el("closeModal").addEventListener("click", closeModal);
el("modal").addEventListener("click", function(e){ if(e.target === this) closeModal(); });

el("howLink").addEventListener("click", function(e){
  e.preventDefault();
  openModal(
    "<h3>How you can verify nothing is uploaded</h3>" +
    "<p>You do not have to take this on trust. Two checks, about thirty seconds:</p>" +
    "<ul><li>Open DevTools (F12) → Network tab → run a scan. The request list stays empty. There is no call to a server, because there is no server.</li>" +
    "<li>Turn off your wifi and reload this page. It still works — the whole tool is in the files you already loaded.</li></ul>" +
    "<p>The only files loaded are <code>jszip.min.js</code> (unzips your .docx), <code>pdf.min.js</code> + <code>pdf.worker.min.js</code> (reads your .pdf), and <code>app.js</code>, all from the folder this page came from.</p>" +
    "<p>That is also why scans are unlimited: a scan costs nothing on my side, so there is no reason to cap it at five a month.</p>"
  );
});

refreshRun();
syncUnlockedUI();
