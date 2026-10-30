"""Synthetic marked answer sheets for testing the on-phone marks reader (js/redmarks.js).

Each sheet looks like a phone photo of a ruled notebook page answered by a student and marked by a teacher:
blue ruled lines, a margin line (blue, double blue or red), the student's question numbers left of the margin
("1.", "Q3)", circled numbers), answers in blue or black handwriting, sometimes running onto a second line, a
"Section B" heading. The teacher marks in red, the way Indian school teachers often do:

  * a tick or a cross on every 1-mark answer, drawn with a wobbly hand, often across the ruled lines and the writing
  * a number beside longer answers ("2", "1½", "3/5"), from the MNIST test digits (never used in training)
  * sometimes no mark at all on one answer, with the section subtotal in the margin to tell (as on real sheets)
  * the section subtotal in the left margin, the total circled at the top, a signature and date
  * a ring round a wrong word, an underline

The ticks and crosses here are drawn by different code from the training data in train.py, so the test is fair.
The photo is then spoiled a little: rotation, warm light, shadow, blur, noise, JPEG.

    python make_tick_sheets.py --mnist ./mnist --fonts ./fonts --out ./ticks --sheets 24

Writes sheet-NN-pP.jpg, and truth.json: for every sheet, the paper text and every question's marks.
"""
import argparse, gzip, json, math, os, random
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

W, H = 1500, 2000
WORDS = ('the value of data it means answer because capital account salary business revenue income loop list tuple '
         'dictionary while break continue output function returns character equivalent statement assets liabilities '
         'drawings purchase sold profit cash credit debit journal ledger balance python string integer float range').split()


def read_idx(path):
    with gzip.open(path, 'rb') as f:
        data = f.read()
    dims = int.from_bytes(data[:4], 'big') & 0xff
    shape = [int.from_bytes(data[4 + 4 * i: 8 + 4 * i], 'big') for i in range(dims)]
    return np.frombuffer(data, np.uint8, offset=4 + 4 * dims).reshape(shape)


class Ink:
    def __init__(self, page_rgb):
        self.img = page_rgb.astype(np.float32)

    def blend(self, alpha, x, y, color, strength=1.0):
        h, w = alpha.shape
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.img.shape[1], x + w), min(self.img.shape[0], y + h)
        if x1 <= x0 or y1 <= y0:
            return
        a = np.clip(alpha[y0 - y:y1 - y, x0 - x:x1 - x] * strength, 0, 1)[..., None]
        reg = self.img[y0:y1, x0:x1]
        ink = np.array(color, np.float32) / 255.0
        self.img[y0:y1, x0:x1] = reg * (1 - a) + reg * ink * a


def text_alpha(font, s):
    bbox = font.getbbox(s)
    w, h = bbox[2] - bbox[0] + 8, bbox[3] - bbox[1] + 8
    im = Image.new('L', (max(1, w), max(1, h)), 0)
    ImageDraw.Draw(im).text((4 - bbox[0], 4 - bbox[1]), s, fill=255, font=font)
    return np.array(im, np.float32) / 255.0


def digit_alpha(img28, height):
    a = img28.astype(np.float32) / 255.0
    ys, xs = np.nonzero(a > 0.1)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    s = height / a.shape[0]
    a = cv2.resize(a, (max(2, int(a.shape[1] * s)), int(height)), interpolation=cv2.INTER_LINEAR)
    a = cv2.erode(a, np.ones((3, 3), np.uint8), iterations=1 if height < 50 else 2)
    return np.clip(a * 1.4, 0, 1)


def number_alpha(digits, s, height, rng):
    pieces = [digit_alpha(digits[int(ch)][rng.randrange(len(digits[int(ch)]))], height * rng.uniform(0.9, 1.05)) for ch in s]
    gap = int(height * rng.uniform(0.08, 0.2))
    hmax = max(p.shape[0] for p in pieces)
    out = np.zeros((hmax, sum(p.shape[1] for p in pieces) + gap * (len(pieces) - 1)), np.float32)
    x = 0
    for p in pieces:
        out[hmax - p.shape[0]:, x:x + p.shape[1]] = np.maximum(out[hmax - p.shape[0]:, x:x + p.shape[1]], p)
        x += p.shape[1] + gap
    return out


