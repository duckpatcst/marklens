"""Train the red-mark digit model used by the on-phone reader (models/digits-v1.json).

What it learns: the 10 digits a teacher writes in the margin, plus an 11th class "other"
for ticks, crosses, question marks, letters and scribbles, so those are never read as marks.

Data
  * MNIST (70,000 handwritten digits). Get the four .gz files from any MNIST mirror and pass
    the folder with --mnist.
  * Optional handwriting fonts (.ttf, --fonts) add more writing styles and the letters for "other".
Every sample goes through glyph.normalize(), the same steps the website runs on a cut-out
red mark, after random pen, slant and size changes, so the model sees what the phone sees.

    pip install "jax[cpu]" optax numpy scipy pillow opencv-python-headless
    python train.py --mnist ./mnist --fonts ./fonts --out ../../models/digits-v1.json
"""
import argparse, gzip, json, base64, os, sys, time, math
from multiprocessing import Pool
import numpy as np
from scipy import ndimage
import cv2
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from glyph import normalize, crop  # noqa: E402

OTHER = 10
CLASSES = [str(d) for d in range(10)] + ['other']
LETTERS = 'cefhkmnprtuvwxACEFHKMNPRUVWXY?!+=#&@%'


# ---------------------------------------------------------------- data

def read_idx(path):
    with gzip.open(path, 'rb') as f:
        data = f.read()
    magic = int.from_bytes(data[:4], 'big')
    dims = magic & 0xff
    shape = [int.from_bytes(data[4 + 4 * i: 8 + 4 * i], 'big') for i in range(dims)]
    return np.frombuffer(data, np.uint8, offset=4 + 4 * dims).reshape(shape)


def load_mnist(folder):
    tr_x = read_idx(os.path.join(folder, 'train-images-idx3-ubyte.gz'))
    tr_y = read_idx(os.path.join(folder, 'train-labels-idx1-ubyte.gz'))
    te_x = read_idx(os.path.join(folder, 't10k-images-idx3-ubyte.gz'))
    te_y = read_idx(os.path.join(folder, 't10k-labels-idx1-ubyte.gz'))
    return tr_x, tr_y, te_x, te_y


def mnist_mask(img, rng):
    """28x28 grey MNIST digit -> binary mask at 2-3x, like a pen stroke in a photo."""
    z = rng.uniform(1.6, 3.0)
    big = ndimage.zoom(img.astype(np.float32) / 255.0, z, order=1)
    return big > rng.uniform(0.35, 0.6)


