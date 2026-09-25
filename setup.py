# -*- coding: utf-8 -*-
"""One command to fill in the things only you know.

The tool ships with placeholders because nobody can guess your GitHub name or
your checkout link. Filling them by hand means editing three files in the right
order and remembering to rerun the SEO generator -- which is exactly the kind
of chore people skip, then wonder why canonical URLs disagree.

    python setup.py                       # asks you, one question at a time
    python setup.py --user octocat --live
    python setup.py --user octocat --checkout https://store.lemonsqueezy.com/checkout/... --live
    python setup.py --report              # just show what is still missing

--live also deletes DEMO_CODE, which otherwise lets anyone unlock for free.
"""

import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(ROOT, "deploy.json")
PY = sys.executable


def read(p):
    q = os.path.join(ROOT, p)
    if not os.path.exists(q):
        return None
    with open(q, encoding="utf-8") as f:
        return f.read()


def write(p, s):
    with open(os.path.join(ROOT, p), "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def set_var(src, name, value):
    """Replace `var NAME = "...";` in place, or insert it under SETTINGS."""
    pat = re.compile(r'(var\s+%s\s*=\s*)"[^"]*"' % re.escape(name))
    if pat.search(src):
        return pat.sub(lambda m: m.group(1) + json.dumps(value), src, count=1)
    anchor = "var UNLOCK_STORE"
    if anchor in src:
        return src.replace(
            anchor,
            'var %s = %s;\n\n' % (name, json.dumps(value)) + anchor, 1)
    return src + '\nvar %s = %s;\n' % (name, json.dumps(value))


def get_var(src, name):
    m = re.search(r'var\s+%s\s*=\s*"([^"]*)"' % re.escape(name), src)
    return m.group(1) if m else None


def ask(prompt, default=""):
    sys.stdout.write("%s%s" % (prompt, (" [%s]" % default) if default else ""))
    sys.stdout.write(" ")
    sys.stdout.flush()
    v = sys.stdin.readline().strip()
    return v or default


# ------------------------------------------------------------------ collect
def collect(a):
    user = a.user
    repo = a.repo or "resume-match"
    domain = a.domain
    checkout = a.checkout
    notify = a.notify

    if a.report:
        return None

    if not domain and not user:
        # "python setup.py --checkout <url> --live" with no --user must not
        # start asking questions: the address is already on file from last run
        # and the only thing left to change is the payment link.
        prior = None
        if os.path.exists(STATE):
            try:
                prior = json.load(open(STATE, encoding="utf-8"))
            except Exception:
                prior = None
        if prior and prior.get("base") and (a.live or a.checkout or a.notify):
            cfg = dict(prior)
            if a.checkout:
                cfg["checkout"] = a.checkout
            if a.notify:
                cfg["notify"] = a.notify
            return cfg

        print("")
        print("  Resume <-> JD Match  --  first-run setup")
        print("  " + "-" * 56)
        print("  Two things I cannot invent for you. Everything else is done.")
        print("")
        user = ask("1. Your GitHub username (the part after github.com/)", "")
        print("")
        print("  2. Payment link from Lemon Squeezy, e.g.")
        print("     https://yourstore.lemonsqueezy.com/checkout/xxxx")
        print("     Press Enter to skip -- the tool still ships today and the")
        print("     button turns into \"email me when payment opens\".")
        checkout = ask("     Checkout URL", "")
        if not checkout:
            notify = ask("     Email to notify instead", "")

    if domain:
        base = domain if domain.endswith("/") else domain + "/"
        host = None
    else:
        # GitHub Pages hostnames must be lowercase. A username with capitals
        # (TIAMO-LUCKY) still owns the site, but https://TIAMO-LUCKY.github.io
        # is not the canonical URL -- it redirects to the lowercase form.
        # Writing capitals into og:url and canonical makes every share preview
        # point at a redirect instead of the page.
        host = user.lower()
        base = "https://%s.github.io/%s/" % (host, repo)

    # gen.py writes into seo/out/, so that folder is part of the public URL.
    # Pointing _home_url at ".../seo/" makes every canonical a 404.
    seo = base + "seo/out/"
    return {"user": user, "repo": repo, "base": base, "seo": seo, "host": host,
            "checkout": checkout, "notify": notify}


def apply_config(cfg, live):
    log = []

    # ---- app.js ------------------------------------------------------
    app = read("app.js") or ""
    before = app
    if cfg["checkout"]:
        app = set_var(app, "CHECKOUT_URL", cfg["checkout"])
        log.append(("app.js", "CHECKOUT_URL -> %s" % cfg["checkout"]))
    if cfg["notify"]:
        app = set_var(app, "NOTIFY_EMAIL", cfg["notify"])
        log.append(("app.js", "NOTIFY_EMAIL -> %s" % cfg["notify"]))
    if live:
        app = set_var(app, "DEMO_CODE", "")
        log.append(("app.js", "DEMO_CODE cleared (--live)"))
    if app != before:
        write("app.js", app)

    # ---- index.html --------------------------------------------------
    html = read("index.html") or ""
    old = None
    if os.path.exists(STATE):
        try:
            old = json.load(open(STATE, encoding="utf-8")).get("base")
        except Exception:
            old = None

    targets = [t for t in (old, "https://YOUR-USERNAME.github.io/resume-match/") if t]
    hit = False
    for t in targets:
        if t and t in html:
            html = html.replace(t, cfg["base"])
            hit = True
    if hit:
        # The instruction comment stops being true the moment it is followed.
        html = re.sub(
            r"<!-- Replace YOUR-USERNAME.*?-->",
            "<!-- URLs below point at %s (set by setup.py) -->" % cfg["base"],
            html, flags=re.S)
        write("index.html", html)
        log.append(("index.html", "canonical / og:url / og:image -> %s" % cfg["base"]))

    # ---- seo/jobs.json -----------------------------------------------
    p = os.path.join(ROOT, "seo", "jobs.json")
    if os.path.exists(p):
        raw = open(p, encoding="utf-8").read()
        for t in targets:
            if t:
                raw = raw.replace(t + "seo/", cfg["seo"]).replace(t, cfg["base"])
        try:
            data = json.loads(raw)
        except Exception:
            data = None
        if data is not None:
            data["_home_url"] = cfg["seo"]
            data["_tool_url"] = cfg["base"]
            data["_todo"] = "URLs set by setup.py. Edit _home_url/_tool_url directly only if you move the site."
            raw = json.dumps(data, ensure_ascii=False, indent=2)
        write("seo/jobs.json", raw)
        log.append(("seo/jobs.json", "_home_url / _tool_url -> %s" % cfg["seo"]))

    json.dump(cfg, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return log


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default=None)
    ap.add_argument("--repo", default="resume-match")
    ap.add_argument("--domain", default=None, help="custom domain, e.g. https://resumematch.example.com")
    ap.add_argument("--checkout", default=None)
    ap.add_argument("--notify", default=None)
    ap.add_argument("--live", action="store_true", help="also clear DEMO_CODE")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()

    if a.report:
        rc = subprocess.call([PY, os.path.join(ROOT, "preflight.py")])
        sys.exit(rc)

    cfg = collect(a)
    if cfg is None:
        sys.exit(0)

    if not cfg["base"].startswith("https://"):
        print("  base URL must start with https://  (got %r)" % cfg["base"])
        sys.exit(1)

    log = apply_config(cfg, a.live)

    if log:
        print("")
        print("  Applied")
        print("  " + "-" * 56)
        for f, what in log:
            print("   %-16s %s" % (f, what))

    # Child processes write to the same console; without flushing first, their
    # output lands ahead of the "Applied" list and the log reads backwards.
    sys.stdout.flush()
    print("")
    print("  Regenerating SEO pages")
    print("  " + "-" * 56)
    subprocess.call([PY, os.path.join(ROOT, "seo", "gen.py")])

    sys.stdout.flush()
    print("")
    rc = subprocess.call([PY, os.path.join(ROOT, "preflight.py")])
    sys.exit(rc)


if __name__ == "__main__":
    main()
