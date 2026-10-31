// Aurora runtime: slide player, manim-style animation engine, scene renderer.
(() => {
  const DATA = JSON.parse(document.getElementById('aurora-data').textContent);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const U = 100; // px per scene unit

  // ---------------------------------------------------------------- rate functions (manim)
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const smooth = (t) => { const e = sigmoid(-5); return clamp01((sigmoid(10 * (t - 0.5)) - e) / (1 - 2 * e)); };
  const linear = (t) => t;
  const thereAndBack = (t) => smooth(t < 0.5 ? 2 * t : 2 - 2 * t);

  // ---------------------------------------------------------------- engine
  // An animation is { dur, rate?, begin?(), tick(alpha), end?() }.
  const engine = {
    running: [],
    raf: 0,
    play(a, at = 0) {
      a.t0 = performance.now() + at * 1000;
      a.started = false;
      this.running.push(a);
      if (!this.raf) this.raf = requestAnimationFrame(this.frame);
    },
    frame: (now) => {
      engine.raf = 0;
      const still = [];
      for (const a of engine.running) {
        const t = (now - a.t0) / 1000;
        if (t < 0) { still.push(a); continue; }
        if (!a.started) { a.started = true; a.begin?.(); }
        const p = a.dur > 0 ? clamp01(t / a.dur) : 1;
        a.tick((a.rate || smooth)(p));
        if (p < 1) still.push(a); else a.end?.();
      }
      engine.running = still;
      if (still.length) engine.raf = requestAnimationFrame(engine.frame);
    },
    busy() { return this.running.length > 0; },
    finishAll() {
      const list = this.running;
      this.running = [];
      for (const a of list) { if (!a.started) a.begin?.(); a.tick(1); a.end?.(); }
    },
    cancelAll() { this.running = []; },
  };

  const runNow = (a) => { a.begin?.(); a.tick(1); a.end?.(); };

  /** Spreads n sub-animations over [0,1] with manim's lag_ratio semantics. */
  function lagged(n, lag, a, fn) {
    const s = 1 / (1 + Math.max(0, n - 1) * lag);
    for (let i = 0; i < n; i++) fn(i, clamp01((a - i * lag * s) / s));
  }

  function lengthOf(n) {
    try { const l = n.getTotalLength(); if (l > 0) return l; } catch {}
    const b = n.getBBox?.();
    return b ? 2 * (b.width + b.height) : 100;
  }

  // ---------------------------------------------------------------- animations
  const reveal = (el) => el.classList.remove('hidden-step', 'covered-step');

  function fadeIn(el, { dur = 0.7, shift = 16 } = {}) {
    return {
      dur,
      begin() { reveal(el); el.style.opacity = 0; },
      tick(a) { el.style.opacity = a; if (shift) el.style.transform = `translateY(${(1 - a) * shift}px)`; },
      end() { el.style.opacity = ''; el.style.transform = ''; },
    };
  }

  function fadeOut(el, { dur = 0.5 } = {}) {
    return {
      dur,
      tick(a) { el.style.opacity = 1 - a; },
      end() { el.classList.add('hidden-step'); el.style.opacity = ''; },
    };
  }

  /** Create / DrawBorderThenFill on every stroked geometry node in `nodes`. */
  function create(el, nodes, { dur = 1, lag = 0 } = {}) {
    return {
      dur,
      begin() {
        reveal(el);
        for (const n of nodes) {
          n._len = lengthOf(n) + 1;
          n._fo = n.dataset.fill ?? null;
          n.style.strokeDasharray = n._len;
          n.style.strokeDashoffset = n._len;
          if (n._fo !== null) n.style.fillOpacity = 0;
        }
      },
      tick(a) {
        lagged(nodes.length, lag, a, (i, s) => {
          const n = nodes[i];
          const filled = n._fo !== null;
          const draw = filled ? clamp01(s * 2) : s;
          n.style.strokeDashoffset = n._len * (1 - draw);
          if (filled) n.style.fillOpacity = n._fo * clamp01(2 * s - 1);
        });
      },
      end() {
        for (const n of nodes) {
          n.style.strokeDasharray = n.dataset.dash ?? '';
          n.style.strokeDashoffset = '';
          if (n._fo !== null) n.style.fillOpacity = n._fo;
        }
      },
    };
  }

  /** manim Write: per-glyph outline draw, then fill, lagged across glyphs. */
  function write(el, { dur, strokeWidth = 28 } = {}) {
    const nodes = [...el.querySelectorAll('path, rect')];
    const n = nodes.length;
    const lag = Math.min(4 / Math.max(1, n), 0.2);
    return {
      dur: dur ?? (n < 15 ? 1 : 2),
      rate: linear,
      begin() {
        reveal(el);
        for (const p of nodes) {
          p._len = lengthOf(p) + 1;
          Object.assign(p.style, { stroke: 'currentColor', strokeWidth, strokeDasharray: p._len, strokeDashoffset: p._len, fillOpacity: 0, strokeOpacity: 1 });
        }
      },
      tick(a) {
        lagged(n, lag, a, (i, s) => {
          const p = nodes[i];
          s = smooth(s);
          if (s < 0.5) { p.style.strokeDashoffset = p._len * (1 - 2 * s); p.style.fillOpacity = 0; }
          else { p.style.strokeDashoffset = 0; p.style.fillOpacity = 2 * s - 1; p.style.strokeOpacity = 2 - 2 * s; }
        });
      },
      end() { for (const p of nodes) p.removeAttribute('style'); },
    };
  }

  function grow(el, { dur = 0.6, origin = '50% 50%', axis = 'both', targets = [el], lag = 0 } = {}) {
    return {
      dur,
      begin() {
        reveal(el);
        for (const t of targets) { t.style.transformBox = 'fill-box'; t.style.transformOrigin = origin; }
      },
      tick(a) {
        lagged(targets.length, lag, a, (i, s) => {
          targets[i].style.transform = axis === 'y' ? `scaleY(${s})` : `scale(${s})`;
        });
      },
      end() { for (const t of targets) t.style.transform = ''; },
    };
  }

  function indicate(el, { dur = 1 } = {}) {
    return {
      dur,
      rate: linear,
      begin() { el.style.transformBox = 'fill-box'; el.style.transformOrigin = '50% 50%'; },
      tick(a) {
        const s = thereAndBack(a);
        el.style.transform = `scale(${1 + 0.2 * s})`;
        el.style.filter = s > 0.01 ? `drop-shadow(0 0 ${12 * s}px var(--yellow))` : '';
      },
      end() { el.style.transform = ''; el.style.filter = ''; },
    };
  }

  // ---------------------------------------------------------------- expressions
  function hash(i, seed) { const h = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return (h - Math.floor(h)) * 2 - 1; }
  const M = Math;
  const MATHS = {
    sin: M.sin, cos: M.cos, tan: M.tan, asin: M.asin, acos: M.acos, atan: M.atan, atan2: M.atan2,
    sinh: M.sinh, cosh: M.cosh, tanh: M.tanh, exp: M.exp, log: M.log, ln: M.log, log10: M.log10,
    sqrt: M.sqrt, abs: M.abs, floor: M.floor, ceil: M.ceil, round: M.round, min: M.min, max: M.max,
    pow: M.pow, sign: M.sign, PI: M.PI, pi: M.PI, E: M.E,
    sigmoid,
    clamp: (x, a, b) => M.min(b, M.max(a, x)),
    lerp: (a, b, t) => a + (b - a) * t,
    gauss: (x, mu = 0, s = 1) => M.exp(-((x - mu) ** 2) / (2 * s * s)),
    smoothstep: (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); },
    // Smooth 1-D value noise in [-1,1]; noise(x, seed). Handy for "stochastic" curves.
    noise: (x, seed = 0) => { const i = M.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u; },
  };
  const fnCache = new Map();
  function compile(expr, names) {
    const key = names.join(',') + '|' + expr;
    let f = fnCache.get(key);
    if (!f) {
      try { f = new Function(...names, `return (${String(expr).replace(/\^/g, '**')});`); }
      catch (e) { console.error(`[aurora] bad expression: ${expr}`, e); f = () => NaN; }
      fnCache.set(key, f);
    }
    return f;
  }
  function splitTop(s) {
    const out = []; let depth = 0, cur = '';
    for (const c of String(s)) {
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter((x) => x !== '');
  }

  function svgEl(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.appendChild(e);
    return e;
  }

  // ---------------------------------------------------------------- scene objects
  const RENDER = {
    Axes(sc, ob) {
      const P = ob.props;
      const [cx, cy] = sc.vec(P.at ?? '0,0');
      const w = sc.num(P.w ?? 6), h = sc.num(P.h ?? 4);
      const [x0, x1, xs = 0] = sc.vec(P.x ?? '0,10,1');
      const [y0, y1, ys = 0] = sc.vec(P.y ?? '-1,1,1');
      ob.geo = { x0, x1, y0, y1 };
      ob.map = (x, y) => [(cx + (x - x0) / (x1 - x0) * w - w / 2) * U, -(cy + (y - y0) / (y1 - y0) * h - h / 2) * U];
      if (ob.built) return;
      const color = P.color ?? 'var(--axis)', sw = P.width ?? 3;
      const xb = Math.min(Math.max(0, x0), x1), yb = Math.min(Math.max(0, y0), y1);
      const T = 12;
      const path = (d) => { const p = svgEl('path', { d, fill: 'none' }, ob.g); p.style.stroke = color; p.style.strokeWidth = sw; return p; };
      const [ax0, ay] = ob.map(x0, yb), [ax1] = ob.map(x1, yb);
      const [bx, by0] = ob.map(xb, y0), [, by1] = ob.map(xb, y1);
      const showX = P.only !== 'y', showY = P.only !== 'x';
      const nodes = [];
      if (showX) nodes.push(path(`M${ax0},${ay}H${ax1}`));
      if (showY) nodes.push(path(`M${bx},${by0}V${by1}`));
      let ticks = '';
      if (showX && xs > 0) for (let x = x0; x <= x1 + 1e-9; x += xs) { const [px, py] = ob.map(x, yb); ticks += `M${px},${py - T}V${py + T}`; }
      if (showY && ys > 0) for (let y = y0; y <= y1 + 1e-9; y += ys) { const [px, py] = ob.map(xb, y); ticks += `M${px - T},${py}H${px + T}`; }
      if (ticks) nodes.push(path(ticks));
      ob.strokes = nodes;
      ob.built = true;
    },

    Plot(sc, ob) {
      const P = ob.props;
      const ax = sc.objs[P.on];
      const map = ax ? ax.map : (x, y) => [x * U, -y * U];
      const [a, b] = P.domain ? sc.vec(P.domain) : ax ? [ax.geo.x0, ax.geo.x1] : [-5, 5];
      const n = Math.round(sc.num(P.samples ?? 400));
      const f = sc.fn(ob.text, ['x']);
      let d = '', pen = false, first = null, last = null;
      for (let i = 0; i <= n; i++) {
        const x = a + (b - a) * i / n;
        const y = f(x);
        if (!Number.isFinite(y)) { pen = false; continue; }
        const [px, py] = map(x, y);
        d += `${pen ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`;
        pen = true;
        first ??= px; last = px;
      }
      if (!ob.built) {
        if (P.fill) {
          ob.area = svgEl('path', { stroke: 'none' }, ob.g);
          ob.area.style.fill = P.color ?? 'var(--blue)';
          ob.area.style.fillOpacity = P.fill === true ? 0.2 : P.fill;
          ob.area.dataset.fade = '1';
        }
        ob.line = svgEl('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, ob.g);
        ob.line.style.stroke = P.color ?? 'var(--blue)';
        ob.line.style.strokeWidth = P.width ?? 5;
        ob.strokes = [ob.line];
        ob.built = true;
      }
      ob.line.setAttribute('d', d);
      if (ob.area && first !== null) {
        const base = ax ? Math.min(Math.max(0, ax.geo.y0), ax.geo.y1) : 0;
        const [, by] = map(a, base);
        ob.area.setAttribute('d', `${d}L${last},${by}L${first},${by}Z`);
      }
    },

    Line(sc, ob) { RENDER.Arrow(sc, ob, false); },

    Arrow(sc, ob, tip = true) {
      const P = ob.props;
      const [x0, y0] = sc.pt(P.from ?? '-1,0', P.on), [x1, y1] = sc.pt(P.to ?? '1,0', P.on);
      const color = P.color ?? (tip ? 'var(--axis)' : 'var(--fg)');
      const len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
      const tl = tip ? sc.num(P.tip ?? 0.36) * U : 0, tw = tl * 0.5;
      if (!ob.built) {
        ob.shaft = svgEl('path', { fill: 'none', 'stroke-linecap': tip ? 'butt' : 'round' }, ob.g);
        ob.shaft.style.stroke = color;
        ob.shaft.style.strokeWidth = P.width ?? (tip ? 6 : 4);
        if (P.dashed) { ob.shaft.dataset.dash = '16 12'; ob.shaft.style.strokeDasharray = '16 12'; }
        ob.strokes = [ob.shaft];
        if (tip) { ob.tip = svgEl('path', { stroke: 'none' }, ob.g); ob.tip.style.fill = color; }
        ob.built = true;
      }
      ob.shaft.setAttribute('d', `M${x0},${y0}L${x1 - ux * tl * 0.9},${y1 - uy * tl * 0.9}`);
      if (tip) {
        const bx = x1 - ux * tl, by = y1 - uy * tl;
        ob.tip.setAttribute('d', `M${x1},${y1}L${bx - uy * tw},${by + ux * tw}L${bx + uy * tw},${by - ux * tw}Z`);
      }
    },

    Dot(sc, ob) {
      const P = ob.props;
      const [x, y] = sc.pt(P.at ?? '0,0', P.on);
      if (!ob.built) {
        ob.c = svgEl('circle', {}, ob.g);
        ob.c.style.fill = P.color ?? 'var(--fg)';
        if (P.glow) ob.c.style.filter = `drop-shadow(0 0 10px ${P.color ?? 'var(--fg)'})`;
        ob.built = true;
      }
      ob.c.setAttribute('cx', x); ob.c.setAttribute('cy', y);
      ob.c.setAttribute('r', sc.num(P.r ?? 0.1) * U);
    },

    Circle(sc, ob) {
      const P = ob.props;
      const [x, y] = sc.pt(P.at ?? '0,0', P.on);
      if (!ob.built) {
        ob.c = svgEl('circle', {}, ob.g);
        styleShape(ob.c, P, 'none');
        ob.strokes = [ob.c];
        ob.built = true;
      }
      ob.c.setAttribute('cx', x); ob.c.setAttribute('cy', y);
      ob.c.setAttribute('r', sc.num(P.r ?? 1) * U);
    },

    Rect(sc, ob) {
      const P = ob.props;
      const [x, y] = sc.pt(P.at ?? '0,0', P.on);
      const w = sc.num(P.w ?? 2) * U, h = sc.num(P.h ?? 1) * U;
      if (!ob.built) {
        ob.r = svgEl('rect', { rx: sc.num(P.round ?? 0) * U }, ob.g);
        styleShape(ob.r, P, 'none');
        ob.strokes = [ob.r];
        ob.built = true;
      }
      Object.entries({ x: x - w / 2, y: y - h / 2, width: w, height: h }).forEach(([k, v]) => ob.r.setAttribute(k, v));
    },

    Band(sc, ob) {
      const P = ob.props;
      const ax = sc.objs[P.on];
      let x0, y0, x1, y1;
      if (ax) {
        const [a, b] = P.x ? sc.vec(P.x) : [ax.geo.x0, ax.geo.x1];
        const [c, d] = P.y ? sc.vec(P.y) : [ax.geo.y0, ax.geo.y1];
        [x0, y0] = ax.map(a, d); [x1, y1] = ax.map(b, c);
      } else {
        const [x, y] = sc.vec(P.at ?? '0,0'), w = sc.num(P.w ?? 2), h = sc.num(P.h ?? 1);
        [x0, y0, x1, y1] = [(x - w / 2) * U, -(y + h / 2) * U, (x + w / 2) * U, -(y - h / 2) * U];
      }
      if (!ob.built) {
        ob.r = svgEl('rect', { stroke: 'none' }, ob.g);
        ob.r.style.fill = P.color ?? 'var(--blue)';
        ob.r.style.fillOpacity = P.opacity ?? 0.2;
        ob.built = true;
      }
      Object.entries({ x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }).forEach(([k, v]) => ob.r.setAttribute(k, v));
    },

    Bars(sc, ob) {
      const P = ob.props;
      const ax = sc.objs[P.on];
      if (!ax) { console.warn('[aurora] Bars needs on=<axes id>'); return; }
      const vals = sc.vec(P.values ?? '');
      const { x0, x1, y0, y1 } = ax.geo;
      const bin = (x1 - x0) / vals.length, frac = sc.num(P.width ?? 0.8);
      const base = Math.min(Math.max(0, y0), y1);
      if (!ob.built) {
        ob.bars = vals.map(() => { const r = svgEl('rect', { stroke: 'none' }, ob.g); r.style.fill = P.color ?? 'var(--teal)'; r.style.fillOpacity = P.opacity ?? 1; return r; });
        ob.built = true;
      }
      vals.forEach((v, i) => {
        const [xa, ya] = ax.map(x0 + bin * (i + 0.5 - frac / 2), base);
        const [xb, yb] = ax.map(x0 + bin * (i + 0.5 + frac / 2), v);
        const r = ob.bars[i];
        Object.entries({ x: xa, y: Math.min(ya, yb), width: xb - xa, height: Math.abs(yb - ya) }).forEach(([k, val]) => r.setAttribute(k, val));
      });
    },

    MathTex(sc, ob) {
      const P = ob.props;
      const [x, y] = sc.place(P);
      if (!ob.built) {
        ob.g.innerHTML = ob.svg;
        ob.inner = ob.g.querySelector('svg');
        ob.g.style.color = P.color ?? 'var(--fg)';
        ob.built = true;
      }
      if (!ob.inner) return;
      const size = sc.num(P.size ?? 44);
      const [, , vw, vh] = ob.inner.getAttribute('viewBox').split(/\s+/).map(Number);
      const w = vw / 1000 * size, h = vh / 1000 * size;
      const ox = P.anchor === 'left' ? 0 : P.anchor === 'right' ? w : w / 2;
      Object.entries({ x: x - ox, y: y - h / 2, width: w, height: h }).forEach(([k, v]) => ob.inner.setAttribute(k, v));
      ob.inner.style.overflow = 'visible';
      ob.inner.style.verticalAlign = '';
    },

    Text(sc, ob) {
      const P = ob.props;
      const [x, y] = sc.place(P);
      if (!ob.built) {
        ob.t = svgEl('text', { 'dominant-baseline': 'central', 'text-anchor': { left: 'start', right: 'end' }[P.anchor] ?? 'middle' }, ob.g);
        ob.t.textContent = ob.text;
        ob.t.style.fill = P.color ?? 'var(--fg)';
        ob.t.style.fontSize = `${sc.num(P.size ?? 28)}px`;
        if (P.bold) ob.t.style.fontWeight = 700;
        ob.built = true;
      }
      ob.t.setAttribute('x', x); ob.t.setAttribute('y', y);
    },

    DecimalNumber(sc, ob) {
      const P = ob.props;
      const [x, y] = sc.pt(P.at ?? '0,0', P.on);
      const v = sc.num(P.value ?? '0');
      const s = (Number.isFinite(v) ? v : 0).toFixed(Math.round(sc.num(P.digits ?? 2))).replace('-', '−');
      if (s === ob.last && ob.lastX === x && ob.lastY === y) return;
      ob.last = s; ob.lastX = x; ob.lastY = y;
      ob.g.textContent = '';
      ob.g.style.color = P.color ?? 'var(--orange)';
      const size = sc.num(P.size ?? 60);
      let cx = 0;
      const parts = [];
      for (const ch of s) {
        const gl = DATA.glyphs?.[ch];
        if (!gl) continue;
        const [vx, vy, vw, vh] = gl.vb;
        const e = svgEl('svg', { viewBox: gl.vb.join(' '), width: vw / 1000 * size, height: vh / 1000 * size, overflow: 'visible' }, ob.g);
        e.innerHTML = gl.body;
        parts.push([e, cx, vy]);
        cx += vw / 1000 * size;
      }
      const ox = P.anchor === 'center' ? cx / 2 : P.anchor === 'right' ? cx : 0;
      for (const [e, px, vy] of parts) { e.setAttribute('x', x - ox + px); e.setAttribute('y', y + 0.33 * size + vy / 1000 * size); }
    },
  };

  // ---------------------------------------------------------------- chemistry
  const SUBS = '₀₁₂₃₄₅₆₇₈₉';
  const chargeText = (c) => (Math.abs(c) > 1 ? Math.abs(c) : '') + (c > 0 ? '+' : '−');

  // Approximate Helvetica advance widths (em) for atom labels.
  const GLYPH_W = { C: 0.72, O: 0.78, N: 0.72, H: 0.72, S: 0.67, F: 0.61, P: 0.67, I: 0.28, B: 0.67, K: 0.67, l: 0.24, r: 0.35, i: 0.24, a: 0.56, e: 0.56, g: 0.56, n: 0.56 };
  const textW = (s, fs) => [...String(s)].reduce((w, c) => w + (GLYPH_W[c] ?? 0.62), 0) * fs;

  /** Proportions follow the ACS 1996 drawing style, scaled from the bond length. */
  function molStyle(sc, ob) {
    const bondPx = ob.mol.bond * U;
    return {
      bondPx,
      fs: ob.props.size ? sc.num(ob.props.size) : bondPx * 0.36,
      sw: ob.props.width ? sc.num(ob.props.width) : Math.max(2.5, bondPx * 0.034),
      gap: bondPx * 0.17,
      color: ob.props.color ?? 'var(--fg)',
    };
  }

  /** Circled charge sits up and to the right of the label (or the bare vertex). */
  function chargePos(ob, i, st) {
    const a = ob.mol.atoms[i], [x, y] = ob.px[i], fs = st.fs;
    if (!a.show) return [x + fs * 0.5, y - fs * 0.5];
    let right = x + textW(a.sym, fs) / 2;
    if (a.hs > 0 && !a.hleft) right += textW('H', fs) + (a.hs > 1 ? fs * 0.4 : 0);
    return [right + fs * 0.26, y - fs * 0.52];
  }

  /** Directions (px space, unit vectors) for `count` lone pairs on atom i, placed in the widest gaps. */
  function lpDirs(ob, i, count, st) {
    const [x, y] = ob.px[i];
    const angs = ob.nbrs[i].map((j) => Math.atan2(ob.px[j][1] - y, ob.px[j][0] - x));
    const a = ob.mol.atoms[i];
    if (a.show && a.hs > 0) angs.push(a.hleft ? Math.PI : 0); // the H label occupies one side
    if (a.charge && st) { const [cx, cy] = chargePos(ob, i, st); angs.push(Math.atan2(cy - y, cx - x)); }
    angs.sort((p, q) => p - q);
    const gaps = [];
    if (!angs.length) gaps.push({ start: -Math.PI / 2, size: 2 * Math.PI, n: 0 });
    else angs.forEach((t, k) => {
      const nxt = k + 1 < angs.length ? angs[k + 1] : angs[0] + 2 * Math.PI;
      gaps.push({ start: t, size: nxt - t, n: 0 });
    });
    for (let c = 0; c < count; c++) gaps.reduce((b, g) => (g.size / (g.n + 1) > b.size / (b.n + 1) ? g : b)).n++;
    const dirs = [];
    for (const g of gaps) for (let j = 1; j <= g.n; j++) {
      const t = angs.length ? g.start + g.size * j / (g.n + 1) : g.start + g.size * (j - 1) / g.n;
      dirs.push([Math.cos(t), Math.sin(t)]);
    }
    return dirs;
  }

  Object.assign(RENDER, {
    /** ov: { pos(i) → [x,y] units, atomAlpha(i), bondAlpha(i) } for transforms. */
    Molecule(sc, ob, ov) {
      const P = ob.props, mol = ob.mol;
      const st = molStyle(sc, ob);
      const { fs, sw, color } = st;
      if (!ob.nbrs) {
        ob.nbrs = mol.atoms.map(() => []);
        for (const b of mol.bonds) { ob.nbrs[b.a].push(b.b); ob.nbrs[b.b].push(b.a); }
      }
      ob.px = mol.atoms.map((a, i) => { const [x, y] = ov?.pos ? ov.pos(i) : [a.x, a.y]; return [x * U, -y * U]; });
      ob.g.textContent = '';
      ob.strokes = []; ob.extras = []; ob.atomEls = []; ob.decoEls = []; ob.bondEls = []; ob.lpSites = [];
      const bondsG = svgEl('g', {}, ob.g), atomsG = svgEl('g', {}, ob.g);
      // Distance from an atom centre to the edge of its label along (ux, uy): an ellipse around the symbol.
      const trim = (i, ux, uy) => {
        const a = mol.atoms[i];
        if (!a.show) return 0;
        const rx = textW(a.sym, fs) / 2 + fs * 0.1, ry = fs * 0.48;
        return 1 / Math.hypot(ux / rx, uy / ry);
      };

      mol.bonds.forEach((b, bi) => {
        const g = svgEl('g', {}, bondsG);
        if (ov?.bondAlpha) g.style.opacity = ov.bondAlpha(bi);
        ob.bondEls[bi] = g;
        let [x1, y1] = ob.px[b.a], [x2, y2] = ob.px[b.b];
        const L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L;
        const t1 = trim(b.a, ux, uy), t2 = trim(b.b, -ux, -uy);
        x1 += ux * t1; y1 += uy * t1; x2 -= ux * t2; y2 -= uy * t2;
        const nx = -uy, ny = ux, d = st.gap;
        const line = (ax, ay, bx, by, alpha = 1) => {
          const p = svgEl('path', { d: `M${ax.toFixed(1)},${ay.toFixed(1)}L${bx.toFixed(1)},${by.toFixed(1)}`, fill: 'none', 'stroke-linecap': 'round' }, g);
          p.style.stroke = color; p.style.strokeWidth = sw;
          if (alpha < 1) p.style.opacity = alpha;
          ob.strokes.push(p);
        };
        // During a transform a bond can change order: draw the higher order with the extra line(s) at `extra`.
        const morph = ov?.bondOrder?.(bi);
        if (morph) {
          const t = morph.extra, side = morph.side;
          if (morph.hi === 2 && side === 0) {
            const o = (d / 2) * t; // centred pair splits out of / merges into one line
            line(x1 + nx * o, y1 + ny * o, x2 + nx * o, y2 + ny * o);
            line(x1 - nx * o, y1 - ny * o, x2 - nx * o, y2 - ny * o, t);
          } else if (morph.hi === 2) {
            const s2 = -side, sh1 = t1 ? 0 : L * 0.13, sh2 = t2 ? 0 : L * 0.13;
            line(x1, y1, x2, y2);
            line(x1 + nx * d * s2 + ux * sh1, y1 + ny * d * s2 + uy * sh1, x2 + nx * d * s2 - ux * sh2, y2 + ny * d * s2 - uy * sh2, t);
          } else {
            line(x1, y1, x2, y2);
            line(x1 + nx * d, y1 + ny * d, x2 + nx * d, y2 + ny * d, morph.lo >= 2 ? 1 : t);
            line(x1 - nx * d, y1 - ny * d, x2 - nx * d, y2 - ny * d, t);
          }
          return;
        }
        let stereo = b.stereo;
        const so = ov?.bondStereo?.(bi);
        if (so) {
          stereo = so.stereo;
          if (so.narrowAtB) { [x1, y1, x2, y2] = [x2, y2, x1, y1]; }
        }
        if (stereo) {
          // Wedge (filled) or hash (rungs), widening from the narrow end.
          const w = st.gap * 0.85;
          if (stereo === 'wedge') {
            const p = svgEl('path', { d: `M${x1},${y1}L${x2 + nx * w / 2},${y2 + ny * w / 2}L${x2 - nx * w / 2},${y2 - ny * w / 2}Z`, stroke: 'none' }, g);
            p.style.fill = color;
            p.style.stroke = color; p.style.strokeWidth = sw * 0.5; p.dataset.fill = 1;
            ob.strokes.push(p);
          } else {
            const rungs = Math.max(4, Math.round(L / (sw * 2.6)));
            let dd = '';
            for (let k = 1; k <= rungs; k++) {
              const t = k / rungs, hw = (w / 2) * t;
              const cx = x1 + (x2 - x1) * t, cy = y1 + (y2 - y1) * t;
              dd += `M${cx + nx * hw},${cy + ny * hw}L${cx - nx * hw},${cy - ny * hw}`;
            }
            const p = svgEl('path', { d: dd, fill: 'none', 'stroke-linecap': 'round' }, g);
            p.style.stroke = color; p.style.strokeWidth = sw * 0.7;
            ob.strokes.push(p);
          }
        } else if (b.order === 2 && b.side === 0) {
          line(x1 + nx * d / 2, y1 + ny * d / 2, x2 + nx * d / 2, y2 + ny * d / 2);
          line(x1 - nx * d / 2, y1 - ny * d / 2, x2 - nx * d / 2, y2 - ny * d / 2);
        } else if (b.order === 2) {
          // Ring-style double bond: full line plus a shortened inner line (`side` was computed y-up).
          const s = -b.side;
          const sh1 = t1 ? 0 : L * 0.13, sh2 = t2 ? 0 : L * 0.13;
          line(x1, y1, x2, y2);
          line(x1 + nx * d * s + ux * sh1, y1 + ny * d * s + uy * sh1, x2 + nx * d * s - ux * sh2, y2 + ny * d * s - uy * sh2);
        } else if (b.order === 3) {
          line(x1, y1, x2, y2);
          line(x1 + nx * d, y1 + ny * d, x2 + nx * d, y2 + ny * d);
          line(x1 - nx * d, y1 - ny * d, x2 - nx * d, y2 - ny * d);
        } else line(x1, y1, x2, y2);
      });

      mol.atoms.forEach((a, i) => {
        const g = svgEl('g', {}, atomsG);
        if (ov?.atomAlpha) g.style.opacity = ov.atomAlpha(i);
        ob.atomEls[i] = g;
        ob.extras.push(g);
        // Lone pairs and charges live in their own group so transforms can crossfade them.
        const dg = svgEl('g', {}, atomsG);
        if (ov?.decoAlpha) dg.style.opacity = ov.decoAlpha(i);
        ob.decoEls[i] = dg;
        ob.extras.push(dg);
        const [x, y] = ob.px[i];
        const label = (tx, anchor) => {
          const t = svgEl('text', { x: tx, y: y + fs * 0.36, 'text-anchor': anchor, class: 'atom' }, g);
          t.style.fill = color; t.style.fontSize = `${fs}px`;
          return t;
        };
        const sw2 = textW(a.sym, fs) / 2;
        let right = x + sw2;
        if (a.show) {
          label(x, 'middle').textContent = a.sym;
          if (a.hs > 0) {
            // H (+ subscript count) on the side away from the bonds.
            const t = label(a.hleft ? x - sw2 : right, a.hleft ? 'end' : 'start');
            t.appendChild(document.createTextNode('H'));
            if (a.hs > 1) {
              const sub = svgEl('tspan', { dy: fs * 0.22 }, t);
              sub.style.fontSize = `${fs * 0.68}px`;
              sub.textContent = a.hs;
            }
            if (!a.hleft) right += textW('H', fs) + (a.hs > 1 ? fs * 0.4 : 0);
          }
        }
        if (a.charge) {
          const [cx, cy] = chargePos(ob, i, st);
          const r = fs * 0.27;
          const c = svgEl('circle', { cx, cy, r, fill: 'none' }, dg);
          c.style.stroke = color; c.style.strokeWidth = sw * 0.6;
          const k = r * 0.55;
          let d = `M${cx - k},${cy}H${cx + k}`;
          if (a.charge > 0) d += `M${cx},${cy - k}V${cy + k}`;
          const p = svgEl('path', { d, fill: 'none', 'stroke-linecap': 'round' }, dg);
          p.style.stroke = color; p.style.strokeWidth = sw * 0.6;
        }
        const sites = [];
        if (a.lp > 0) {
          const r0 = a.show ? fs * 0.66 : fs * 0.4, sep = fs * 0.14, dot = Math.max(2.4, fs * 0.075);
          for (const [dx, dy] of lpDirs(ob, i, a.lp, st)) {
            const cx = x + dx * r0 * (Math.abs(dx) > 0.7 ? 1.12 : 1), cy = y + dy * r0;
            sites.push([cx, cy]);
            for (const s of [-1, 1]) {
              const c = svgEl('circle', { cx: cx - dy * sep * s, cy: cy + dx * sep * s, r: dot }, dg);
              c.style.fill = color;
            }
          }
        }
        ob.lpSites[i] = sites;
      });
    },

    CurlyArrow(sc, ob) {
      const P = ob.props;
      const m0 = sc.molsIn(P.mols)[0];
      const st = m0 ? molStyle(sc, m0) : { bondPx: 120, fs: 43, sw: 4 };
      const B0 = sc.ref(P.to, null, P.mols);
      let A = sc.ref(P.from, B0, P.mols);
      let B = sc.ref(P.to, A, P.mols);
      const fromBond = /^@?(\d+)\s*[-=#~.:]+\s*(\d+)$/.exec(String(P.from).trim());
      const toAtom = /^@?(\d+)$/.exec(String(P.to).trim());
      const c = sc.molCentroid(P.mols);
      let forced = null;
      const fromLp = /^@?lp:(\d+)$/.exec(String(P.from).trim());
      const toBond = /^@?(\d+)\s*[-=#~.:]+\s*(\d+)$/.exec(String(P.to).trim());
      if (fromLp && toBond && (toBond[1] === fromLp[1] || toBond[2] === fromLp[1])) {
        // Lone pair → a bond on the same atom (forming a π bond): leave from the outermost
        // pair and arc around the outside to the bond's midpoint.
        const self = sc.findAtom(+fromLp[1], P.mols), oth = sc.findAtom(+(toBond[1] === fromLp[1] ? toBond[2] : toBond[1]), P.mols);
        if (self && oth) {
          const S = self.ob.px[self.i], O = oth.ob.px[oth.i];
          const bx = O[0] - S[0], by = O[1] - S[1], bl = Math.hypot(bx, by) || 1;
          let px = -by / bl, py = bx / bl;
          if (c && (c[0] - S[0]) * px + (c[1] - S[1]) * py > 0) { px = -px; py = -py; }
          const sites = self.ob.lpSites[self.i]?.length ? self.ob.lpSites[self.i] : [A];
          A = sites.reduce((best, p) => ((p[0] - S[0]) * px + (p[1] - S[1]) * py > (best[0] - S[0]) * px + (best[1] - S[1]) * py ? p : best));
          B = [(S[0] + O[0]) / 2 + px * st.fs * 0.3, (S[1] + O[1]) / 2 + py * st.fs * 0.3];
          forced = [px, py];
        }
      } else if (fromBond && toAtom && (fromBond[1] === toAtom[1] || fromBond[2] === toAtom[1])) {
        // Bond → one of its own atoms (π bond onto O, C–Cl onto Cl): swing out on the outer side.
        const other = sc.findAtom(+(fromBond[1] === toAtom[1] ? fromBond[2] : fromBond[1]), P.mols);
        const Q = other ? other.ob.px[other.i] : A;
        const bx = B[0] - Q[0], by = B[1] - Q[1], bl = Math.hypot(bx, by) || 1;
        let px = -by / bl, py = bx / bl;
        if (c && (c[0] - A[0]) * px + (c[1] - A[1]) * py > 0) { px = -px; py = -py; }
        A = [A[0] + px * st.fs * 0.2, A[1] + py * st.fs * 0.2];
        B = [B[0] + px * st.fs * 0.7 + (bx / bl) * st.fs * 0.15, B[1] + py * st.fs * 0.7 + (by / bl) * st.fs * 0.15];
        forced = [px, py];
      } else if (toAtom) {
        // Stop short of an atom so the head doesn't sit on its label.
        const hit = sc.findAtom(+toAtom[1], P.mols);
        const at = hit && hit.ob.mol.atoms[hit.i];
        const hFacesA = at && at.show && at.hs > 0 && (at.hleft ? A[0] < B[0] : A[0] > B[0]) && Math.abs(A[1] - B[1]) < Math.abs(A[0] - B[0]);
        if (hFacesA) {
          // The H label is in the way: come in from below (or above) the atom symbol instead.
          const v = A[1] < B[1] - st.fs ? -1 : 1;
          B = [B[0], B[1] + v * st.fs * 0.8];
        } else {
          const gap = at && at.show ? st.fs * 0.75 : st.fs * 0.3;
          const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
          B = [B[0] - (B[0] - A[0]) / L * gap, B[1] - (B[1] - A[1]) / L * gap];
        }
      }
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
      const nx = -uy, ny = ux;
      // Bow away from the centroid of the molecules involved.
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      let side = forced ? (forced[0] * nx + forced[1] * ny > 0 ? 1 : -1) : c && (c[0] - mx) * nx + (c[1] - my) * ny > 0 ? -1 : 1;
      const bend = P.bend !== undefined ? sc.num(P.bend) : 1;
      side *= Math.sign(bend) || 1;
      const h = Math.max(st.bondPx * 0.36, L * 0.3) * Math.abs(bend);
      const c1 = [A[0] + ux * L * 0.2 + nx * h * side, A[1] + uy * L * 0.2 + ny * h * side];
      const c2 = [A[0] + ux * L * 0.8 + nx * h * side, A[1] + uy * L * 0.8 + ny * h * side];
      const tx = B[0] - c2[0], ty = B[1] - c2[1], tl = Math.hypot(tx, ty) || 1;
      const hx = tx / tl, hy = ty / tl, HL = st.bondPx * 0.2, HW = st.bondPx * 0.07;
      const end = [B[0] - hx * HL * 0.6, B[1] - hy * HL * 0.6];
      const color = P.color ?? 'var(--orange)';
      if (!ob.built) {
        ob.shaft = svgEl('path', { fill: 'none', 'stroke-linecap': 'round' }, ob.g);
        ob.shaft.style.stroke = color; ob.shaft.style.strokeWidth = P.width ?? st.sw * 0.9;
        ob.tip = svgEl('path', { stroke: 'none' }, ob.g); ob.tip.style.fill = color;
        ob.strokes = [ob.shaft];
        ob.built = true;
      }
      ob.shaft.setAttribute('d', `M${A[0]},${A[1]}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${end[0]},${end[1]}`);
      const bx = B[0] - hx * HL, by = B[1] - hy * HL;
      const wing = (s) => [bx - hy * HW * s, by + hx * HW * s];
      const [w1, w2] = [wing(1), wing(-1)];
      ob.tip.setAttribute('d', P.fishhook
        ? `M${B[0]},${B[1]}L${(side > 0 ? w1 : w2).join(',')}L${bx + hx * 4},${by + hy * 4}Z`
        : `M${B[0]},${B[1]}L${w1.join(',')}L${w2.join(',')}Z`);
    },
  });

  function styleShape(n, P, defFill) {
    n.style.stroke = P.color ?? 'var(--fg)';
    n.style.strokeWidth = P.width ?? 4;
    if (P.fill) {
      n.style.fill = P.fillcolor ?? P.color ?? 'var(--fg)';
      n.dataset.fill = P.fill === true ? 0.3 : P.fill;
      n.style.fillOpacity = n.dataset.fill;
    } else n.style.fill = defFill;
  }

  const DEFAULT_INTRO = {
    Axes: 'create', Plot: 'create', Line: 'create', Arrow: 'create', Circle: 'create', Rect: 'create',
    Dot: 'grow', Band: 'fade', Bars: 'growup', MathTex: 'write', Text: 'fadein', DecimalNumber: 'fade',
    Molecule: 'create', CurlyArrow: 'create',
  };
  const DEFAULT_RUN = { Axes: 1, Plot: 1.5, Line: 0.8, Arrow: 0.8, Circle: 1, Rect: 0.8, Dot: 0.5, Band: 0.6, Bars: 1.2, Text: 0.7, DecimalNumber: 0.5, Molecule: 1.4, CurlyArrow: 0.9 };

  class Scene {
    constructor(host, spec) { this.host = host; this.spec = spec; }

    build() {
      const [W, H] = this.spec.size;
      this.host.textContent = '';
      this.svg = svgEl('svg', { viewBox: `${-W * U / 2} ${-H * U / 2} ${W * U} ${H * U}`, width: W * U, height: H * U }, this.host);
      this.trackers = {};
      this.objs = {};
      this.dynamic = [];
      const trackerIds = this.spec.objects.filter((o) => o.kind === 'ValueTracker').map((o) => o.id);
      for (const o of this.spec.objects) if (o.kind === 'ValueTracker') this.trackers[o.id] = this.num(o.props.value ?? '0');
      const mentions = (s) => typeof s === 'string' && trackerIds.some((t) => new RegExp(`\\b${t}\\b`).test(s));
      for (const o of this.spec.objects) {
        if (o.kind === 'ValueTracker') continue;
        const g = svgEl('g', { class: 'hidden-step' }, this.svg);
        const ob = { ...o, g, built: false };
        this.objs[o.id] = ob;
        ob.dynamic = Object.values(o.props).some(mentions) || mentions(o.text) || (o.props.on && this.objs[o.props.on]?.dynamic);
        try { RENDER[o.kind](this, ob); } catch (e) { console.error(`[aurora] ${o.kind} ${o.id}`, e); }
        if (ob.dynamic) this.dynamic.push(ob);
      }
    }

    fn(expr, extra = []) {
      const base = { ...MATHS, ...this.trackers };
      const names = [...Object.keys(base), ...extra];
      const f = compile(expr, names);
      const vals = Object.values(base);
      return (...xs) => f(...vals, ...xs);
    }
    num(v) {
      if (typeof v === 'number') return v;
      if (v === true || v == null) return NaN;
      const s = String(v).trim();
      return /^-?\d*\.?\d+(e-?\d+)?$/i.test(s) ? parseFloat(s) : this.fn(s)();
    }
    vec(v) { return splitTop(v).map((x) => this.num(x)); }
    /** Point in scene px; `on` = axes id to interpret coordinates in. */
    pt(v, on, mols) {
      if (typeof v === 'string' && v.trim().startsWith('@')) return this.ref(v, null, mols);
      const [x, y] = this.vec(v);
      const ax = on && this.objs[on];
      return ax ? ax.map(x, y) : [x * U, -y * U];
    }
    /** Position plus optional `offset` prop (units). */
    place(P) {
      const [x, y] = this.pt(P.at ?? '0,0', P.on, P.mols);
      if (!P.offset) return [x, y];
      const [ox, oy] = this.vec(P.offset);
      return [x + ox * U, y - oy * U];
    }

    molsIn(mols) {
      const ids = mols ? String(mols).split(',').filter(Boolean) : Object.keys(this.objs);
      return ids.map((id) => this.objs[id]).filter((o) => o && o.kind === 'Molecule' && o.px);
    }
    findAtom(map, mols) {
      for (const ob of this.molsIn(mols).reverse()) {
        const i = ob.mol.atoms.findIndex((a) => a.map === map);
        if (i >= 0) return { ob, i };
      }
      console.warn(`[aurora] no atom with map number ${map}`);
      return null;
    }
    molCentroid(mols) {
      const pts = this.molsIn(mols).flatMap((o) => o.px);
      if (!pts.length) return null;
      return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    }
    /** Atom reference → px: `3` atom, `2-3` / `2=3` midpoint, `lp:5[:k]` lone pair (nearest to `toward`). */
    ref(r, toward, mols) {
      const s = String(r ?? '').trim().replace(/^@/, '');
      let m;
      if ((m = /^lp:(\d+)(?::(\d+))?$/.exec(s))) {
        const hit = this.findAtom(+m[1], mols);
        if (!hit) return [0, 0];
        const { ob, i } = hit;
        let sites = ob.lpSites[i];
        if (!sites?.length) {
          const st = molStyle(this, ob), fs = st.fs, r0 = ob.mol.atoms[i].show ? fs * 0.66 : fs * 0.4;
          sites = lpDirs(ob, i, 3, st).map(([dx, dy]) => [ob.px[i][0] + dx * r0, ob.px[i][1] + dy * r0]);
        }
        if (m[2]) return sites[Math.min(sites.length - 1, +m[2] - 1)];
        if (!toward) return sites[0];
        return sites.reduce((b, p) => (Math.hypot(p[0] - toward[0], p[1] - toward[1]) < Math.hypot(b[0] - toward[0], b[1] - toward[1]) ? p : b));
      }
      if ((m = /^(\d+)\s*[-=#~.:]+\s*(\d+)$/.exec(s))) {
        const a = this.findAtom(+m[1], mols), b = this.findAtom(+m[2], mols);
        if (!a || !b) return [0, 0];
        const pa = a.ob.px[a.i], pb = b.ob.px[b.i];
        return [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      }
      if (/^\d+$/.test(s)) { const a = this.findAtom(+s, mols); return a ? a.ob.px[a.i] : [0, 0]; }
      const [x, y] = this.vec(s);
      return [x * U, -y * U];
    }
    redraw() { for (const ob of this.dynamic) RENDER[ob.kind](this, ob); }

    intro(ob, ev) {
      const kind = ev.anim ?? DEFAULT_INTRO[ob.kind] ?? 'fade';
      const dur = ev.run ?? DEFAULT_RUN[ob.kind];
      const g = ob.g;
      switch (kind) {
        case 'none': return { dur: 0, tick() {}, begin() { reveal(g); } };
        case 'write':
          if (ob.kind === 'MathTex') return write(g, { dur, strokeWidth: 24 });
        // fallthrough
        case 'create': {
          const strokes = ob.strokes ?? [];
          if (!strokes.length) return fadeIn(g, { dur: dur ?? 0.6, shift: 0 });
          const a = create(g, strokes, { dur: dur ?? 1, lag: ob.kind === 'Axes' ? 0.15 : 0 });
          const extras = [ob.tip, ob.area, ...(ob.extras ?? [])].filter(Boolean);
          if (!extras.length) return a;
          // Arrow tips / plot fills fade in over the last third.
          return { ...a, begin() { a.begin(); extras.forEach((e) => (e.style.opacity = 0)); },
            tick(t) { a.tick(t); extras.forEach((e) => (e.style.opacity = clamp01((t - 0.66) * 3))); },
            end() { a.end(); extras.forEach((e) => (e.style.opacity = '')); } };
        }
        case 'grow': return grow(g, { dur: dur ?? 0.5 });
        case 'growup': return grow(g, { dur: dur ?? 1.2, origin: '50% 100%', axis: 'y', targets: ob.bars ?? [g], lag: 0.15 });
        case 'fadein': return fadeIn(g, { dur: dur ?? 0.7, shift: 14 });
        default: return fadeIn(g, { dur: dur ?? 0.6, shift: 0 });
      }
    }

    eventAnim(ev) {
      const ob = ev.target ? this.objs[ev.target] : null;
      switch (ev.type) {
        case 'intro': return ob && this.intro(ob, ev);
        case 'animate': {
          let from = {}, to = {};
          return {
            dur: ev.run ?? 1,
            begin: () => {
              for (const [k, expr] of Object.entries(ev.targets)) { from[k] = this.trackers[k]; to[k] = this.num(expr); }
            },
            tick: (a) => {
              for (const k in to) this.trackers[k] = from[k] + (to[k] - from[k]) * a;
              this.redraw();
            },
          };
        }
        case 'fadeout': {
          const targets = ob ? [ob.g] : Object.values(this.objs).map((o) => o.g).filter((g) => !g.classList.contains('hidden-step'));
          const anims = targets.map((g) => fadeOut(g, { dur: ev.run ?? 0.5 }));
          return { dur: ev.run ?? 0.5, tick: (a) => anims.forEach((x) => x.tick(a)), end: () => anims.forEach((x) => x.end()) };
        }
        case 'indicate': return ob && indicate(ob.g, { dur: ev.run ?? 1 });
        case 'transform': return this.morphMolecule(ev);
        case 'transformtex': return this.morphTex(ev);
        case 'wait': return { dur: ev.run ?? 1, tick() {} };
      }
      return null;
    }

    /**
     * Mechanism morph. Persisting (mapped) atoms glide; what disappears fades out over the
     * first half, what appears fades in over the second half; labels, lone pairs and charges
     * only crossfade when they actually change.
     */
    morphMolecule(ev) {
      const srcs = ev.sources.map((id) => this.objs[id]).filter(Boolean);
      const tgt = this.objs[ev.target];
      if (!tgt) return null;
      const key = (m1, m2, o) => `${Math.min(m1, m2)}-${Math.max(m1, m2)}:${o}`;
      const fadeOut = (a) => clamp01(1 - a / 0.45), fadeIn = (a) => clamp01((a - 0.55) / 0.45);
      let match = [], labelSame = [], decoSame = [], bondMatch = [], orderMorph = [], outs = [], plan = [], stereoSrc = [];
      return {
        dur: ev.run ?? 1.6,
        begin: () => {
          const srcAtom = new Map(), srcBond = new Set();
          for (const s of srcs) {
            s.mol.atoms.forEach((a, i) => { if (a.map) srcAtom.set(a.map, { s, i, a, pos: [s.px[i][0] / U, -s.px[i][1] / U] }); });
            s.mol.bonds.forEach((b) => { const ma = s.mol.atoms[b.a].map, mb = s.mol.atoms[b.b].map; if (ma && mb) srcBond.add(key(ma, mb, b.order)); });
          }
          const tAtoms = tgt.mol.atoms;
          const tBonds = new Set(tgt.mol.bonds.map((b) => key(tAtoms[b.a].map, tAtoms[b.b].map, b.order)));
          const tBy = new Map(tAtoms.filter((a) => a.map).map((a) => [a.map, a]));
          match = tAtoms.map((a) => (a.map ? srcAtom.get(a.map) ?? null : null));
          // Motion plan: walk the product outward from its best-connected persisting atom.
          // Bonds that already existed swing (angle + length interpolation) instead of sliding
          // straight through each other, so an umbrella inversion rotates rather than collapses.
          const nb = tAtoms.map(() => []);
          tgt.mol.bonds.forEach((b) => { nb[b.a].push(b.b); nb[b.b].push(b.a); });
          const srcBonded = (i, j) => match[i] && match[j] && match[i].s === match[j].s &&
            match[i].s.mol.bonds.some((b) => (b.a === match[i].i && b.b === match[j].i) || (b.b === match[i].i && b.a === match[j].i));
          plan = [];
          const seen = new Set();
          const roots = tAtoms.map((_, i) => i).sort((x, y) => (match[y] ? 1 : 0) - (match[x] ? 1 : 0) || nb[y].length - nb[x].length);
          for (const r of roots) {
            if (seen.has(r)) continue;
            seen.add(r);
            const queue = [r];
            plan.push({ i: r, parent: -1 });
            while (queue.length) {
              const p = queue.shift();
              for (const c of nb[p]) {
                if (seen.has(c)) continue;
                seen.add(c);
                queue.push(c);
                plan.push({ i: c, parent: srcBonded(p, c) ? p : -1 });
              }
            }
          }
          const labelOf = (a) => (a.show ? `${a.sym}|${a.hs}|${a.hleft}` : '');
          labelSame = tAtoms.map((a, i) => !!match[i] && labelOf(match[i].a) === labelOf(a));
          decoSame = tAtoms.map((a, i) => !!match[i] && match[i].a.lp === a.lp && match[i].a.charge === a.charge);
          bondMatch = tgt.mol.bonds.map((b) => !!(tAtoms[b.a].map && tAtoms[b.b].map && srcBond.has(key(tAtoms[b.a].map, tAtoms[b.b].map, b.order))));
          // Same atom pair, different order (π bond made or broken): morph it in place.
          const srcPair = new Map();
          for (const s of srcs) s.mol.bonds.forEach((b) => { const ma = s.mol.atoms[b.a].map, mb = s.mol.atoms[b.b].map; if (ma && mb) srcPair.set(key(ma, mb, 0), b); });
          orderMorph = tgt.mol.bonds.map((b, i) => {
            if (bondMatch[i] || !tAtoms[b.a].map || !tAtoms[b.b].map) return null;
            const sb = srcPair.get(key(tAtoms[b.a].map, tAtoms[b.b].map, 0));
            if (!sb || sb.stereo || b.stereo) return null;
            const forming = b.order > sb.order;
            return { lo: Math.min(b.order, sb.order), hi: Math.max(b.order, sb.order), side: (forming ? b : sb).side, forming };
          });
          // Wedge ↔ hash flips (inversion) switch halfway through the motion.
          stereoSrc = tgt.mol.bonds.map((b) => {
            const sb = tAtoms[b.a].map && tAtoms[b.b].map && srcPair.get(key(tAtoms[b.a].map, tAtoms[b.b].map, 0));
            if (!sb || sb.stereo === b.stereo) return null;
            const sAtoms = srcs.find((x) => x.mol.bonds.includes(sb)).mol.atoms;
            return { stereo: sb.stereo, narrowAtB: sAtoms[sb.a].map === tAtoms[b.b].map };
          });
          const morphPairs = new Set(tgt.mol.bonds.filter((b, i) => orderMorph[i]).map((b) => key(tAtoms[b.a].map, tAtoms[b.b].map, 0)));
          outs = [];
          for (const s of srcs) {
            s.mol.atoms.forEach((a, i) => {
              const t = a.map && tBy.get(a.map);
              const keepLabel = t && labelOf(t) === labelOf(a), keepDeco = t && t.lp === a.lp && t.charge === a.charge;
              if (keepLabel || t) s.atomEls[i].style.opacity = 0; else outs.push(s.atomEls[i]);
              if (keepDeco) s.decoEls[i].style.opacity = 0; else outs.push(s.decoEls[i]);
            });
            s.mol.bonds.forEach((b, i) => {
              const ma = s.mol.atoms[b.a].map, mb = s.mol.atoms[b.b].map;
              if (ma && mb && (tBonds.has(key(ma, mb, b.order)) || morphPairs.has(key(ma, mb, 0)))) s.bondEls[i].style.opacity = 0; else outs.push(s.bondEls[i]);
            });
          }
          // Electron-pushing arrows have done their job once the mechanism step happens.
          for (const o of Object.values(this.objs)) if (o.kind === 'CurlyArrow' && !o.g.classList.contains('hidden-step')) outs.push(o.g);
          reveal(tgt.g);
        },
        tick: (a) => {
          const fi = fadeIn(a);
          const T = tgt.mol.atoms, P = [];
          for (const { i, parent } of plan) {
            const m = match[i]?.pos, t = T[i];
            if (parent < 0 || !match[parent]) { P[i] = m ? [m[0] + (t.x - m[0]) * a, m[1] + (t.y - m[1]) * a] : [t.x, t.y]; continue; }
            const mp = match[parent].pos, tp = T[parent];
            const sa = Math.atan2(m[1] - mp[1], m[0] - mp[0]), ta = Math.atan2(t.y - tp.y, t.x - tp.x);
            let da = ta - sa;
            while (da > Math.PI) da -= 2 * Math.PI;
            while (da < -Math.PI) da += 2 * Math.PI;
            const ang = sa + da * a, len = Math.hypot(m[0] - mp[0], m[1] - mp[1]) * (1 - a) + Math.hypot(t.x - tp.x, t.y - tp.y) * a;
            P[i] = [P[parent][0] + Math.cos(ang) * len, P[parent][1] + Math.sin(ang) * len];
          }
          RENDER.Molecule(this, tgt, {
            pos: (i) => P[i] ?? [T[i].x, T[i].y],
            // A persisting atom's label travels with it; if its text changes (OH → HO) it brightens in place.
            atomAlpha: (i) => (labelSame[i] ? 1 : match[i] ? 0.45 + 0.55 * a : fi),
            decoAlpha: (i) => (decoSame[i] ? 1 : fi),
            bondAlpha: (i) => (bondMatch[i] || orderMorph[i] ? 1 : fi),
            bondStereo: (i) => (stereoSrc[i] && a < 0.5 ? stereoSrc[i] : stereoSrc[i] ? { stereo: tgt.mol.bonds[i].stereo, narrowAtB: false } : null),
            bondOrder: (i) => { const m = orderMorph[i]; return m && { ...m, extra: m.forming ? fi : fadeOut(a) }; },
          });
          const fo = fadeOut(a);
          for (const el of outs) el.style.opacity = fo;
        },
        end: () => {
          for (const s of srcs) s.g.classList.add('hidden-step');
          for (const el of outs) if (el.parentNode === this.svg) { el.classList.add('hidden-step'); el.style.opacity = ''; }
          RENDER.Molecule(this, tgt);
        },
      };
    }

    /** TransformMatchingTex: identical glyphs glide to their new places. */
    morphTex(ev) {
      const src = this.objs[ev.sources[0]], tgt = this.objs[ev.target];
      if (!src || !tgt) return null;
      let overlay, pairs = [];
      const glyphs = (ob) => [...ob.g.querySelectorAll('path, rect')];
      const keyOf = (el) => el.getAttribute('data-c') ?? el.tagName;
      const lerpM = (m, n, a) => ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => m[k] + (n[k] - m[k]) * a);
      return {
        dur: ev.run ?? 1.2,
        begin: () => {
          reveal(tgt.g);
          const inv = this.svg.getScreenCTM().inverse();
          const mat = (el) => inv.multiply(el.getScreenCTM());
          const sg = glyphs(src).map((el) => ({ el, k: keyOf(el), m: mat(el), used: false }));
          const tg = glyphs(tgt).map((el) => ({ el, k: keyOf(el), m: mat(el) }));
          overlay = svgEl('g', { fill: 'currentColor', stroke: 'currentColor', 'stroke-width': 0 }, this.svg);
          overlay.style.color = tgt.g.style.color;
          pairs = [];
          for (const t of tg) {
            const s = sg.find((g) => !g.used && g.k === t.k);
            if (s) s.used = true;
            pairs.push({ from: s?.m ?? t.m, to: t.m, el: t.el, kind: s ? 'move' : 'in' });
          }
          for (const s of sg) if (!s.used) pairs.push({ from: s.m, to: s.m, el: s.el, kind: 'out' });
          for (const p of pairs) { p.clone = p.el.cloneNode(true); p.clone.removeAttribute('style'); overlay.appendChild(p.clone); }
          src.g.style.opacity = 0; tgt.g.style.opacity = 0;
        },
        tick: (a) => {
          for (const p of pairs) {
            p.clone.setAttribute('transform', `matrix(${lerpM(p.from, p.to, a).join(' ')})`);
            p.clone.style.opacity = p.kind === 'in' ? a : p.kind === 'out' ? 1 - a : 1;
          }
        },
        end: () => {
          overlay?.remove();
          src.g.classList.add('hidden-step'); src.g.style.opacity = '';
          tgt.g.style.opacity = '';
        },
      };
    }

    /** Plays (or with instant=true, applies) every event of step k. */
    playStep(k, instant = false) {
      let cursor = 0, prevStart = 0;
      for (const ev of this.spec.events) {
        if (ev.step !== k) continue;
        const a = this.eventAnim(ev);
        if (!a) continue;
        const start = (ev.with ? prevStart : cursor) + (ev.delay ?? 0);
        prevStart = start;
        if (instant) runNow(a); else engine.play(a, start);
        cursor = Math.max(cursor, start + a.dur);
      }
    }

    snapTo(k) {
      this.build();
      for (let s = 0; s <= k; s++) this.playStep(s, true);
    }
  }

  // ---------------------------------------------------------------- player
  const stage = document.getElementById('stage');
  const slides = [...stage.querySelectorAll('.slide')];
  const pagenum = document.querySelector('.pagenum');
  const state = { s: 0, k: 0 };

  const scenesOf = (slide) => (slide._scenes ??= [...slide.querySelectorAll('.scene')].map((h) => new Scene(h, DATA.scenes[+h.dataset.scene])));
  const stepEls = (slide) => [...slide.querySelectorAll('[data-from]')];
  const range = (el) => [+el.dataset.from, el.dataset.until !== undefined ? +el.dataset.until : Infinity];

  function setAlerts(slide, k) {
    for (const el of slide.querySelectorAll('.alert-timed')) {
      const from = +el.dataset.alertFrom, until = el.dataset.alertUntil !== undefined ? +el.dataset.alertUntil : Infinity;
      el.classList.toggle('on', from <= k && k < until);
    }
  }

  function setVisibility(slide, k) {
    const covered = slide.dataset.covered !== undefined;
    for (const el of stepEls(slide)) {
      const [from, until] = range(el);
      el.style.opacity = ''; el.style.transform = '';
      if (el.dataset.anim === 'write') el.querySelectorAll('path, rect').forEach((p) => p.removeAttribute('style'));
      el.classList.toggle('hidden-step', !(from <= k && k < until));
      el.classList.toggle('covered-step', covered && from > k);
    }
    setAlerts(slide, k);
  }

  function animateStep(slide, k) {
    const els = stepEls(slide);
    let i = 0;
    for (const el of els) {
      const [from, until] = range(el);
      if (until === k) { el.classList.contains('only') ? el.classList.add('hidden-step') : engine.play(fadeOut(el)); continue; }
      if (from !== k) continue;
      const parent = el.parentElement.closest('[data-from]');
      if (parent && +parent.dataset.from === k) { reveal(el); continue; } // revealed with its parent
      engine.play(el.dataset.anim === 'write' ? write(el) : fadeIn(el), i++ * 0.12);
    }
    setAlerts(slide, k);
    for (const sc of scenesOf(slide)) sc.playStep(k);
  }

  function show(s) {
    slides.forEach((el, i) => el.classList.toggle('active', i === s));
    if (pagenum) pagenum.textContent = slides[s].classList.contains('title-slide') ? '' : `${s + 1} / ${slides.length}`;
  }

  function enter(s) {
    show(s);
    const slide = slides[s];
    setVisibility(slide, -1);
    for (const sc of scenesOf(slide)) sc.build();
    animateStep(slide, 0);
  }

  function snap(s, k) {
    show(s);
    const slide = slides[s];
    setVisibility(slide, k);
    for (const sc of scenesOf(slide)) sc.snapTo(k);
  }

  const lastStep = (s) => +slides[s].dataset.steps - 1;

  // Presenter and audience windows stay in sync over a BroadcastChannel.
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`aurora:${document.title}`) : null;
  const broadcast = (type) => channel?.postMessage({ type, s: state.s, k: state.k });

  function next(remote = false) {
    if (engine.busy()) { engine.finishAll(); if (!remote) broadcast('finish'); return; }
    if (state.k < lastStep(state.s)) { state.k++; animateStep(slides[state.s], state.k); }
    else if (state.s < slides.length - 1) { state.s++; state.k = 0; enter(state.s); }
    else return;
    afterMove(remote ? null : 'next');
  }

  function prev(remote = false) {
    engine.cancelAll();
    if (state.k > 0) state.k--;
    else if (state.s > 0) { state.s--; state.k = lastStep(state.s); }
    snap(state.s, state.k);
    afterMove(remote ? null : 'jump');
  }

  function jump(s, k = 0, animate = false, remote = false) {
    engine.cancelAll();
    state.s = Math.max(0, Math.min(slides.length - 1, s));
    state.k = Math.max(0, Math.min(lastStep(state.s), k));
    if (animate && state.k === 0) enter(state.s); else snap(state.s, state.k);
    afterMove(remote ? null : 'jump');
  }

  function afterMove(msg) {
    const h = `#${state.s + 1}${state.k ? '.' + state.k : ''}`;
    if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
    if (msg) broadcast(msg);
    updatePresenter();
  }

  channel && (channel.onmessage = ({ data }) => {
    if (data.type === 'finish') engine.finishAll();
    else if (data.type === 'next' && (data.s !== state.s || data.k !== state.k)) {
      // Animate when the remote moved exactly one step ahead; otherwise snap.
      const oneAhead = (data.s === state.s && data.k === state.k + 1) || (data.s === state.s + 1 && data.k === 0 && state.k === lastStep(state.s));
      oneAhead ? next(true) : jump(data.s, data.k, false, true);
    } else if (data.type === 'jump') jump(data.s, data.k, false, true);
  });

  function readHash() {
    const m = /^#(\d+)(?:\.(\d+))?/.exec(location.hash);
    return m ? [parseInt(m[1], 10) - 1, parseInt(m[2] ?? '0', 10)] : null;
  }

  // ---------------------------------------------------------------- presenter view (?presenter)
  const presenter = new URLSearchParams(location.search).has('presenter');
  let ui = null, t0 = null;
  if (presenter) {
    document.body.classList.add('presenter');
    ui = document.createElement('aside');
    ui.className = 'pv';
    ui.innerHTML = `<div class="pv-top"><span class="pv-pos"></span><span class="pv-timer">00:00</span></div>
      <div class="pv-next"></div><div class="pv-notes"></div>
      <div class="pv-help">→ / space next · ← back · click timer to reset</div>`;
    document.body.appendChild(ui);
    ui.querySelector('.pv-timer').addEventListener('click', (e) => { e.stopPropagation(); t0 = Date.now(); });
    setInterval(() => {
      if (t0 === null) return;
      const sec = Math.floor((Date.now() - t0) / 1000);
      ui.querySelector('.pv-timer').textContent = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    }, 500);
  }
  function updatePresenter() {
    if (!ui) return;
    t0 ??= Date.now();
    const sl = slides[state.s];
    ui.querySelector('.pv-pos').textContent = `slide ${state.s + 1} / ${slides.length} · step ${state.k + 1} / ${lastStep(state.s) + 1}`;
    const nextSlide = state.k < lastStep(state.s) ? 'next: step ' + (state.k + 2) : slides[state.s + 1] ? 'next: ' + (slides[state.s + 1].querySelector('.ftitle, .t-title')?.textContent ?? `slide ${state.s + 2}`) : 'end of deck';
    ui.querySelector('.pv-next').textContent = nextSlide;
    ui.querySelector('.pv-notes').innerHTML = sl.querySelector('.notes')?.innerHTML ?? '<span class="pv-empty">No notes for this slide. Add \\note{…} in the frame.</span>';
  }

  // ---------------------------------------------------------------- overview grid (o)
  let overview = false;
  function toggleOverview() {
    overview = !overview;
    document.body.classList.toggle('overview', overview);
    engine.finishAll();
    if (overview) {
      stage.style.transform = '';
      slides.forEach((sl, i) => {
        sl.classList.add('active');
        sl.classList.toggle('current', i === state.s);
        setVisibility(sl, lastStep(i));
        for (const sc of scenesOf(sl)) sc.snapTo(lastStep(i));
      });
      slides[state.s].scrollIntoView({ block: 'center' });
    } else {
      slides.forEach((sl) => sl.classList.remove('current'));
      fit();
      jump(state.s, state.k);
    }
  }

  // ---------------------------------------------------------------- help overlay (?)
  const help = document.createElement('div');
  help.className = 'help';
  help.innerHTML = `<div><h3>Aurora</h3><table>
    <tr><td>→ space click</td><td>next step (finishes a running animation first)</td></tr>
    <tr><td>← </td><td>previous step</td></tr>
    <tr><td>Home / End</td><td>first / last slide</td></tr>
    <tr><td>o</td><td>overview grid</td></tr>
    <tr><td>s</td><td>speaker view (notes, timer) in a new window</td></tr>
    <tr><td>f</td><td>fullscreen</td></tr>
    <tr><td>?</td><td>toggle this help</td></tr></table></div>`;
  document.body.appendChild(help);

  function fit() {
    if (overview) return;
    const box = presenter ? { w: innerWidth * 0.66, h: innerHeight } : { w: innerWidth, h: innerHeight };
    const sc = Math.min(box.w / 1920, box.h / 1080);
    stage.style.transform = `translate(${(box.w - 1920 * sc) / 2}px, ${(box.h - 1080 * sc) / 2}px) scale(${sc})`;
  }

  addEventListener('resize', fit);
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (overview && k !== 'o' && k !== 'Escape') return;
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(k)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) { e.preventDefault(); prev(); }
    else if (k === 'Home') jump(0);
    else if (k === 'End') jump(slides.length - 1, Infinity);
    else if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    else if (k === 'o' || (k === 'Escape' && overview)) toggleOverview();
    else if (k === 's') window.open(`${location.pathname}?presenter${location.hash}`, 'aurora-presenter', 'width=1400,height=800');
    else if (k === '?') help.classList.toggle('on');
    else if (k === 'Escape') help.classList.remove('on');
  });
  addEventListener('click', (e) => {
    if (e.target.closest('a, .pv') || getSelection()?.toString()) return;
    if (help.classList.contains('on')) { help.classList.remove('on'); return; }
    if (overview) {
      const sl = e.target.closest('.slide');
      if (sl) { state.s = slides.indexOf(sl); state.k = lastStep(state.s); toggleOverview(); }
      return;
    }
    e.clientX < innerWidth * 0.15 ? prev() : next();
  });
  let touchX = null;
  addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) { dx < 0 ? next() : prev(); e.preventDefault(); }
  });

  fit();
  const start = readHash();
  start ? jump(start[0], start[1], !presenter) : jump(0, 0, true);
  // Public API (used by `aurora snapshot` and handy for automation).
  window.aurora = {
    next: () => next(), prev: () => prev(), jump: (s, k) => jump(s, k), state,
    slides: slides.length, steps: (s) => lastStep(s) + 1,
    busy: () => engine.busy(), finish: () => engine.finishAll(),
  };
})();