def font_mask(font_path, ch, rng, size=None):
    size = size or int(rng.integers(40, 72))
    try:
        font = ImageFont.truetype(font_path, size)
    except OSError:
        return None
    im = Image.new('L', (size * 3, size * 3), 0)
    ImageDraw.Draw(im).text((size // 2, size // 3), ch, fill=255, font=font)
    m = np.array(im) > 127
    return crop(m) if m.any() else None


def stroke_canvas(n=72):
    return np.zeros((n, n), np.uint8)


def draw_poly(img, pts, t):
    pts = np.round(np.array(pts)).astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(img, [pts], False, 255, int(t), cv2.LINE_AA)


def bezier(p0, p1, p2, p3, n=24):
    t = np.linspace(0, 1, n)[:, None]
    return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3


def other_mask(rng, fonts):
    """Something a teacher writes in red that is not a digit."""
    kind = rng.choice(['tick', 'tick', 'tick', 'cross', 'letter', 'letter', 'squiggle', 'question', 'star'])
    img = stroke_canvas()
    t = rng.integers(2, 6)
    if kind == 'tick':
        x0, y0 = rng.uniform(6, 20), rng.uniform(25, 45)
        a1 = math.radians(rng.uniform(25, 70)); l1 = rng.uniform(8, 22)
        x1, y1 = x0 + l1 * math.cos(a1), y0 + l1 * math.sin(a1)
        a2 = math.radians(rng.uniform(35, 75)); l2 = rng.uniform(25, 55)
        x2, y2 = x1 + l2 * math.cos(a2), y1 - l2 * math.sin(a2)
        if rng.random() < 0.5:
            mid = np.array([(x1 + x2) / 2 + rng.uniform(-4, 4), (y1 + y2) / 2 + rng.uniform(-4, 4)])
            pts = np.vstack([[x0, y0], bezier(np.array([x1, y1]), mid, mid, np.array([x2, y2]))])
        else:
            pts = [[x0, y0], [x1, y1], [x2, y2]]
        draw_poly(img, pts, t)
    elif kind == 'cross':
        c = np.array([36, 36]); L = rng.uniform(12, 26)
        for base in (45, 135):
            a = math.radians(base + rng.uniform(-15, 15))
            d = np.array([math.cos(a), math.sin(a)]) * L
            draw_poly(img, [c - d, c + d], t)
    elif kind == 'squiggle':
        # a curve that clearly bends, so it never looks like a "1"
        for _ in range(20):
            p = [np.array([rng.uniform(5, 67), rng.uniform(5, 67)]) for _ in range(4)]
            pts = bezier(*p)
            chord = pts[-1] - pts[0]; L = np.linalg.norm(chord) + 1e-6
            v = pts - pts[0]
            dev = np.abs((chord[0] * v[:, 1] - chord[1] * v[:, 0]) / L).max()
            if dev > 0.35 * L and L > 20:
                break
        draw_poly(img, pts, t)
        if rng.random() < 0.4:
            q = [np.array([rng.uniform(5, 67), rng.uniform(5, 67)]) for _ in range(4)]
            draw_poly(img, bezier(*q), t)
    elif kind == 'star':
        c = np.array([36, 36]); L = rng.uniform(12, 24)
        for k in range(int(rng.integers(3, 6))):
            a = math.radians(k * 180 / 3 + rng.uniform(-10, 10))
            d = np.array([math.cos(a), math.sin(a)]) * L
            draw_poly(img, [c - d, c + d], t)
    else:
        ch = '?' if kind == 'question' else str(rng.choice(list(LETTERS)))
        if fonts:
            m = font_mask(str(rng.choice(fonts)), ch, rng)
            if m is not None and m.sum() > 20:
                return m
        cv2.putText(img, ch, (12, 56), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, rng.uniform(1.4, 2.0), 255, int(t), cv2.LINE_AA)
    m = img > 127
    return crop(m) if m.any() else None


def augment(mask, rng):
    """Random pen, slant, rotation and broken strokes, as in phone photos of red ink."""
    m = mask.astype(np.float32)
    h, w = m.shape
    pad = int(max(h, w) * 0.5) + 4
    m = np.pad(m, pad)
    ang = math.radians(rng.uniform(-14, 14))
    sh = rng.uniform(-0.35, 0.35)
    sx, sy = rng.uniform(0.75, 1.25), rng.uniform(0.85, 1.15)
    A = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]]) @ np.array([[sy, 0], [sh, sx]])
    c = np.array(m.shape) / 2
    inv = np.linalg.inv(A)
    m = ndimage.affine_transform(m, inv, offset=c - inv @ c, order=1)
    if rng.random() < 0.25:   # elastic wobble
        dy = ndimage.gaussian_filter(rng.uniform(-1, 1, m.shape), 4) * rng.uniform(2, 6)
        dx = ndimage.gaussian_filter(rng.uniform(-1, 1, m.shape), 4) * rng.uniform(2, 6)
        yy, xx = np.meshgrid(np.arange(m.shape[0]), np.arange(m.shape[1]), indexing='ij')
        m = ndimage.map_coordinates(m, [yy + dy, xx + dx], order=1)
    b = m > 0.5
    r = rng.random()
    if r < 0.2:
        b = ndimage.binary_dilation(b, iterations=int(rng.integers(1, 3)))
    elif r < 0.35:
        e = ndimage.binary_erosion(b)
        if e.sum() > 0.5 * b.sum():
            b = e
    if rng.random() < 0.15:   # faint ink: little gaps in the stroke
        holes = rng.random(b.shape) < 0.015
        b = b & ~ndimage.binary_dilation(holes, iterations=1)
    return crop(b)


