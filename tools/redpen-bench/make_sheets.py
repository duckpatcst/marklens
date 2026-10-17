"""Synthetic marked answer sheets for testing the red-pen reader (js/redpen.js).

Each page looks like a phone photo of a ruled answer booklet: off-white paper on a table,
blue ruled lines, a pink margin line, the student's writing in blue or black handwriting,
and the teacher's marks in red ink: digits from the MNIST test set (never seen in training),
some ringed, some as 3/5, 3 over 5 or 2½, ticks, red remarks, an underline and a ringed total
on the first page. Then the photo is spoiled a little: warm light, a shadow, blur, noise, JPEG.

    python make_sheets.py --mnist ./mnist --fonts ./fonts --out ./sheets --pages 12

Writes page-NN.jpg and truth.json (every mark with its box, value and question).
"""
import argparse, gzip, json, math, os, random
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

W, H = 1500, 2000          # the size MarkLens keeps photos at (longest side 2000 px)


def read_idx(path):
    with gzip.open(path, 'rb') as f:
        data = f.read()
    dims = int.from_bytes(data[:4], 'big') & 0xff
    shape = [int.from_bytes(data[4 + 4 * i: 8 + 4 * i], 'big') for i in range(dims)]
    return np.frombuffer(data, np.uint8, offset=4 + 4 * dims).reshape(shape)


class Ink:
    def __init__(self, page_rgb):
        self.img = page_rgb.astype(np.float32)

    def blend(self, alpha, x, y, color):
        """alpha: float mask 0..1, pasted with its top-left at (x, y)."""
        h, w = alpha.shape
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.img.shape[1], x + w), min(self.img.shape[0], y + h)
        if x1 <= x0 or y1 <= y0:
            return
        a = alpha[y0 - y:y1 - y, x0 - x:x1 - x][..., None]
        reg = self.img[y0:y1, x0:x1]
        # ink darkens the paper like a filter: multiply, not paint
        ink = np.array(color, np.float32) / 255.0
        self.img[y0:y1, x0:x1] = reg * (1 - a) + reg * ink * a


def text_alpha(font, s):
    bbox = font.getbbox(s)
    w, h = bbox[2] - bbox[0] + 8, bbox[3] - bbox[1] + 8
    im = Image.new('L', (max(1, w), max(1, h)), 0)
    ImageDraw.Draw(im).text((4 - bbox[0], 4 - bbox[1]), s, fill=255, font=font)
    return np.array(im, np.float32) / 255.0


def digit_alpha(img28, height, rng, thin):
    a = img28.astype(np.float32) / 255.0
    ys, xs = np.nonzero(a > 0.1)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    s = height / a.shape[0]
    a = cv2.resize(a, (max(2, int(a.shape[1] * s)), int(height)), interpolation=cv2.INTER_LINEAR)
    if thin:
        k = np.ones((3, 3), np.uint8)
        a = cv2.erode(a, k, iterations=1 if height < 50 else 2)
    return np.clip(a * 1.3, 0, 1)


def number_alpha(digits_by_class, value_str, height, rng, thin):
    pieces = []
    for ch in value_str:
        d = int(ch)
        pool = digits_by_class[d]
        pieces.append(digit_alpha(pool[rng.randrange(len(pool))], height * rng.uniform(0.9, 1.05), rng, thin))
    gap = int(height * rng.uniform(0.08, 0.25))
    hmax = max(p.shape[0] for p in pieces)
    w = sum(p.shape[1] for p in pieces) + gap * (len(pieces) - 1)
    out = np.zeros((hmax, w), np.float32)
    x = 0
    for p in pieces:
        out[hmax - p.shape[0]:, x:x + p.shape[1]] = np.maximum(out[hmax - p.shape[0]:, x:x + p.shape[1]], p)
        x += p.shape[1] + gap
    return out


def stroke_alpha(w, h, draw_fn, t):
    im = np.zeros((h, w), np.uint8)
    draw_fn(im, t)
    return im.astype(np.float32) / 255.0


