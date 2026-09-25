# -*- coding: utf-8 -*-
"""
Generate one landing page per job title.

Design rule that decides whether this survives a Google update:
each page must still be useful if you delete the job title variable.
So every page ships a WORKING checker (paste a resume -> see which of this
job's keywords are missing), not a paragraph of text with the title swapped in.

Google's 2026 "scaled content abuse" enforcement targets template fill.
"Tools & calculators - real utility per page" is explicitly the category that
still works. Stay in that category.

Usage:
    python gen.py                 # writes into ./out
    python gen.py --home https://example.com/
"""
import json, os, re, argparse, html, datetime

HERE = os.path.dirname(os.path.abspath(__file__))

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#111827;--ink2:#374151;--ink3:#6b7280;--ink4:#9ca3af;--line:#e5e7eb;
--bg:#fff;--bg2:#f7f8fa;--bg3:#f2f4f7;--brand:#4338ca;--brandsoft:#eef2ff;
--ok:#047857;--okbg:#ecfdf5;--okline:#a7f3d0;--mid:#b45309;--midbg:#fffbeb;--midline:#fde68a;
--bad:#b91c1c;--badbg:#fef2f2;--badline:#fecaca}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
color:var(--ink);background:var(--bg2);line-height:1.7;-webkit-font-smoothing:antialiased}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
header{background:#fff;border-bottom:1px solid var(--line);padding:26px 0 22px}
h1{font-size:23px;letter-spacing:-.3px;line-height:1.4}
.sub{color:var(--ink3);font-size:14px;margin-top:7px}
main{padding:24px 20px 50px}
section{background:#fff;border:1px solid var(--line);border-radius:12px;padding:22px 24px;margin-bottom:16px}
h2{font-size:17px;margin-bottom:8px}
p{font-size:14px;margin-bottom:10px}
.tool{border:1px solid var(--line);border-radius:10px;padding:16px;background:#fcfdff}
textarea{width:100%;height:150px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;
font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.65;resize:vertical}
textarea:focus{outline:none;border-color:#818cf8;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
.btn{background:var(--brand);color:#fff;border:none;border-radius:8px;padding:10px 18px;
font-size:13.5px;font-weight:650;cursor:pointer;margin-top:10px}
.btn:hover{background:#3730a3}
.res{margin-top:14px}
.pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;margin-right:8px}
.p-ok{background:var(--okbg);color:var(--ok);border:1px solid var(--okline)}
.p-mid{background:var(--midbg);color:var(--mid);border:1px solid var(--midline)}
.p-bad{background:var(--badbg);color:var(--bad);border:1px solid var(--badline)}
.kwrow{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}
.kwrow:last-child{border-bottom:none}
.kwt{font-weight:650;font-size:13.5px}
.kwa{font-size:12px;color:var(--ink4)}
.stat{display:flex;gap:10px;margin-top:12px;flex-wrap:wrap}
.stat div{background:var(--bg3);border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:12.5px}
.stat b{font-size:16px;color:var(--brand)}
.cta{background:linear-gradient(135deg,#312e81,#4338ca);color:#fff;border-radius:12px;padding:22px 24px}
.cta h2{color:#fff}
.cta p{color:#dbeafe}
.cta .btn{background:#fff;color:#312e81}
.cta .btn:hover{background:#eef2ff}
.note{background:var(--bg3);border:1px solid var(--line);border-radius:9px;padding:12px 14px;
font-size:12.5px;color:var(--ink3);margin-top:14px}
footer{background:#fff;border-top:1px solid var(--line);padding:20px 0;color:var(--ink4);font-size:12.5px}
a{color:var(--brand)}
"""

JS = r"""
var KW = __KW__;

function esc(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}

/* Word-boundary phrase test. Substring matching is the trap: "ts" lives inside
   "tests", "ai" inside "maintain". Those false hits are worse than a miss,
   because they tell someone their resume is fine when it is not. */
function has(hay, needle){
  if(!needle) return false;
  try{
    var body = esc(needle).replace(/\s+/g, "[^a-z0-9]{0,3}");
    return new RegExp("(^|[^a-z0-9])" + body + "(?:e?s)?(?![a-z0-9])", "i").test(hay);
  }catch(e){
    return hay.toLowerCase().indexOf(needle.toLowerCase()) > -1;
  }
}

function run(){
  var text = document.getElementById("cv").value;
  var box = document.getElementById("res");
  if(text.trim().length < 60){
    box.innerHTML = '<div class="note">Paste a bit more \u2014 at least a few lines of your resume.</div>';
    return;
  }
  var ok = [], mid = [], bad = [];
  KW.forEach(function(item){
    if(has(text, item.k)){ ok.push(item); return; }
    var viaAlias = null;
    for(var i = 0; i < (item.a || []).length; i++){
      if(has(text, item.a[i])){ viaAlias = item.a[i]; break; }
    }
    if(viaAlias) mid.push({ k: item.k, via: viaAlias });
    else bad.push(item);
  });

  var rows = "";
  function row(item, cls, pill, extra){
    var alias = (item.a && item.a.length) ? ' <span class="kwa">\u00b7 also written as ' + item.a.join(", ") + '</span>' : "";
    return '<div class="kwrow"><span class="pill ' + cls + '">' + pill + '</span>' +
           '<span class="kwt">' + item.k + '</span>' + alias + (extra || "") + '</div>';
  }
  bad.forEach(function(i){ rows += row(i, "p-bad", "missing"); });
  mid.forEach(function(i){
    rows += '<div class="kwrow"><span class="pill p-mid">partial</span><span class="kwt">' + i.k +
            '</span><span class="kwa">\u00b7 you wrote \u201c' + i.via +
            '\u201d \u2014 switch to the posting\u2019s wording, parsers compare strings not meanings</span></div>';
  });
  ok.forEach(function(i){ rows += row(i, "p-ok", "matched"); });

  var pct = KW.length ? Math.round(ok.length / KW.length * 100) : 0;
  box.innerHTML =
    '<div class="stat"><div><b>' + ok.length + '</b> matched</div>' +
    '<div><b>' + mid.length + '</b> under a different wording</div>' +
    '<div><b>' + bad.length + '</b> missing</div>' +
    '<div><b>' + pct + '%</b> of this checklist</div></div>' +
    '<div class="res">' + rows + '</div>';
}

document.getElementById("go").addEventListener("click", run);
"""


def job_page(slug, job, home, tool, others, year):
    kw_json = json.dumps(
        [{"k": x["k"], "a": x.get("alias", [])} for x in job["keywords"]],
        ensure_ascii=False,
    )
    js = JS.replace("__KW__", kw_json)

    nav = " &middot; ".join(
        '<a href="%s.html">%s</a>' % (s, html.escape(v["title"]))
        for s, v in others
        if s != slug
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(job['h1'])} &mdash; free checklist, runs in your browser</title>
<meta name="description" content="The {html.escape(job['title'])} keywords that show up most often in job postings, with the alternative spellings parsers accept. Paste your resume and see what is missing. Runs locally, nothing uploaded.">
<link rel="canonical" href="{home}{slug}.html">
<style>{CSS}</style>
</head>
<body>

<header>
  <div class="wrap">
    <h1>{html.escape(job['h1'])}</h1>
    <p class="sub">{html.escape(job['blurb'])}</p>
  </div>
</header>

<main class="wrap">

  <section>
    <h2>Check your resume against this list</h2>
    <p>Paste your resume below. It stays in your browser &mdash; there is no server, so there is nothing to upload and no reason to cap it.</p>
    <div class="tool">
      <textarea id="cv" placeholder="Paste your resume text here. From a PDF, open it, Ctrl+A, Ctrl+C &mdash; layout does not matter for keyword matching."></textarea>
      <button class="btn" id="go">Check my resume</button>
      <div id="res"></div>
    </div>
    <div class="note">
      <b>What this does not tell you.</b> No outside tool can see an employer&rsquo;s real ATS configuration, so any
      &ldquo;ATS score&rdquo; you see elsewhere is a made-up weighting. What <i>is</i> verifiable is whether the words in the
      posting appear in your resume &mdash; parsers compare strings, not meanings.
    </div>
  </section>

  <section>
    <h2>The list ({len(job['keywords'])} keywords)</h2>
    <p>Ordered as a checklist, not by importance &mdash; which of these matter depends on the specific posting. The alternative
    spellings matter: a parser looking for &ldquo;TypeScript&rdquo; will not count &ldquo;TS&rdquo;.</p>
    <div>
      {"".join('<div class="kwrow"><span class="kwt">%s</span>%s</div>' % (
          html.escape(x["k"]),
          ' <span class="kwa">&middot; also written as %s</span>' % html.escape(", ".join(x.get("alias", [])))
          if x.get("alias") else ""
      ) for x in job["keywords"])}
    </div>
  </section>

  <section class="cta">
    <h2>Want this run against one specific job posting?</h2>
    <p>This page checks a generic {html.escape(job['title'])} checklist. The full tool reads the actual posting you are
    applying to, pulls out the words <i>it</i> repeats, and gives you a sentence for each gap &mdash; plus it reads your
    .docx structure to catch the things that make a resume parse as blank.</p>
    <a href="{tool}"><button class="btn">Open the full matcher</button></a>
  </section>

  <section>
    <h2>Other roles</h2>
    <p>{nav}</p>
  </section>

</main>

<footer>
  <div class="wrap">
    Runs entirely in your browser &middot; no account, no upload, no tracking &middot; updated {year}<br>
    This checklist is a starting point, not a statistic &mdash; check it against the posting you are actually applying to.
  </div>
</footer>

<script>{js}</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--home", default=None, help="public base URL, e.g. https://you.github.io/resume-match/seo/")
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    args = ap.parse_args()

    data = json.load(open(os.path.join(HERE, "jobs.json"), encoding="utf-8"))
    home = args.home or data.get("_home_url", "./")
    if not home.endswith("/"):
        home += "/"

    # Self-heal the publish URL. _home_url is hand-editable, and it is easy to
    # leave it one folder short of where the files actually get written. That
    # mistake is invisible locally and ships 404s into every canonical tag,
    # so the folder name is appended here instead of being trusted.
    out_name = os.path.basename(os.path.normpath(args.out))
    if not home.rstrip("/").endswith("/" + out_name):
        home = home.rstrip("/") + "/" + out_name + "/"

    # These pages live in a subfolder; the CTA has to reach the actual tool,
    # not the folder the pages sit in.
    if data.get("_tool_url"):
        tool = data["_tool_url"]
    else:
        tool = re.sub(r"/?seo/" + re.escape(out_name) + r"/?$", "/", home)
    if not tool.endswith("/"):
        tool += "/"
    jobs = data["_jobs"]
    others = list(jobs.items())
    year = datetime.date.today().year

    os.makedirs(args.out, exist_ok=True)
    made = []

    for slug, job in jobs.items():
        p = os.path.join(args.out, slug + ".html")
        open(p, "w", encoding="utf-8").write(job_page(slug, job, home, tool, others, year))
        made.append(slug)

    # hub page
    links = "".join(
        '<div class="kwrow"><a href="%s.html"><span class="kwt">%s</span></a>'
        '<span class="kwa">&middot; %d keywords</span></div>' % (s, html.escape(v["title"]), len(v["keywords"]))
        for s, v in jobs.items()
    )
    hub = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resume keywords by role</title>
<meta name="description" content="Pick your role and see the keywords hiring managers repeat, with a checker that runs in your browser. No upload, no signup.">
<link rel="canonical" href="{home}index.html">
<style>{CSS}</style></head>
<body><header><div class="wrap"><h1>Resume keywords by role</h1>
<p class="sub">Pick your role. Each page is a working checker, not an article.</p></div></header>
<main class="wrap"><section>{links}</section>
<section class="cta"><h2>Check against a real posting instead</h2>
<p>These pages use a generic checklist. The full tool reads the actual job description and your resume file.</p>
<a href="{tool}"><button class="btn">Open the full matcher</button></a>
</section></main></body></html>"""
    open(os.path.join(args.out, "index.html"), "w", encoding="utf-8").write(hub)

    today = datetime.date.today().isoformat()

    def urlset(locs):
        body = "".join(
            '  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n' % (u, today)
            for u in locs
        )
        return ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                + body + "</urlset>\n")

    open(os.path.join(args.out, "sitemap.xml"), "w", encoding="utf-8").write(
        urlset([home + "index.html"] + [home + s + ".html" for s in made])
    )

    # The sitemap Google actually looks for is /sitemap.xml at the host root,
    # and it has to list the tool page too. Otherwise the only way to find the
    # role pages is by crawling a link -- which on a new domain with no
    # inbound links takes weeks, if it happens at all.
    if tool.startswith("http"):
        root = os.path.dirname(HERE)
        open(os.path.join(root, "sitemap.xml"), "w", encoding="utf-8").write(
            urlset([tool + "index.html", home + "index.html"]
                   + [home + s + ".html" for s in made])
        )
        open(os.path.join(root, "robots.txt"), "w", encoding="utf-8").write(
            "User-agent: *\nAllow: /\n\nSitemap: %ssitemap.xml\n" % tool
        )
        print("ROOTSITEMAP", os.path.join(root, "sitemap.xml"))
        print("ROBOTS", os.path.join(root, "robots.txt"))
    else:
        print("ROOTSITEMAP skipped -- _tool_url is not an absolute URL yet")

    print("PAGES", len(made))
    print("SLUGS", ", ".join(made))
    print("OUT", args.out)
    print("HOME", home)


if __name__ == "__main__":
    main()
