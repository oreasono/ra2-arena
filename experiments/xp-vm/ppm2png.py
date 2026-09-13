import sys, zlib, struct
def read_ppm(p):
    d = open(p, "rb").read()
    if not d.startswith(b"P6"): raise SystemExit("not P6 ppm")
    vals, i = [], 2
    while len(vals) < 3:
        while i < len(d) and d[i:i+1].isspace(): i += 1
        if d[i:i+1] == b"#":
            while d[i:i+1] != b"\n": i += 1
            continue
        j = i
        while not d[j:j+1].isspace(): j += 1
        vals.append(int(d[i:j])); i = j
    i += 1
    w, h, _ = vals
    return w, h, d[i:i + w*h*3]
def png(w, h, rgb, out):
    raw = b"".join(b"\0" + rgb[y*w*3:(y+1)*w*3] for y in range(h))
    def chunk(t, b): 
        c = t + b
        return struct.pack(">I", len(b)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
    open(out, "wb").write(b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
w, h, rgb = read_ppm(sys.argv[1]); png(w, h, rgb, sys.argv[2]); print(f"{w}x{h} -> {sys.argv[2]}")
