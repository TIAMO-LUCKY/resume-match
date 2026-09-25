# -*- coding: utf-8 -*-
"""Pre-flight check before you push resume-match live.

Deployment fails in boring, predictable ways: a placeholder URL nobody
replaced, a $0 checkout link, a demo code shipped to production. Each one
costs a real visitor. So they get checked mechanically instead of remembered.

Usage:
    python preflight.py
    python preflight.py --strict     # treat warnings as failures

Exit code is 0 only when nothing blocks the launch.
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OK, WARN, FAIL = "PASS", "WARN", "FAIL"

results = []


def check(level, name, detail, howto=""):
    results.append((level, name, detail, howto))


PLACEHOLDERS = ("YOUR-USERNAME", "YOUR-STORE", "example.github.io", "XXXXX",
                "https://YOUR", "changeme", "TODO")


def looks_placeholder(v):
    if not v:
        return True
    return any(p.lower() in v.lower() for p in PLACEHOLDERS)


def read(path):
    p = os.path.join(ROOT, path)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return f.read()


# ------------------------------------------------------------------ payments
app = read("app.js") or ""

m = re.search(r'var\s+CHECKOUT_URL\s*=\s*"([^"]*)"', app)
checkout = m.group(1) if m else None
m = re.search(r'var\s+NOTIFY_EMAIL\s*=\s*"([^"]*)"', app)
notify = m.group(1) if m else None

# Selling and waiting are both valid states. Being stuck between them is not:
# a checkout link that still says YOUR-STORE ships a dead button, and an empty
# checkout with no fallback ships a page that apologises to visitors.
if not looks_placeholder(checkout):
    check(OK, "Checkout URL", checkout)
elif notify and "@" in notify and not looks_placeholder(notify):
    check(OK, "Checkout URL", "not set -- notify mode, button emails %s" % notify,
          "ship now, but swap in CHECKOUT_URL the moment Lemon Squeezy approves")
else:
    check(FAIL, "Checkout URL",
          "no CHECKOUT_URL and no NOTIFY_EMAIL fallback",
          "run: python setup.py --user <gh-name> --checkout <url>  (or --notify you@mail.com)")

m = re.search(r'var\s+DEMO_CODE\s*=\s*"([^"]*)"', app)
demo = m.group(1) if m else ""
if demo:
    check(WARN, "Demo code still shipped",
          "DEMO_CODE = %r is still in the file" % demo,
          "Set it to \"\" before going live, or anyone can unlock by typing it")
else:
    check(OK, "Demo code removed", "no demo code present")

# A real unlock code reaching the site is worse than a demo code does. The demo
# code is worthless; these are the ones people pay for. One of them lives
# outside codes/ on purpose -- the file Gumroad delivers to buyers -- which is
# exactly why this cannot be left to memory.
CODES_DIR = os.path.join(ROOT, "codes")
SKIP_DIRS = {".git", "__pycache__", "codes"}
SKIP_FILES = {"deploy.json", ".gitignore"}
SCAN_EXT = (".html", ".js", ".css", ".json", ".xml", ".txt", ".bat", ".md")

paid_codes = set()
if os.path.isdir(CODES_DIR):
    for name in sorted(os.listdir(CODES_DIR)):
        if not name.lower().endswith((".txt", ".csv")):
            continue
        with open(os.path.join(CODES_DIR, name), encoding="utf-8", errors="ignore") as f:
            for line in f:
                c = line.strip().upper()
                if re.fullmatch(r"[0-9A-Z]{12}", c):
                    paid_codes.add(c)

leaked = set()
for dirpath, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for fn in files:
        if fn in SKIP_FILES or fn.startswith("_") or fn.endswith((".py", ".pyc")):
            continue
        if not fn.lower().endswith(SCAN_EXT):
            continue
        full = os.path.join(dirpath, fn)
        try:
            with open(full, encoding="utf-8", errors="ignore") as f:
                body = f.read().upper()
        except OSError:
            continue
        for c in paid_codes:
            if c in body:
                leaked.add("%s holds %s" % (os.path.relpath(full, ROOT).replace("\\", "/"), c))

if not paid_codes:
    check(WARN, "Unlock code leak", "no codes/*.txt to compare against",
          "Generate codes first, otherwise this guard checks nothing")
elif leaked:
    check(FAIL, "Unlock code leak",
          "a PAID code is inside a file that gets uploaded -- " + "; ".join(sorted(leaked)),
          "Move that file into codes/ (excluded from the upload package), then rebuild with deploy.py --drop")
else:
    check(OK, "Unlock code leak",
          "%d paid codes checked against every file that ships" % len(paid_codes))

m = re.search(r'var\s+FREE_MISSING\s*=\s*(\d+)', app)
if m:
    n = int(m.group(1))
    if n == 0:
        check(WARN, "Free tier offline",
              "FREE_MISSING=0 means there is nothing to see before paying",
              "Give away 3-6 keywords so there is something to believe in")
    elif n > 12:
        check(WARN, "Free tier too generous",
              "FREE_MISSING=%d gives away most of the value" % n,
              "5-8 is usually the sweet spot")
    else:
        check(OK, "Free tier", "first %d missing keywords are free" % n)


# ------------------------------------------------------------------ seo links
jobs = None
p = os.path.join(ROOT, "seo", "jobs.json")
if os.path.exists(p):
    with open(p, encoding="utf-8") as f:
        jobs = json.load(f)

if jobs is None:
    check(WARN, "SEO job data", "seo/jobs.json not found", "seo pages cannot be built")
else:
    for key in ("_home_url", "_tool_url"):
        v = jobs.get(key, "")
        if looks_placeholder(v):
            check(FAIL, "SEO %s" % key,
                  "still points at %r" % v,
                  "set it in seo/jobs.json, then rerun gen.py")
        else:
            check(OK, "SEO %s" % key, v)

    # jobs live under the "_jobs" key alongside the settings, so counting
    # "keys not starting with _" yields zero and hides the whole library.
    box = jobs.get("_jobs")
    njobs = len(box) if isinstance(box, (dict, list)) else 0
    if njobs == 0:
        check(FAIL, "SEO job count", "no jobs defined under _jobs", "add at least 5 jobs")
    else:
        check(OK, "SEO job count", "%d job templates" % njobs)

    out_dir = os.path.join(ROOT, "seo", "out")
    built = len([f for f in os.listdir(out_dir) if f.endswith(".html")]) if os.path.isdir(out_dir) else 0
    if built == 0:
        check(FAIL, "SEO pages built", "no html in seo/out", "run: python seo/gen.py")
    elif built < njobs + 1:
        check(WARN, "SEO pages stale",
              "%d pages for %d jobs" % (built, njobs),
              "you changed jobs.json -- rerun: python seo/gen.py")
    else:
        check(OK, "SEO pages built", "%d pages" % built)

    # Every generated page must carry its own canonical, description and
    # viewport. The hub page is built by a different template than the role
    # pages, which is exactly how it ended up shipping without any of them --
    # and a page with no viewport is judged by Google on mobile first.
    thin = []
    if os.path.isdir(out_dir):
        for f in sorted(os.listdir(out_dir)):
            if not f.endswith(".html"):
                continue
            body = ""
            try:
                body = open(os.path.join(out_dir, f), encoding="utf-8").read()
            except Exception:
                pass
            miss = [tag for tag in ("rel=\"canonical\"", "name=\"viewport\"",
                                    "name=\"description\"") if tag not in body]
            if miss:
                thin.append("%s (%s)" % (f, ", ".join(miss)))
    if thin:
        check(FAIL, "Role page meta tags", "%d page(s) missing tags" % len(thin),
              "; ".join(thin) + " -- fix seo/gen.py and rerun: python seo/gen.py")
    else:
        check(OK, "Role page meta tags", "canonical + viewport + description on all")

    # -------------------------------------------------------- discoverability
    # Two ways a finished page still stays invisible: nothing links to it, and
    # no sitemap lists it. Both get checked, and the sitemap URLs are resolved
    # against the disk -- a canonical one folder off from where the file lives
    # is invisible locally and ships a 404 into Google.
    base = jobs.get("_tool_url", "") or ""
    idx = read("index.html") or ""

    seo_links = len(re.findall(r'href="seo/', idx))
    if seo_links == 0:
        check(FAIL, "SEO pages reachable",
              "index.html links to none of the %d role pages" % njobs,
              "orphan pages get crawled late or never -- link them from the home page")
    elif seo_links < njobs:
        check(WARN, "SEO pages reachable",
              "%d links for %d role pages" % (seo_links, njobs),
              "add the missing ones")
    else:
        check(OK, "SEO pages reachable", "%d links from index.html" % seo_links)

    sm = read("sitemap.xml")
    if not sm:
        check(FAIL, "sitemap.xml", "missing at site root",
              "run: python seo/gen.py -- it now writes sitemap.xml next to index.html")
    else:
        locs = re.findall(r"<loc>([^<]+)</loc>", sm)
        bad_sm = [u for u in locs if looks_placeholder(u)]
        if not locs:
            check(FAIL, "sitemap.xml", "contains no <loc> entries", "rerun seo/gen.py")
        elif bad_sm:
            check(FAIL, "sitemap.xml",
                  "%d placeholder URL(s), e.g. %s" % (len(bad_sm), bad_sm[0]),
                  "addresses were never substituted -- rerun setup.py")
        elif not base.startswith("http"):
            check(WARN, "sitemap.xml", "%d urls, but _tool_url is not absolute" % len(locs),
                  "set _tool_url in seo/jobs.json so urls can be verified")
        else:
            ghosts = [u for u in locs
                      if not (u.startswith(base)
                              and os.path.exists(os.path.join(ROOT, u[len(base):])))]
            if ghosts:
                check(FAIL, "sitemap.xml",
                      "%d url(s) point at files that do not exist, e.g. %s" % (len(ghosts), ghosts[0]),
                      "_home_url disagrees with the folder the pages are written to")
            elif len(locs) < njobs + 2:
                check(WARN, "sitemap.xml", "%d urls for %d role pages" % (len(locs), njobs),
                      "include the tool page and the role hub too")
            else:
                check(OK, "sitemap.xml", "%d urls, every one resolves to a real file" % len(locs))

    rb = read("robots.txt")
    if not rb:
        check(FAIL, "robots.txt", "missing at site root",
              "run seo/gen.py -- it writes robots.txt with the Sitemap: line")
    elif "Sitemap:" not in rb:
        check(WARN, "robots.txt", "present but has no Sitemap: line",
              "add: Sitemap: <your base url>sitemap.xml")
    elif looks_placeholder(rb.split("Sitemap:", 1)[1].strip()):
        check(FAIL, "robots.txt", "Sitemap: line still a placeholder", "rerun setup.py")
    else:
        check(OK, "robots.txt", rb.split("Sitemap:", 1)[1].strip())


# ------------------------------------------------------------------ share meta
# A missing og:image does not break the tool, it breaks the link preview —
# which is the entire first impression on Reddit and X. Silent, so it is checked.
html = read("index.html") or ""
og_urls = re.findall(r'<meta\s+property="og:(?:url|image)"\s+content="([^"]*)"', html)
canon = re.findall(r'<link\s+rel="canonical"\s+href="([^"]*)"', html)
desc = re.findall(r'<meta\s+name="description"\s+content="([^"]*)"', html)

bad_meta = [u for u in (og_urls + canon) if looks_placeholder(u)]
if not og_urls or not canon:
    check(FAIL, "Share metadata", "og:url / og:image / canonical missing from index.html",
          "without them Reddit and X render a bare link with no card")
elif bad_meta:
    check(FAIL, "Share metadata",
          "%d URL(s) still placeholders, e.g. %s" % (len(bad_meta), bad_meta[0]),
          "replace YOUR-USERNAME in index.html <head>")
else:
    check(OK, "Share metadata", "canonical + %d og tags" % len(og_urls))

if desc and len(desc[0]) > 60:
    check(OK, "Meta description", "%d chars" % len(desc[0]))
else:
    check(WARN, "Meta description", "missing or too short",
          "search results will show scraped body text instead")

og_img = os.path.join(ROOT, "og-image.png")
if os.path.exists(og_img):
    with open(og_img, "rb") as f:
        head = f.read(26)
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        w = int.from_bytes(head[16:20], "big")
        h = int.from_bytes(head[20:24], "big")
        if (w, h) == (1200, 630):
            check(OK, "og-image.png", "%dx%d, %.0f KB" % (w, h, os.path.getsize(og_img) / 1024))
        else:
            check(WARN, "og-image.png", "is %dx%d, not 1200x630" % (w, h),
                  "most platforms crop a non-1.91:1 image")
    else:
        check(FAIL, "og-image.png", "not actually a PNG despite the extension", "re-export it")
else:
    check(FAIL, "og-image.png", "missing",
          "the og:image tag points at a file that is not there")


# ------------------------------------------------------------------ html refs
html = read("index.html") or ""
# Skip data: URIs — an inline favicon is not a missing file, it is a file that
# was never going to exist on disk.
refs = [r for r in re.findall(r'(?:src|href)="(?!http|#|mailto|data:)([^"]+)"', html)
        if r and not r.startswith("data:")]
missing = [r for r in refs if not os.path.exists(os.path.join(ROOT, r))]
if missing:
    check(FAIL, "Local file references",
          "index.html points at %d missing file(s): %s" % (len(missing), ", ".join(missing[:5])),
          "put the files back, or fix the path")
else:
    check(OK, "Local file references", "%d all present" % len(refs))

# An element can be hidden with the HTML hidden attribute and still show up:
# author CSS that sets display on the element's class wins over the browser's
# default [hidden] rule. That is exactly how the modal overlay ended up
# covering every click on the live site -- the page looked broken and the
# buttons could not be pressed. Cheap to check, expensive to miss.
_style = read("style.css") or ""
hidden_classes = set()
for _tag in re.finditer(r"<[a-zA-Z][^>]*\shidden(?=[\s/>])[^>]*>", html):
    _cm = re.search(r'class="([^"]*)"', _tag.group(0))
    if _cm:
        hidden_classes.update(_cm.group(1).split())
override = re.search(r"\[hidden\]\s*\{[^}]*display\s*:\s*none", _style)
if hidden_classes and not override:
    check(FAIL, "Hidden elements",
          "%d class rule(s) fight the hidden attribute" % len(hidden_classes),
          "style.css needs [hidden]{display:none!important} -- otherwise "
          + ", ".join(sorted(hidden_classes)) + " never disappear")
else:
    check(OK, "Hidden elements",
          "hidden attribute beats %d class rules" % len(hidden_classes))

for lib in ("jszip.min.js", "pdf.min.js", "pdf.worker.min.js"):
    p = os.path.join(ROOT, "lib", lib)
    if os.path.exists(p):
        sz = os.path.getsize(p)
        check(OK, "lib/%s" % lib, "%.0f KB" % (sz / 1024))
    else:
        check(FAIL, "lib/%s" % lib, "missing")


# ------------------------------------------------------------------ license
lic = read("license.js") or ""
if "__rmLicense" not in lic:
    check(FAIL, "License bridge", "license.js does not expose window.__rmLicense",
          "app.js reads window.__rmLicense; without it every code fails")
else:
    check(OK, "License bridge", "window.__rmLicense exported")

# script order: license.js must precede app.js or the restore step runs blind
i_lic = html.find('src="license.js"')
i_app = html.find('src="app.js"')
if i_lic == -1:
    check(FAIL, "Script order", "license.js is not referenced by index.html",
          "add it before app.js")
elif i_lic > i_app:
    check(FAIL, "Script order", "license.js loads AFTER app.js",
          "move the license.js tag above app.js -- every unlock code would fail")
else:
    check(OK, "Script order", "license.js before app.js")

codes_p = os.path.join(ROOT, "codes", "codes.txt")
if os.path.exists(codes_p):
    lines = [l for l in open(codes_p, encoding="utf-8").read().split("\n") if l.strip()]
    check(OK, "Unlock codes", "%d codes ready to upload" % len(lines))
else:
    check(WARN, "Unlock codes", "codes/codes.txt missing",
          "run: python codes/gen_codes.py --n 200")

if os.path.exists(os.path.join(ROOT, ".nojekyll")):
    check(OK, ".nojekyll", "GitHub Pages will serve seo/ correctly")
else:
    check(WARN, ".nojekyll", "missing",
          "create an empty .nojekyll file, or GitHub may skip build paths")

total = 0
for f in ("index.html", "style.css", "app.js", "license.js", "samples.js"):
    q = os.path.join(ROOT, f)
    if os.path.exists(q):
        total += os.path.getsize(q)
check(OK, "Payload size", "%.0f KB of app code" % (total / 1024))


# ------------------------------------------------------------------ report
W = {"PASS": "[ ok ]", "WARN": "[warn]", "FAIL": "[FAIL]"}[OK]
head_sym = {OK: "[ ok ]", WARN: "[warn]", FAIL: "[FAIL]"}

print("")
print("  resume-match  --  launch pre-flight")
print("  " + "-" * 58)
for level, name, detail, howto in results:
    print("  %s  %-24s %s" % (head_sym[level], name, detail))
    if howto and level != OK:
        print("           %-24s %s" % ("", howto))
print("  " + "-" * 58)

nf = sum(1 for r in results if r[0] == FAIL)
nw = sum(1 for r in results if r[0] == WARN)
print("  %d passed, %d warnings, %d blocking" %
      (sum(1 for r in results if r[0] == OK), nw, nf))
print("")

strict = "--strict" in sys.argv
if nf:
    print("  Not ready. Fix the failures above.")
    sys.exit(1)
if nw and strict:
    print("  Warnings present and --strict was requested.")
    sys.exit(1)
print("  Ready to deploy.")