def wobbly(pts, rng, n=40, amp=1.5):
    """A hand-drawn path through the points: resampled, with a slow random wobble."""
    pts = np.array(pts, np.float32)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    t = np.concatenate([[0], np.cumsum(seg)]) / max(1e-6, seg.sum())
    u = np.linspace(0, 1, n)
    out = np.stack([np.interp(u, t, pts[:, 0]), np.interp(u, t, pts[:, 1])], 1)
    noise = np.random.default_rng(rng.randrange(1 << 30)).normal(0, amp * 0.3, out.shape)
    out += np.cumsum(noise, 0) * 0.3
    return out


def poly_alpha(paths, t, size):
    im = np.zeros(size[::-1], np.uint8)
    for p in paths:
        cv2.polylines(im, [np.round(p).astype(np.int32).reshape(-1, 1, 2)], False, 255, t, cv2.LINE_AA)
    return im.astype(np.float32) / 255.0


def tick_paths(x, y, size, rng):
    """A tick whose corner is at (x, y): short stroke in, long stroke out, up and to the right."""
    s = size
    a = (x - s * rng.uniform(0.15, 0.35), y - s * rng.uniform(0.2, 0.45))
    b = (x, y)
    c = (x + s * rng.uniform(0.55, 1.2), y - s * rng.uniform(0.7, 1.3))
    if rng.random() < 0.3:     # rounded corner
        return [wobbly([a, (x - s * 0.04, y - s * 0.02), (x + s * 0.06, y - s * 0.02), c], rng)]
    return [wobbly([a, b, c], rng)]


def cross_paths(cx, cy, size, rng):
    s = size / 2
    d1 = [(cx - s * rng.uniform(0.7, 1.1), cy - s * rng.uniform(0.7, 1.1)), (cx + s * rng.uniform(0.7, 1.2), cy + s * rng.uniform(0.7, 1.2))]
    d2 = [(cx + s * rng.uniform(0.7, 1.1), cy - s * rng.uniform(0.7, 1.1)), (cx - s * rng.uniform(0.7, 1.3), cy + s * rng.uniform(0.7, 1.3))]
    return [wobbly(d1, rng, 20), wobbly(d2, rng, 20)]


