# -*- coding: utf-8 -*-
"""Get it onto GitHub Pages.

Nothing here is clever. It exists because the manual version has one trap that
is expensive: `git add -A` in this folder uploads codes/codes.txt, and every
unlock code you generated is then public. Anyone who finds it unlocks for free
and there is no undo -- git history keeps it after you delete the file.

    python deploy.py            # init, commit, stop. Shows the push command.
    python deploy.py --push     # also create the repo and push (needs `gh auth login`)

Run setup.py first. preflight.py must pass before --push does anything.
"""

import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

GITIGNORE = """# Unlock codes are money. If these are committed, they are public forever --
# deleting the file later does not remove it from git history.
codes/codes.txt
codes/codes.csv
codes/_genlog.txt

# Local-only deployment state
deploy.json

__pycache__/
*.pyc
.DS_Store
"""


def run(cmd, cwd=ROOT, show=True):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return 127, "", "%s not found" % cmd[0]
    if show and (p.stdout or p.stderr):
        out = (p.stdout or "") + (p.stderr or "")
        for line in out.strip().split("\n")[-25:]:
            print("   | " + line)
    return p.returncode, p.stdout or "", p.stderr or ""


def build_drop():
    """Copy the site into a sibling folder that is safe to drag onto GitHub.

    Browser upload ignores .gitignore -- whatever is in the folder goes up.
    So the unlock codes are removed here, by copying, rather than trusted to
    a rule that the upload page never reads.
    """
    dst = os.path.join(os.path.dirname(ROOT), "upload-resume-match")

    def ignore(path, names):
        bad = set()
        low = os.path.abspath(path)
        if low == os.path.abspath(os.path.join(ROOT, "codes")):
            bad |= {n for n in names if n.endswith((".txt", ".csv"))}
        for n in names:
            if n in (".git", "__pycache__", "deploy.json", ".gitignore"):
                bad.add(n)
            elif n.endswith((".pyc", ".py")):
                bad.add(n)
            elif n.startswith("_"):
                # scratch output from check runs -- never part of the site
                bad.add(n)
        return bad

    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(ROOT, dst, ignore=ignore)

    # A folder whose contents were all filtered out shows up empty, and
    # GitHub's drag-and-drop silently refuses empty folders -- which reads as
    # "it would not upload" instead of "there was nothing in it". Drop them,
    # so what you see is exactly what can go up.
    for dirpath, _dirs, _files in os.walk(dst, topdown=False):
        if dirpath != dst and not os.listdir(dirpath):
            shutil.rmtree(dirpath)

    left = []
    for dirpath, _, files in os.walk(dst):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), dst)
            if rel.startswith("codes" + os.sep) and f.endswith((".txt", ".csv")):
                left.append(rel)

    print("  [ ok ]  built %s" % dst)
    print("  [ ok ]  %d items at the top level, %d files in total" %
          (len(os.listdir(dst)), sum(len(f) for _, _, f in os.walk(dst))))
    if left:
        print("  [FAIL]  codes leaked into the upload folder: %s" % ", ".join(left[:3]))
        return 1
    print("")
    print("  Drag THAT folder onto https://github.com/<you>/resume-match")
    print("  (Add file -> Upload files). Do not drag resume-match itself --")
    print("  it still holds codes/codes.txt, and the web uploader has no")
    print("  .gitignore to save you.")
    print("")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true")
    ap.add_argument("--drop", action="store_true",
                    help="build ../upload-resume-match for browser upload")
    ap.add_argument("--repo", default=None)
    a = ap.parse_args()

    print("")
    print("  resume-match  --  deploy")
    print("  " + "-" * 56)

    if a.drop:
        sys.exit(build_drop())

    # 0. never deploy something that fails its own checks
    rc = subprocess.call([PY, os.path.join(ROOT, "preflight.py")])
    if rc != 0:
        print("")
        print("  Stopped: preflight failed. Fix it above, then rerun.")
        sys.exit(1)

    # 1. gitignore before the first add, not after
    gi = os.path.join(ROOT, ".gitignore")
    if not os.path.exists(gi):
        open(gi, "w", encoding="utf-8", newline="\n").write(GITIGNORE)
        print("  [ ok ]  wrote .gitignore (codes/ excluded)")
    else:
        txt = open(gi, encoding="utf-8").read()
        if "codes/codes.txt" not in txt:
            open(gi, "a", encoding="utf-8", newline="\n").write("\ncodes/codes.txt\ncodes/codes.csv\n")
            print("  [warn]  .gitignore existed without codes/ -- appended")
        else:
            print("  [ ok ]  .gitignore already excludes codes/")

    # 2. repo
    if not os.path.isdir(os.path.join(ROOT, ".git")):
        rc, _, _ = run(["git", "init", "-b", "main"], show=False)
        if rc != 0:
            print("  [FAIL]  git init failed -- is git installed?")
            sys.exit(1)
        print("  [ ok ]  git init (branch main)")
    else:
        print("  [ ok ]  git repo already here")

    run(["git", "add", "-A"], show=False)

    # Hard stop: never commit the codes, whatever .gitignore says.
    # Narrow on purpose -- codes/gen_codes.py is meant to be committed, and a
    # rule that blocks the whole folder blocks the generator too.
    rc, listed, _ = run(["git", "diff", "--cached", "--name-only"], show=False)
    SAFE_IN_CODES = {"gen_codes.py", "README.md"}
    leaked = []
    for f in listed.split("\n"):
        f = f.strip()
        if not f.startswith("codes/"):
            continue
        name = f.rsplit("/", 1)[-1]
        if name in SAFE_IN_CODES:
            continue
        if name.endswith((".txt", ".csv")):
            leaked.append(f)
    if leaked:
        run(["git", "reset"], show=False)
        print("  [FAIL]  refusing to commit these: %s" % ", ".join(leaked))
        print("          they were already staged -- unstaged now. Check .gitignore.")
        sys.exit(1)
    print("  [ ok ]  staged, no unlock codes among %d files"
          % len([f for f in listed.split("\n") if f.strip()]))

    rc, _, _ = run(["git", "commit", "-m", "Resume <-> JD keyword matcher"], show=False)
    print("  [ ok ]  committed" if rc == 0 else "  [    ]  nothing new to commit")

    state = {}
    p = os.path.join(ROOT, "deploy.json")
    if os.path.exists(p):
        import json
        try:
            state = json.load(open(p, encoding="utf-8"))
        except Exception:
            state = {}

    user = state.get("user") or "YOUR-USERNAME"
    repo = a.repo or state.get("repo") or "resume-match"
    base = state.get("base") or ("https://%s.github.io/%s/" % (user, repo))

    print("  " + "-" * 56)
    if not a.push:
        print("  Done locally. To go public:")
        print("")
        print("     gh repo create %s --public --source=. --push" % repo)
        print("     gh api repos/%s/%s/pages -X POST -f \"source[branch]=main\" -f \"source[path]=/\"" % (user, repo))
        print("")
        print("  Or without gh: create an empty public repo on github.com, then")
        print("     git remote add origin https://github.com/%s/%s.git" % (user, repo))
        print("     git push -u origin main")
        print("  then Settings > Pages > Deploy from branch > main / (root)")
        print("")
        print("  Your URL will be: " + base)
        print("")
        return

    rc, _, _ = run(["gh", "repo", "create", repo, "--public", "--source=.", "--push"])
    if rc != 0:
        print("  [FAIL]  gh repo create failed -- run `gh auth login` first?")
        sys.exit(1)
    print("  [ ok ]  pushed to github.com/%s/%s" % (user, repo))

    rc, _, err = run(["gh", "api", "repos/%s/%s/pages" % (user, repo),
                      "-X", "POST", "-f", "source[branch]=main", "-f", "source[path]=/"])
    if rc == 0:
        print("  [ ok ]  GitHub Pages enabled from main / (root)")
    else:
        print("  [warn]  Pages not switched on automatically: %s" % err.strip()[:120])
        print("          Settings > Pages > Deploy from branch > main / (root)")

    print("")
    print("  Live at: " + base)
    print("  First page takes 1-3 minutes. Then check %sseo/" % base)
    print("")


if __name__ == "__main__":
    main()