def make(args):
    kind, payload, seed, aug = args
    rng = np.random.default_rng(seed)
    if kind == 'mnist':
        m = mnist_mask(payload, rng)
    elif kind == 'font':
        m = font_mask(payload[0], payload[1], rng)
    else:
        m = other_mask(rng, payload)
    if m is None or m.sum() < 8:
        return None
    if aug:
        m = augment(m, rng)
        if m.size == 0 or m.sum() < 8:
            return None
    return (normalize(m) * 255 + 0.5).astype(np.uint8)


def build(jobs, labels, workers):
    with Pool(workers) as pool:
        out = pool.map(make, jobs, chunksize=256)
    keep = [i for i, o in enumerate(out) if o is not None]
    X = np.stack([out[i] for i in keep])
    y = np.array([labels[i] for i in keep], np.int32)
    return X, y


# ---------------------------------------------------------------- model

def init_params(key):
    import jax, jax.numpy as jnp
    k = jax.random.split(key, 4)
    he = lambda kk, shape, fan: jax.random.normal(kk, shape) * jnp.sqrt(2.0 / fan)
    return {
        'c1w': he(k[0], (3, 3, 1, 16), 9), 'c1b': jnp.zeros(16),
        'c2w': he(k[1], (3, 3, 16, 32), 144), 'c2b': jnp.zeros(32),
        'd1w': he(k[2], (800, 64), 800), 'd1b': jnp.zeros(64),
        'd2w': he(k[3], (64, 11), 64), 'd2b': jnp.zeros(11),
    }


def forward(p, x, train=False, key=None):
    """x: (N, 28, 28) in [0, 1]. Layout NHWC, kernels HWIO, flatten order H, W, C."""
    import jax, jax.numpy as jnp
    from jax import lax
    dn = ('NHWC', 'HWIO', 'NHWC')
    h = x[..., None]
    h = lax.conv_general_dilated(h, p['c1w'], (1, 1), 'VALID', dimension_numbers=dn) + p['c1b']
    h = jax.nn.relu(h)                                                    # 26x26x16
    h = lax.reduce_window(h, -jnp.inf, lax.max, (1, 2, 2, 1), (1, 2, 2, 1), 'VALID')   # 13x13
    h = lax.conv_general_dilated(h, p['c2w'], (1, 1), 'VALID', dimension_numbers=dn) + p['c2b']
    h = jax.nn.relu(h)                                                    # 11x11x32
    h = lax.reduce_window(h, -jnp.inf, lax.max, (1, 2, 2, 1), (1, 2, 2, 1), 'VALID')   # 5x5
    h = h.reshape(h.shape[0], -1)                                         # 800
    h = jax.nn.relu(h @ p['d1w'] + p['d1b'])
    if train:
        keep = jax.random.bernoulli(key, 0.75, h.shape)
        h = jnp.where(keep, h / 0.75, 0)
    return h @ p['d2w'] + p['d2b']


