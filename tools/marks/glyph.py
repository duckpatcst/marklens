"""Glyph normalisation shared by training and by js/redmarks.js (normalizeGlyph).

A teacher's red mark is cut out of the photo as a binary mask, one character at a time.
Before the digit model sees it, the mask is turned into a 28x28 picture in the same way
the MNIST digits were made, and the pen thickness is evened out:

  1. crop to the ink
  2. thicken thin strokes / thin heavy strokes so they come out about 2.6 px wide at 28x28
  3. shrink (area averaging) so the longer side is 20 px
  4. place it so the centre of mass sits at the middle of a 28x28 grid

The JavaScript port must give the same numbers (tests/redmarks.test.mjs checks this),
so every rounding step here uses floor(x + 0.5), never Python's round().
"""
import numpy as np

TARGET = 2.6          # stroke width wanted at 28x28 scale
BOX = 20              # longer side of the glyph after scaling
SIZE = 28


def rnd(x):
    return int(np.floor(x + 0.5))


def crop(mask):
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return mask[:0, :0]
    return mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def dilate(mask):
    """3x3 square dilation, the image grows by one pixel on each side."""
    h, w = mask.shape
    out = np.zeros((h + 2, w + 2), bool)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            out[1 + dy:h + 1 + dy, 1 + dx:w + 1 + dx] |= mask
    return out


def erode(mask):
    """3x3 square erosion, same size as the input."""
    h, w = mask.shape
    p = np.zeros((h + 2, w + 2), bool)
    p[1:-1, 1:-1] = mask
    out = np.ones((h, w), bool)
    for dy in (0, 1, 2):
        for dx in (0, 1, 2):
            out &= p[dy:dy + h, dx:dx + w]
    return out


def stroke_width(mask):
    area = int(mask.sum())
    if area == 0:
        return 0.0
    h, w = mask.shape
    p = np.zeros((h + 2, w + 2), bool)
    p[1:-1, 1:-1] = mask
    inner = mask & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    boundary = area - int(inner.sum())
    return 2.0 * area / max(boundary, 1)


def even_strokes(mask):
    """Bring the pen width to about TARGET pixels after scaling."""
    mask = crop(mask)
    h, w = mask.shape
    if h == 0:
        return mask
    s = BOX / max(h, w)
    t = stroke_width(mask)
    if t * s < 1.8:
        n = min(4, int(np.ceil((TARGET / s - t) / 2)))
        for _ in range(max(0, n)):
            mask = dilate(mask)
    elif t * s > 3.8:
        n = min(2, int(np.floor((t - TARGET / s) / 2)))
        for _ in range(max(0, n)):
            e = erode(mask)
            if e.sum() < 0.45 * mask.sum():
                break
            mask = e
        mask = crop(mask)
    return mask


def weights(n_out, n_in):
    W = np.zeros((n_out, n_in), np.float64)
    scale = n_in / n_out
    for i in range(n_out):
        a, b = i * scale, (i + 1) * scale
        j0, j1 = int(np.floor(a)), int(np.ceil(b))
        for j in range(j0, min(j1, n_in)):
            W[i, j] = max(0.0, min(b, j + 1) - max(a, j))
        W[i] /= scale
    return W


def normalize(mask):
    """Binary mask (any size) -> float32 28x28 in [0, 1], MNIST style."""
    mask = even_strokes(np.asarray(mask, bool))
    h, w = mask.shape
    out = np.zeros((SIZE, SIZE), np.float32)
    if h == 0:
        return out
    s = BOX / max(h, w)
    nh, nw = max(1, rnd(h * s)), max(1, rnd(w * s))
    g = weights(nh, h) @ mask.astype(np.float64) @ weights(nw, w).T
    tot = g.sum()
    if tot <= 0:
        return out
    cy = (g.sum(1) * np.arange(nh)).sum() / tot
    cx = (g.sum(0) * np.arange(nw)).sum() / tot
    oy = min(max(int(np.floor(14 - cy)), 0), SIZE - nh)
    ox = min(max(int(np.floor(14 - cx)), 0), SIZE - nw)
    out[oy:oy + nh, ox:ox + nw] = np.clip(g, 0, 1)
    return out
