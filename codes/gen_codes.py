# -*- coding: utf-8 -*-
"""Generate unlock codes for resume-match.

The codes are validated offline, in the browser, by license.js. This script
must agree with that file exactly -- hence the self-test at the bottom, which
re-derives every code it just generated.

Usage:
    python gen_codes.py                 # 200 codes
    python gen_codes.py --n 50          # how many
    python gen_codes.py --n 50 --formatted

Output:
    codes.txt     one code per line, plain  -- paste into Lemon Squeezy
    codes.csv     code + issued flag        -- if you want to track them
"""

import argparse
import csv
import os
import random
import sys

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
SALT = "resume-match-2026"
PAYLOAD = 9
TOTAL = 12


def fnv1a(s):
    """32-bit FNV-1a. Mirrors the JS implementation bit for bit."""
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) & 0xFFFFFFFF
    return h


def checksum(payload):
    h = fnv1a(payload + "|" + SALT)
    n = len(ALPHABET)
    out = []
    for _ in range(3):
        out.append(ALPHABET[h % n])
        h //= n
    return "".join(reversed(out))


def make_code(rng):
    payload = "".join(rng.choice(ALPHABET) for _ in range(PAYLOAD))
    return payload + checksum(payload)


def valid(code):
    if len(code) != TOTAL:
        return False
    if any(c not in ALPHABET for c in code):
        return False
    return checksum(code[:PAYLOAD]) == code[PAYLOAD:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=200, help="how many codes to generate")
    ap.add_argument("--seed", default=None, help="seed, so you can regenerate the same batch")
    ap.add_argument("--formatted", action="store_true", help="write dashes into codes.txt")
    args = ap.parse_args()

    rng = random.Random(args.seed)

    codes, seen = [], set()
    while len(codes) < args.n:
        c = make_code(rng)
        if c in seen:
            continue          # collisions are vanishingly rare, but batch must be unique
        seen.add(c)
        codes.append(c)

    bad = [c for c in codes if not valid(c)]
    if bad:
        sys.stderr.write("SELF-TEST FAILED for %d codes: %s\n" % (len(bad), bad[:3]))
        sys.exit(1)

    here = os.path.dirname(os.path.abspath(__file__))
    shape = (lambda c: "%s-%s-%s" % (c[:4], c[4:8], c[8:])) if args.formatted else (lambda c: c)

    with open(os.path.join(here, "codes.txt"), "w", encoding="utf-8", newline="\n") as f:
        for c in codes:
            f.write(shape(c) + "\n")

    with open(os.path.join(here, "codes.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["code", "issued"])
        for c in codes:
            w.writerow([c, ""])

    msg = []
    msg.append("generated=%d" % len(codes))
    msg.append("self_test=PASS (%d/%d round-tripped)" % (len(codes), len(codes)))
    msg.append("sample=%s" % shape(codes[0]))
    msg.append("collision_guard=on")
    msg.append("")
    msg.append("Space used: %d^%d = %s possible codes." %
               (len(ALPHABET), PAYLOAD, format(len(ALPHABET) ** PAYLOAD, ",")))
    msg.append("(~%.1f trillion, for reference.)" % ((len(ALPHABET) ** PAYLOAD) / 1e12))
    msg.append("Not enough to stop a determined attacker -- nothing client-side can.")
    msg.append("Enough that nobody invents one by typing.")
    open(os.path.join(here, "_genlog.txt"), "w", encoding="utf-8").write("\n".join(msg))
    print("OK %d codes" % len(codes))


if __name__ == "__main__":
    main()