def train(X, y, Xv, yv, epochs, seed=0):
    import jax, jax.numpy as jnp, optax
    key = jax.random.PRNGKey(seed)
    params = init_params(key)
    steps = epochs * (len(X) // 256)
    sched = optax.warmup_cosine_decay_schedule(0, 2e-3, 300, steps, 2e-5)
    opt = optax.adamw(sched, weight_decay=1e-4)
    state = opt.init(params)
    # "other" is easier to over-predict than a real digit: weight digits a little more
    cw = jnp.array([1.0] * 10 + [0.7])

    def loss_fn(p, xb, yb, k):
        logits = forward(p, xb, True, k)
        ls = optax.softmax_cross_entropy_with_integer_labels(logits, yb)
        return (ls * cw[yb]).mean()

    @jax.jit
    def step(p, s, xb, yb, k):
        l, g = jax.value_and_grad(loss_fn)(p, xb, yb, k)
        u, s = opt.update(g, s, p)
        return optax.apply_updates(p, u), s, l

    pred = jax.jit(lambda p, xb: jnp.argmax(forward(p, xb), -1))
    rng = np.random.default_rng(seed)
    for ep in range(epochs):
        t0 = time.time(); idx = rng.permutation(len(X)); tot = 0
        for i in range(0, len(X) - 255, 256):
            b = idx[i:i + 256]
            key, k = jax.random.split(key)
            xb = jnp.asarray(X[b], jnp.float32) / 255.0
            # random shift by up to 1 px, cheap extra robustness
            sh = rng.integers(-1, 2, 2)
            xb = jnp.roll(xb, tuple(int(v) for v in sh), axis=(1, 2))
            params, state, l = step(params, state, xb, jnp.asarray(y[b]), k)
            tot += float(l)
        acc = evaluate(pred, params, Xv, yv)
        print(f'epoch {ep + 1}/{epochs} loss {tot / (len(X) // 256):.4f} val acc {acc:.4f} ({time.time() - t0:.0f}s)', flush=True)
    return params, pred


def evaluate(pred, params, X, y):
    import jax.numpy as jnp
    hits = 0
    for i in range(0, len(X), 2000):
        p = np.asarray(pred(params, jnp.asarray(X[i:i + 2000], jnp.float32) / 255.0))
        hits += int((p == y[i:i + 2000]).sum())
    return hits / len(X)


# ---------------------------------------------------------------- export

def quant(a):
    a = np.asarray(a, np.float32)
    scale = float(np.abs(a).max()) / 127 or 1.0
    q = np.clip(np.round(a / scale), -127, 127).astype(np.int8)
    return {'shape': list(a.shape), 'scale': scale, 'data': base64.b64encode(q.tobytes()).decode()}


def dequant(t):
    return np.frombuffer(base64.b64decode(t['data']), np.int8).astype(np.float32).reshape(t['shape']) * t['scale']


def export(params, path, meta):
    model = {
        'name': 'marklens-red-digits', 'version': 1, 'classes': CLASSES,
        'input': '28x28 floats in [0,1], ink = 1, normalised by glyph.normalize / RedPen.normalizeGlyph',
        'layers': 'conv3x3(1->16) relu maxpool2 conv3x3(16->32) relu maxpool2 flatten(HWC) dense(800->64) relu dense(64->11)',
        'layout': 'conv kernels HWIO, dense [in][out], int8 with one scale per tensor',
        'meta': meta,
        'weights': {k: quant(v) for k, v in params.items()},
    }
    with open(path, 'w') as f:
        json.dump(model, f, separators=(',', ':'))
    return {k: dequant(v) for k, v in model['weights'].items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mnist', required=True)
    ap.add_argument('--fonts', default='')
    ap.add_argument('--out', required=True)
    ap.add_argument('--epochs', type=int, default=10)
    ap.add_argument('--aug', type=int, default=3, help='augmented copies of each MNIST training digit')
    ap.add_argument('--workers', type=int, default=os.cpu_count() or 2)
    ap.add_argument('--holdout-fonts', default='ShadowsIntoLight,HomemadeApple,ReenieBeanie,NanumPenScript')
    ap.add_argument('--vectors', default='', help='write parity test vectors here')
    a = ap.parse_args()

    tr_x, tr_y, te_x, te_y = load_mnist(a.mnist)
    fonts = sorted(os.path.join(a.fonts, f) for f in os.listdir(a.fonts) if f.endswith('.ttf')) if a.fonts else []
    hold = [f for f in fonts if any(h in f for h in a.holdout_fonts.split(','))]
    train_fonts = [f for f in fonts if f not in hold]
    print(f'MNIST {len(tr_x)} train / {len(te_x)} test; fonts train {len(train_fonts)} held out {len(hold)}', flush=True)

    jobs, labels, seed = [], [], 1
    for rep in range(a.aug):
        for i in range(len(tr_x)):
            jobs.append(('mnist', tr_x[i], seed, rep > 0)); labels.append(int(tr_y[i])); seed += 1
    for f in train_fonts:
        for d in range(10):
            for _ in range(160):
                jobs.append(('font', (f, str(d)), seed, True)); labels.append(d); seed += 1
    n_other = int(len(jobs) * 0.14)
    for _ in range(n_other):
        jobs.append(('other', train_fonts, seed, True)); labels.append(OTHER); seed += 1
    t0 = time.time()
    X, y = build(jobs, labels, a.workers)
    print(f'train set {X.shape} built in {time.time() - t0:.0f}s; class counts {np.bincount(y).tolist()}', flush=True)

    vjobs = [('mnist', te_x[i], 10_000_000 + i, False) for i in range(len(te_x))]
    Xv, yv = build(vjobs, [int(v) for v in te_y], a.workers)
    ajobs = [('mnist', te_x[i], 20_000_000 + i, True) for i in range(len(te_x))]
    Xa, ya = build(ajobs, [int(v) for v in te_y], a.workers)
    hjobs, hl = [], []
    for f in hold:
        for d in range(10):
            for k in range(60):
                hjobs.append(('font', (f, str(d)), 30_000_000 + len(hjobs), True)); hl.append(d)
    for k in range(3000):
        hjobs.append(('other', hold, 40_000_000 + k, True)); hl.append(OTHER)
    Xh, yh = build(hjobs, hl, a.workers)

    params, pred = train(X, y, Xv, yv, a.epochs)
    q = export(params, a.out, {})
    meta = {
        'mnist_test_acc': evaluate(pred, q, Xv, yv),
        'mnist_test_augmented_acc': evaluate(pred, q, Xa, ya),
        'heldout_fonts_and_other_acc': evaluate(pred, q, Xh, yh),
        'train_samples': int(len(X)),
    }
    import jax.numpy as jnp
    ph = np.asarray(pred(q, jnp.asarray(Xh, jnp.float32) / 255.0))
    conf = np.zeros((11, 11), int)
    for t_, p_ in zip(yh, ph):
        conf[t_, p_] += 1
    meta['heldout_other_recall'] = float(conf[10, 10] / max(1, conf[10].sum()))
    meta['heldout_digits_called_other'] = float(conf[:10, 10].sum() / max(1, conf[:10].sum()))
    print('quantised model:', json.dumps(meta), flush=True)
    print('held-out confusion (rows true, cols predicted):\n', conf, flush=True)
    export(params, a.out, meta)
    print('wrote', a.out, os.path.getsize(a.out), 'bytes')

    if a.vectors:
        # raw masks + expected normalised input + expected logits, for the JS parity test
        rng = np.random.default_rng(7)
        vec = []
        for i in range(40):
            j = int(rng.integers(len(te_x)))
            m = augment(mnist_mask(te_x[j], rng), rng)
            from glyph import normalize as nz
            g = nz(m)
            logits = np.asarray(forward(q, jnp.asarray(g[None], jnp.float32)))[0]
            vec.append({'h': int(m.shape[0]), 'w': int(m.shape[1]),
                        'mask': base64.b64encode(np.packbits(m.astype(np.uint8)).tobytes()).decode(),
                        'glyph': base64.b64encode(g.astype(np.float32).tobytes()).decode(),
                        'logits': [float(v) for v in logits], 'label': int(te_y[j])})
        with open(a.vectors, 'w') as f:
            json.dump(vec, f)
        print('wrote', a.vectors)


if __name__ == '__main__':
    main()