def make_page(idx, rng, digits_by_class, fonts, red_font, n_questions, q_start, paper, first):
    page = np.zeros((H, W, 3), np.float32)
    # table behind the paper
    table = np.array(rng.choice([(120, 92, 70), (95, 95, 100), (150, 120, 90), (60, 55, 50)]), np.float32)
    page[:] = table + np.random.default_rng(idx).normal(0, 6, (H, W, 1))
    # the paper, a little rotated
    tint = np.array(rng.choice([(246, 243, 232), (240, 240, 238), (250, 246, 236), (236, 232, 220)]), np.float32)
    sheet = np.ones((int(H * 0.97), int(W * 0.93), 3), np.float32) * tint
    sh, sw = sheet.shape[:2]
    ink = Ink(sheet)
    # ruled lines and margin
    step = rng.randint(54, 66)
    for y in range(160, sh - 40, step):
        cv2.line(ink.img, (0, y), (sw, y), (190, 205, 228), 2, cv2.LINE_AA)
    mx = int(sw * rng.uniform(0.1, 0.13))
    margin_col = rng.choice([(225, 120, 140), (220, 90, 100), (230, 140, 165)])
    cv2.line(ink.img, (mx, 0), (mx, sh), margin_col, 2, cv2.LINE_AA)
    if rng.random() < 0.5:
        cv2.line(ink.img, (mx + 7, 0), (mx + 7, sh), margin_col, 2, cv2.LINE_AA)
    stud_col = rng.choice([(30, 50, 150), (25, 35, 110), (40, 40, 45)])
    sfont = ImageFont.truetype(rng.choice(fonts), rng.randint(34, 44))
    rfont = ImageFont.truetype(red_font, rng.randint(36, 46))
    red = rng.choice([(205, 25, 35), (190, 30, 60), (215, 45, 50), (200, 20, 90), (180, 35, 40)])
    thin = rng.random() < 0.5
    truth = []
    y = 170
    words = ['solve', 'given', 'therefore', 'x =', 'so', 'area =', 'we know', 'hence', 'let', 'step', 'proof:', 'answer', 'formula', 'sum', 'mean =', 'ratio']
    q = q_start
    if first:   # the ringed total at the top right of page 1
        tot = paper['total_got']
        s = f"{tot}"
        a = number_alpha(digits_by_class, s, rng.randint(70, 90), rng, thin)
        x, yy = sw - a.shape[1] - rng.randint(120, 180) - 160, 50
        ink.blend(a, x, yy, red)
        if rng.random() < 0.6:
            sl = stroke_alpha(60, a.shape[0] + 20, lambda im, t: cv2.line(im, (12, im.shape[0] - 6), (48, 6), 255, t, cv2.LINE_AA), 5)
            ink.blend(sl, x + a.shape[1] + 6, yy - 10, red)
            b = number_alpha(digits_by_class, str(paper['total_max']), rng.randint(60, 80), rng, thin)
            ink.blend(b, x + a.shape[1] + 70, yy + 10, red)
            x1 = x + a.shape[1] + 70 + b.shape[1]
            truth.append({'kind': 'total', 'got': tot, 'max': paper['total_max'], 'box': [x, yy - 10, x1, yy + a.shape[0] + 20]})
        else:
            truth.append({'kind': 'total', 'got': tot, 'max': None, 'box': [x, yy, x + a.shape[1], yy + a.shape[0]]})
        cx, cy = x + a.shape[1] // 2, yy + a.shape[0] // 2
        ring = stroke_alpha(sw, sh, lambda im, t: cv2.ellipse(im, (cx + (60 if truth[-1]['max'] else 0), cy), (a.shape[1] // 2 + (110 if truth[-1]['max'] else 34), a.shape[0] // 2 + 26), rng.uniform(-8, 8), 10, 350, 255, t, cv2.LINE_AA), 4)
        ink.blend(ring, 0, 0, red)
    while q < min(q_start + n_questions, len(paper['questions'])) and y < sh - 3 * step:
        qi = paper['questions'][q]
        lines = rng.randint(2, 5)
        label = rng.choice([f"Q{q + 1})", f"{q + 1}.", f"Ans {q + 1}.", f"Q.{q + 1}"])
        line_top = y
        for li in range(lines):
            s = (label + ' ' if li == 0 else '   ') + ' '.join(rng.choice(words) for _ in range(rng.randint(2, 5)))
            if rng.random() < 0.5:
                s += f" {rng.randint(1, 99)}"          # numbers in the student's own writing, in blue/black
            a = text_alpha(sfont, s)
            ink.blend(a, mx + 18, y - a.shape[0] + 10, stud_col)
            # each word of the student's line, as a text reader would box it
            xw = mx + 18 + 4
            for wtext in s.split(' '):
                if wtext:
                    wl = sfont.getlength(wtext)
                    truth.append({'kind': 'student', 'text': wtext, 'box': [int(xw), int(y - a.shape[0] + 14), int(xw + wl), int(y + 6)]})
                xw += sfont.getlength(wtext + ' ')
            if rng.random() < 0.25:                     # a red tick next to a correct step
                xx = mx + 30 + a.shape[1] + rng.randint(10, 40)
                if xx < sw - 300:
                    tk = stroke_alpha(70, 60, lambda im, t: cv2.polylines(im, [np.array([[6, 30], [24, 52], [64, 6]], np.int32)], False, 255, t, cv2.LINE_AA), rng.randint(3, 5))
                    ink.blend(tk, xx, y - 50, red)
                    truth.append({'kind': 'tick', 'box': [xx, y - 50, xx + 70, y + 10]})
            y += step
        got, mmax = qi['got'], qi['max']
        if got is None:                                 # not attempted: no mark
            q += 1; y += step // 2; continue
        style = rng.choice(['plain', 'plain', 'ring', 'ring', 'slash', 'stack', 'half'] if mmax >= 2 else ['plain', 'ring'])
        hgt = rng.randint(38, 58)
        if style == 'half':
            whole = int(got) if got >= 1 else 0
            got = whole + 0.5 if whole < mmax else got
        side = 'right' if rng.random() < 0.75 else 'left'
        a = number_alpha(digits_by_class, str(int(got)), hgt, rng, thin)
        if side == 'right':
            x = sw - rng.randint(110, 170) - (90 if style in ('slash',) else 0)
        else:
            x = rng.randint(14, max(16, mx - a.shape[1] - 14))
        ym = line_top + (lines - 1) * step - a.shape[0] // 2 - rng.randint(0, 20)
        ink.blend(a, x, ym, red)
        x1, y1 = x + a.shape[1], ym + a.shape[0]
        rec_max = None
        if style == 'slash':
            sl = stroke_alpha(50, hgt + 16, lambda im, t: cv2.line(im, (8, im.shape[0] - 5), (40, 5), 255, t, cv2.LINE_AA), rng.randint(3, 5))
            ink.blend(sl, x1 + 4, ym - 8, red)
            b = number_alpha(digits_by_class, str(mmax), hgt, rng, thin)
            ink.blend(b, x1 + 54, ym, red)
            x1 = x1 + 54 + b.shape[1]; rec_max = mmax
        elif style == 'stack':
            bar_y = y1 + 8
            bar = stroke_alpha(x1 - x + 16, 10, lambda im, t: cv2.line(im, (2, 5), (im.shape[1] - 3, 5), 255, t, cv2.LINE_AA), 3)
            ink.blend(bar, x - 8, bar_y - 5, red)
            b = number_alpha(digits_by_class, str(mmax), hgt, rng, thin)
            ink.blend(b, x + (a.shape[1] - b.shape[1]) // 2, bar_y + 10, red)
            y1 = bar_y + 10 + b.shape[0]; rec_max = mmax
        elif style == 'half' and got % 1:
            one = number_alpha(digits_by_class, '1', int(hgt * 0.45), rng, thin)
            two = number_alpha(digits_by_class, '2', int(hgt * 0.45), rng, thin)
            hx = x1 + 6
            ink.blend(one, hx + 4, ym - 6, red)
            bar = stroke_alpha(int(hgt * 0.5), 8, lambda im, t: cv2.line(im, (1, 4), (im.shape[1] - 2, 4), 255, t, cv2.LINE_AA), 3)
            ink.blend(bar, hx, ym - 6 + one.shape[0] + 2, red)
            ink.blend(two, hx + 2, ym - 6 + one.shape[0] + 10, red)
            x1 = hx + max(bar.shape[1], two.shape[1]) + 4
        if style == 'ring':
            cx, cy = (x + x1) // 2, (ym + y1) // 2
            rx, ry = (x1 - x) // 2 + rng.randint(12, 26), (y1 - ym) // 2 + rng.randint(10, 20)
            start = rng.uniform(-60, 0)
            ring = stroke_alpha(sw, sh, lambda im, t: cv2.ellipse(im, (cx, cy), (rx, ry), rng.uniform(-10, 10), start, start + rng.uniform(300, 370), 255, t, cv2.LINE_AA), rng.randint(3, 4))
            ink.blend(ring, 0, 0, red)
            x, ym, x1, y1 = cx - rx, cy - ry, cx + rx, cy + ry
        truth.append({'kind': 'mark', 'q': qi['q'], 'got': got, 'max': rec_max, 'qmax': mmax, 'style': style, 'side': side, 'box': [int(x), int(ym), int(x1), int(y1)]})
        if got < mmax and rng.random() < 0.45:     # a red remark under the answer
            rem = rng.choice(['sign error', 'units?', 'wrong formula', 'incomplete', 'see step 2', 'careless'])
            a = text_alpha(rfont, rem)
            rx0 = mx + rng.randint(120, 400)
            ink.blend(a, rx0, y - a.shape[0] // 2 - 6, red)
            truth.append({'kind': 'remark', 'text': rem, 'box': [rx0, y - a.shape[0] // 2 - 6, rx0 + a.shape[1], y + a.shape[0] // 2]})
            if rng.random() < 0.5:
                ul = stroke_alpha(400, 10, lambda im, t: cv2.line(im, (2, 5), (390, 5), 255, t, cv2.LINE_AA), 3)
                ink.blend(ul, mx + 40, line_top + 16, red)
        q += 1
        y += step // 2
    # put the paper on the table, a little rotated
    M = cv2.getRotationMatrix2D((sw / 2, sh / 2), rng.uniform(-2.5, 2.5), 1.0)
    M[0, 2] += (W - sw) / 2 + rng.uniform(-15, 15)
    M[1, 2] += (H - sh) / 2 + rng.uniform(-10, 10)
    warped = cv2.warpAffine(ink.img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(-1, -1, -1))
    m = (warped[..., 0] >= 0)[..., None]
    page = np.where(m, warped, page)
    for t in truth:
        x0, y0, x1, y1 = t['box']
        pts = np.array([[x0, y0], [x1, y0], [x0, y1], [x1, y1]], np.float32)
        tp = cv2.transform(pts[None], M)[0]
        t['box'] = [int(tp[:, 0].min()), int(tp[:, 1].min()), int(tp[:, 0].max()), int(tp[:, 1].max())]
    # light: warm cast, a soft shadow from one side, vignette
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    shade = 1 - rng.uniform(0.05, 0.3) * np.clip((xx / W) * rng.choice([1, -1]) + rng.uniform(-0.2, 0.4), 0, 1)
    vig = 1 - 0.18 * (((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2) * 2
    cast = np.array([1.0, rng.uniform(0.92, 1.0), rng.uniform(0.78, 0.97)], np.float32)
    page = page * (shade * vig)[..., None] * cast
    page = cv2.GaussianBlur(page, (0, 0), rng.uniform(0.5, 1.1))
    page = page + np.random.default_rng(idx + 99).normal(0, rng.uniform(2, 5), page.shape)
    return np.clip(page, 0, 255).astype(np.uint8), truth


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mnist', required=True)
    ap.add_argument('--fonts', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--pages', type=int, default=12)
    ap.add_argument('--seed', type=int, default=3)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    te_x = read_idx(os.path.join(a.mnist, 't10k-images-idx3-ubyte.gz'))
    te_y = read_idx(os.path.join(a.mnist, 't10k-labels-idx1-ubyte.gz'))
    digits_by_class = {d: te_x[te_y == d] for d in range(10)}
    fonts = [os.path.join(a.fonts, f) for f in sorted(os.listdir(a.fonts)) if f.endswith('.ttf') and os.path.getsize(os.path.join(a.fonts, f)) > 1000]
    stud_fonts = [f for f in fonts if any(k in f for k in ('Kalam', 'PatrickHand', 'IndieFlower', 'Caveat', 'Architects', 'Gochi'))]
    red_fonts = [f for f in fonts if any(k in f for k in ('ShadowsIntoLight', 'ReenieBeanie', 'Homemade', 'NanumPen'))] or fonts
    rng = random.Random(a.seed)
    all_truth = []
    page_no = 0
    while page_no < a.pages:
        nq = rng.randint(6, 9)
        qs = []
        for i in range(nq):
            mmax = rng.choice([1, 2, 2, 3, 3, 4, 5, 5, 6])
            got = None if rng.random() < 0.08 else rng.choice([mmax, mmax - 1, rng.randint(0, mmax)])
            qs.append({'q': str(i + 1), 'max': mmax, 'got': max(0, got) if got is not None else None})
        paper = {'questions': qs, 'total_max': sum(q['max'] for q in qs), 'total_got': int(sum(q['got'] or 0 for q in qs))}
        q = 0; first = True
        sheet_pages = []
        while q < nq and page_no < a.pages:
            per = rng.randint(3, 5)
            img, truth = make_page(page_no, rng, digits_by_class, stud_fonts, rng.choice(red_fonts), per, q, paper, first)
            name = f'page-{page_no:02d}.jpg'
            Image.fromarray(img).save(os.path.join(a.out, name), quality=rng.randint(72, 90))
            sheet_pages.append({'file': name, 'marks': truth})
            q += per; first = False; page_no += 1
        # half marks change the real total; recompute from what was drawn
        all_truth.append({'paper': [{'q': x['q'], 'max': x['max']} for x in qs], 'pages': sheet_pages})
    with open(os.path.join(a.out, 'truth.json'), 'w') as f:
        json.dump(all_truth, f, indent=1)
    print('wrote', page_no, 'pages to', a.out)


if __name__ == '__main__':
    main()