def make_sheet(idx, rng, digits, fonts, out_dir):
    q_total = rng.randint(10, 16)
    # the paper: section A of 1-mark questions, section B of 2- or 3-mark questions
    n_a = rng.randint(6, q_total - 3)
    b_max = rng.choice([2, 3, 5])
    questions = [{'q': i + 1, 'max': 1 if i < n_a else b_max, 'sec': 'A' if i < n_a else 'B'} for i in range(q_total)]
    paper = [f'SECTION - A {n_a}x1={n_a}'] + [f'{q["q"]}. {" ".join(rng.sample(WORDS, 5))}?' for q in questions[:n_a]]
    paper += [f'SECTION - B {q_total - n_a}x{b_max}={(q_total - n_a) * b_max}'] + [f'{q["q"]}. {" ".join(rng.sample(WORDS, 6))}.' for q in questions[n_a:]]
    # the student's answers and the teacher's marks
    for q in questions:
        if q['max'] == 1:
            q['got'] = 1 if rng.random() < 0.72 else 0
        else:
            q['got'] = rng.choice([v / 2 for v in range(0, 2 * q['max'] + 1)]) if rng.random() < 0.8 else q['max']
    # one 1-mark answer in section A has no mark of its own (only the subtotal tells), on about a third of the sheets
    forgot = rng.choice([q['q'] for q in questions[:n_a] if q['got'] == 1] or [None]) if rng.random() < 0.35 else None
    sub_a = sum(q['got'] for q in questions[:n_a])

    gap = rng.randint(64, 80)                       # ruled line spacing on the sheet
    margin_style = rng.choice(['blue', 'double', 'red'])
    label_style = rng.choice(['dot', 'circle', 'paren', 'Q'])
    pen = rng.choice([(25, 50, 160), (30, 30, 40), (40, 60, 120)])
    red = rng.choice([(205, 40, 50), (225, 60, 90), (190, 30, 40), (230, 80, 70)])
    font = ImageFont.truetype(rng.choice(fonts), int(gap * rng.uniform(0.72, 0.88)))
    pages, truth_pages = [], []
    sheet_w, sheet_h = int(W * 0.93), int(H * 0.97)
    order = list(questions)
    page_qs = [order[:len(order) // 2 + rng.randint(-1, 2)], None]
    page_qs[1] = order[len(page_qs[0]):]
    if rng.random() < 0.4:     # most sheets fit on one page
        page_qs = [order]
    for p, qs in enumerate(page_qs):
        tint = np.array(rng.choice([(246, 243, 232), (240, 240, 238), (250, 246, 236), (236, 232, 220)]), np.float32)
        sheet = np.ones((sheet_h, sheet_w, 3), np.float32) * tint
        ink = Ink(sheet)
        top = gap * 2
        for yy in range(top, sheet_h - gap // 2, gap):
            ink.blend(poly_alpha([np.array([[0, yy], [sheet_w, yy + rng.uniform(-2, 2)]])], 2, (sheet_w, sheet_h)), 0, 0, (90, 110, 200), 0.7)
        mx = int(sheet_w * rng.uniform(0.1, 0.14))
        mcol = (200, 70, 90) if margin_style == 'red' else (80, 100, 200)
        for dx in ([0, 7] if margin_style == 'double' else [0]):
            ink.blend(poly_alpha([np.array([[mx + dx, 0], [mx + dx + rng.uniform(-4, 4), sheet_h]])], 2, (sheet_w, sheet_h)), 0, 0, mcol, 0.85)
        if p == 0:   # the teacher's total and signature at the top
            na = number_alpha(digits, str(int(sum(q['got'] for q in questions))), gap * 0.75, rng)
            tx, ty = int(sheet_w * rng.uniform(0.55, 0.7)), int(gap * 0.4)
            ink.blend(na, tx, ty, red)
            ring = poly_alpha([cv2.ellipse2Poly((tx + na.shape[1] // 2, ty + na.shape[0] // 2), (na.shape[1] // 2 + 22, na.shape[0] // 2 + 18), 0, -30, 320, 8).astype(np.float32)], 3, (sheet_w, sheet_h))
            ink.blend(ring, 0, 0, red)
            sig = [wobbly([(tx + 260, ty + 40), (tx + 300, ty), (tx + 320, ty + 50), (tx + 360, ty + 10), (tx + 400, ty + 40)], rng, 30, 4)]
            ink.blend(poly_alpha(sig, 3, (sheet_w, sheet_h)), 0, 0, red)
        line = 0
        tp = []
        for q in qs:
            if q['q'] == n_a + 1:   # the section heading
                line += 1
                a = text_alpha(font, 'Section - B')
                ink.blend(a, sheet_w // 2 - a.shape[1] // 2, top + line * gap - a.shape[0] + 4, pen)
                line += 1
            y = top + line * gap          # baseline of the answer's first line
            # the question number left of the margin
            lab = {'dot': f'{q["q"]}.', 'paren': f'{q["q"]})', 'Q': f'Q{q["q"]}', 'circle': f'{q["q"]}'}[label_style]
            a = text_alpha(font, lab)
            lx = max(4, mx - a.shape[1] - rng.randint(8, 30))
            ink.blend(a, lx, y - a.shape[0] + 6, pen)
            if label_style == 'circle':
                ring = poly_alpha([cv2.ellipse2Poly((lx + a.shape[1] // 2, y - a.shape[0] // 2 + 6), (a.shape[1] // 2 + 6, a.shape[0] // 2 + 2), 0, 0, 360, 10).astype(np.float32)], 2, (sheet_w, sheet_h))
                ink.blend(ring, 0, 0, pen)
            # the answer, one or two lines
            n_lines = 1 if q['max'] == 1 else rng.randint(2, 3)
            ends = []
            for k in range(n_lines):
                words = ' '.join(rng.sample(WORDS, rng.randint(2, 5) if q['max'] == 1 else rng.randint(4, 8)))
                a = text_alpha(font, ('(' + rng.choice('ABCD') + ') ' if k == 0 and q['max'] == 1 else '') + words)
                ax = mx + rng.randint(12, 30)
                a = a[:, :max(10, min(a.shape[1], sheet_w - ax - 220))]
                ink.blend(a, ax, y + k * gap - a.shape[0] + 6, pen)
                ends.append((ax + a.shape[1], y + k * gap))
            # the teacher's mark
            ex, ey = ends[-1] if q['max'] == 1 else ends[0]
            mark = None
            if q['q'] == forgot:
                mark = 'none'
            elif q['max'] == 1:
                size = gap * rng.uniform(0.9, 1.7)
                if q['got'] == 1:
                    cx = ex + rng.randint(-int(size * 0.6), 20)
                    ink.blend(poly_alpha(tick_paths(cx, ey + rng.uniform(-6, 12), size, rng), rng.randint(2, 4), (sheet_w, sheet_h)), 0, 0, red)
                    mark = 'tick'
                else:
                    ink.blend(poly_alpha(cross_paths(ex + rng.randint(-10, 30), ey - gap * 0.3, gap * rng.uniform(0.55, 0.9), rng), rng.randint(2, 4), (sheet_w, sheet_h)), 0, 0, red)
                    mark = 'cross'
            else:
                g = q['got']
                txt = fmt_num(g)
                na = number_alpha(digits, str(int(g)) if g >= 1 or g == 0 else '0', gap * rng.uniform(0.6, 0.8), rng) if True else None
                if g % 1:
                    half = text_alpha(ImageFont.truetype(rng.choice(fonts), int(gap * 0.4)), '½')
                    if g < 1:
                        na = half
                    else:
                        comb = np.zeros((max(na.shape[0], half.shape[0]), na.shape[1] + half.shape[1] + 4), np.float32)
                        comb[comb.shape[0] - na.shape[0]:, :na.shape[1]] = na
                        comb[:half.shape[0], na.shape[1] + 4:] = half
                        na = comb
                side = rng.choice(['left', 'right'])
                nx = (mx - na.shape[1] - rng.randint(12, 30)) if side == 'left' and label_style != 'Q' else (sheet_w - na.shape[1] - rng.randint(40, 120))
                ny = y - na.shape[0] + gap + 4 if side == 'left' else y - na.shape[0] + 8
                if side == 'left':
                    ny = y + gap // 2   # in the margin, under the question number
                ink.blend(na, nx, ny, red)
                mark = 'number'
                if g < q['max'] and rng.random() < 0.6:   # a ring round a wrong word, or an underline
                    wx, wy = ends[0][0] - rng.randint(60, 200), ends[0][1] - gap // 3
                    ring = poly_alpha([cv2.ellipse2Poly((wx, wy), (rng.randint(40, 80), int(gap * 0.4)), rng.randint(-10, 10), 0, 340, 12).astype(np.float32)], 3, (sheet_w, sheet_h))
                    ink.blend(ring, 0, 0, red)
                if g == q['max'] and rng.random() < 0.5:   # and a tick for a full answer
                    ink.blend(poly_alpha(tick_paths(ends[-1][0] - 40, ends[-1][1], gap * 1.2, rng), 3, (sheet_w, sheet_h)), 0, 0, red)
            tp.append({'q': q['q'], 'mark': mark})
            line += n_lines + (1 if rng.random() < 0.35 else 0)   # some students leave a line between answers
        # the section A subtotal in the margin, on the page where section A ends
        if any(q['q'] == n_a for q in qs) and (forgot or rng.random() < 0.6):
            na = number_alpha(digits, str(int(sub_a)), gap * 1.4, rng)
            yq = top + gap * max(1, (len([q for q in qs if q['sec'] == 'A']) // 2))
            ink.blend(na, rng.randint(4, 14), yq, red)
            tp.append({'subtotal': sub_a})
        # ink showing through from the back of the page
        for _ in range(rng.randint(0, 4)):
            bx, by = rng.randint(mx + 100, sheet_w - 100), rng.randint(100, sheet_h - 100)
            ink.blend(poly_alpha(tick_paths(bx, by, gap * 0.6, rng), 2, (sheet_w, sheet_h)), 0, 0, red, 0.18)
        img = photo(ink.img, rng, idx * 10 + p)
        name = f'sheet-{idx:02d}-p{p + 1}.jpg'
        cv2.imwrite(os.path.join(out_dir, name), cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, rng.randint(78, 92)])
        pages.append(name); truth_pages.append(tp)
    return {'sheet': idx, 'pages': pages, 'paper': '\n'.join(paper),
            'questions': [{'q': q['q'], 'max': q['max'], 'got': q['got']} for q in questions], 'forgot': forgot,
            'total': sum(q['got'] for q in questions), 'style': {'margin': margin_style, 'labels': label_style}, 'marks': truth_pages}


def fmt_num(v):
    return str(int(v)) + ('½' if v % 1 else '') if v >= 1 else ('½' if v else '0')


def photo(sheet, rng, seed):
    page = np.zeros((H, W, 3), np.float32)
    page[:] = np.array(rng.choice([(120, 92, 70), (95, 95, 100), (150, 120, 90), (60, 55, 50)]), np.float32)
    sh, sw = sheet.shape[:2]
    M = cv2.getRotationMatrix2D((sw / 2, sh / 2), rng.uniform(-2.5, 2.5), 1.0)
    M[0, 2] += (W - sw) / 2 + rng.uniform(-15, 15)
    M[1, 2] += (H - sh) / 2 + rng.uniform(-10, 10)
    warped = cv2.warpAffine(sheet, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(-1, -1, -1))
    # a gentle bend, as when the notebook does not lie flat
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    bend = rng.uniform(-14, 14) * np.sin(yy / H * math.pi)
    warped = cv2.remap(warped, xx + bend, yy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(-1, -1, -1))
    m = (warped[..., 0] >= 0)[..., None]
    page = np.where(m, warped, page)
    shade = 1 - rng.uniform(0.05, 0.3) * np.clip((xx / W) * rng.choice([1, -1]) + rng.uniform(-0.2, 0.4), 0, 1)
    vig = 1 - 0.18 * (((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2) * 2
    cast = np.array([1.0, rng.uniform(0.92, 1.0), rng.uniform(0.78, 0.97)], np.float32)
    page = page * (shade * vig)[..., None] * cast
    page = cv2.GaussianBlur(page, (0, 0), rng.uniform(0.5, 1.1))
    page = page + np.random.default_rng(seed).normal(0, rng.uniform(2, 5), page.shape)
    return np.clip(page, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mnist', required=True)
    ap.add_argument('--fonts', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sheets', type=int, default=24)
    ap.add_argument('--seed', type=int, default=11)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    te_x = read_idx(os.path.join(a.mnist, 't10k-images-idx3-ubyte.gz'))
    te_y = read_idx(os.path.join(a.mnist, 't10k-labels-idx1-ubyte.gz'))
    digits = {d: te_x[te_y == d] for d in range(10)}
    fonts = sorted(os.path.join(a.fonts, f) for f in os.listdir(a.fonts) if f.endswith('.ttf'))
    rng = random.Random(a.seed)
    truth = [make_sheet(i, rng, digits, fonts, a.out) for i in range(a.sheets)]
    with open(os.path.join(a.out, 'truth.json'), 'w') as f:
        json.dump(truth, f, indent=1)
    print('wrote', sum(len(t['pages']) for t in truth), 'pages of', len(truth), 'sheets to', a.out)


if __name__ == '__main__':
    main()
