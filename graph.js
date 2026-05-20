/* ──────────────────────────────────────────────────────────────
   graph.js — keyword co-occurrence network
   Tweet-to-tweet links via shared vocabulary
   ────────────────────────────────────────────────────────────── */

(function () {
  const NS = "http://www.w3.org/2000/svg";

  // ─── Korean stopwords / short fragments we don't want as nodes ──
  const STOP = new Set([
    "오늘","우리","어제","처음으로","입니다","합니다","함께","위해","대해","같은","것이","것은","것을","것입니다",
    "통해","대한","바랍니다","했습니다","했던","하는","에서","으로","그리고","하지만","있습니다","드립니다",
    "국민","여러분","대한민국","대한국민","관련","하겠습니다","있도록","없도록",
    "수","것","제","저","더","또","와","과","을","를","이","가","은","는","의","에","로","도",
  ]);
  const cleanTerm = (k) => String(k || "")
    .replace(/(입니다|합니다|했습니다|드립니다|하겠습니다|이라는|라는|으로|에서|에게|까지|부터|처럼|보다|이며|이고|하고|하는|했다|한다|하게|들이|들의|으로서|으로써|께서|에게|에는|에도|만큼|조차|마저|은|는|이|가|을|를|의|와|과|도|로)$/g, "")
    .trim();
  const valid = (k) =>
    k && k.length >= 2 && !STOP.has(k) && !/^[0-9]+$/.test(k) && !k.startsWith("http");

  function buildGraph(data, maxNodes = 44) {
    // 1) Aggregate keyword → tweet ids, type counts
    const kwTweets = new Map();
    const kwTypes = new Map();
    data.tweets.forEach((t) => {
      const seen = new Set();
      (t.keywords || []).forEach((raw) => {
        const k = cleanTerm(raw);
        if (!valid(k)) return;
        if (seen.has(k)) return;
        seen.add(k);
        if (!kwTweets.has(k)) kwTweets.set(k, new Set());
        kwTweets.get(k).add(t.id);
        if (!kwTypes.has(k)) kwTypes.set(k, {});
        const tt = kwTypes.get(k);
        tt[t.type] = (tt[t.type] || 0) + 1;
      });
    });

    // 2) Top-N nodes by frequency
    const topKws = [...kwTweets.entries()]
      .map(([k, set]) => ({ k, count: set.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, maxNodes);
    const kwSet = new Set(topKws.map((x) => x.k));

    // 3) Edges = co-occurrence count
    const edges = new Map();
    data.tweets.forEach((t) => {
      const ks = [...new Set((t.keywords || []).map(cleanTerm).filter((k) => kwSet.has(k)))];
      for (let i = 0; i < ks.length; i++) {
        for (let j = i + 1; j < ks.length; j++) {
          const [a, b] = [ks[i], ks[j]].sort();
          const key = a + "\u0000" + b;
          edges.set(key, (edges.get(key) || 0) + 1);
        }
      }
    });

    const edgeList = [...edges.entries()]
      .filter(([, w]) => w >= 2)
      .map(([k, w]) => {
        const [a, b] = k.split("\u0000");
        return { a, b, w };
      })
      .sort((a, b) => b.w - a.w)
      .slice(0, 110);

    // 4) Keep only connected nodes
    const connected = new Set();
    edgeList.forEach((e) => {
      connected.add(e.a);
      connected.add(e.b);
    });
    const nodes = topKws
      .filter((x) => connected.has(x.k))
      .map((x) => {
        const types = kwTypes.get(x.k);
        const dominantType = Object.entries(types).sort((a, b) => b[1] - a[1])[0][0];
        return { id: x.k, count: x.count, type: dominantType, x: 0, y: 0, vx: 0, vy: 0 };
      });

    return { nodes, edges: edgeList };
  }

  function layout(graph, width, height, iterations = 320) {
    const { nodes, edges } = graph;
    if (!nodes.length) return graph;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const cx = width / 2,
      cy = height / 2;

    // Seed: circle
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2;
      n.x = cx + Math.cos(a) * Math.min(width, height) * 0.3;
      n.y = cy + Math.sin(a) * Math.min(width, height) * 0.3;
      n.vx = 0;
      n.vy = 0;
    });

    const REPULSION = 6200;
    const SPRING_LEN = 70;
    const SPRING_K = 0.03;
    const GRAVITY = 0.012;
    const DAMP_BASE = 0.6;

    for (let iter = 0; iter < iterations; iter++) {
      const alpha = Math.max(0.1, 1 - iter / iterations);

      // Repulsion (O(n^2) — small N, fine)
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i],
            b = nodes[j];
          let dx = a.x - b.x,
            dy = a.y - b.y;
          let dist2 = dx * dx + dy * dy + 0.01;
          const dist = Math.sqrt(dist2);
          const f = REPULSION / dist2;
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }

      // Springs (attraction along edges, weighted by co-occurrence)
      edges.forEach((e) => {
        const a = nodeMap.get(e.a),
          b = nodeMap.get(e.b);
        if (!a || !b) return;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const k = SPRING_K * (1 + Math.log(1 + e.w) * 0.4);
        const f = (dist - SPRING_LEN) * k;
        const fx = (dx / dist) * f,
          fy = (dy / dist) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      });

      // Gravity
      nodes.forEach((n) => {
        n.vx += (cx - n.x) * GRAVITY;
        n.vy += (cy - n.y) * GRAVITY;
      });

      // Integrate + damping
      const damp = DAMP_BASE * alpha + 0.2;
      nodes.forEach((n) => {
        n.vx *= damp;
        n.vy *= damp;
        n.x += n.vx * alpha;
        n.y += n.vy * alpha;
        // Clamp inside box
        const pad = 38;
        n.x = Math.max(pad, Math.min(width - pad, n.x));
        n.y = Math.max(pad, Math.min(height - pad, n.y));
      });
    }
    return graph;
  }

  function topicColor(type) {
    return ({
      "정치 메시지":   "#ffa028",
      "정당·국회":     "#4ec9ff",
      "산업·과학기술": "#41d186",
      "교육·돌봄":     "#f5d442",
      "기후·에너지":   "#68e0b0",
      "보건·의료":     "#ff5757",
      "민생·경제":     "#41d186",
      "역사·민주주의": "#b58bff",
      "외교·안보":     "#4ec9ff",
      "지역":          "#f5d442",
      "검증 요청":     "#ff5757",
      "사법·권력기관": "#ff5cd2",
    })[type] || "#ffa028";
  }

  function clientToSvg(svg, cx, cy) {
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return {
      x: ((cx - rect.left) / rect.width) * vb.width,
      y: ((cy - rect.top) / rect.height) * vb.height,
    };
  }

  function render(container, graph, onClick) {
    container.innerHTML = "";
    const rect = container.getBoundingClientRect();
    const W = Math.max(640, rect.width);
    const H = Math.max(420, rect.height || 440);

    layout(graph, W, H);

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", H);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.style.display = "block";

    // Background grid (terminal feel)
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", W);
    bg.setAttribute("height", H);
    bg.setAttribute("fill", "transparent");
    svg.appendChild(bg);

    // Defs (glow)
    const defs = document.createElementNS(NS, "defs");
    defs.innerHTML = `
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>`;
    svg.appendChild(defs);

    // Edges layer
    const edgesG = document.createElementNS(NS, "g");
    edgesG.setAttribute("class", "graph-edges");
    const maxW = Math.max(...graph.edges.map((e) => e.w));
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    graph.edges.forEach((e) => {
      const a = nodeMap.get(e.a),
        b = nodeMap.get(e.b);
      if (!a || !b) return;
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", a.x);
      ln.setAttribute("y1", a.y);
      ln.setAttribute("x2", b.x);
      ln.setAttribute("y2", b.y);
      const op = 0.15 + (e.w / maxW) * 0.55;
      const sw = 0.5 + (e.w / maxW) * 2.5;
      ln.setAttribute("stroke", "#ffa028");
      ln.setAttribute("stroke-opacity", op.toFixed(2));
      ln.setAttribute("stroke-width", sw.toFixed(2));
      ln.dataset.a = e.a;
      ln.dataset.b = e.b;
      edgesG.appendChild(ln);
    });
    svg.appendChild(edgesG);

    // Nodes layer
    const nodesG = document.createElementNS(NS, "g");
    nodesG.setAttribute("class", "graph-nodes");
    const maxCount = Math.max(...graph.nodes.map((n) => n.count));
    graph.nodes.forEach((n) => {
      const g = document.createElementNS(NS, "g");
      g.setAttribute("class", "node");
      g.setAttribute("transform", `translate(${n.x},${n.y})`);
      g.dataset.id = n.id;
      g.style.cursor = "pointer";

      const r = 4 + (n.count / maxCount) * 11;
      const color = topicColor(n.type);

      const halo = document.createElementNS(NS, "circle");
      halo.setAttribute("r", r + 3);
      halo.setAttribute("fill", color);
      halo.setAttribute("fill-opacity", "0.08");
      g.appendChild(halo);

      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("r", r);
      dot.setAttribute("fill", "#000");
      dot.setAttribute("stroke", color);
      dot.setAttribute("stroke-width", 1.5);
      g.appendChild(dot);

      const inner = document.createElementNS(NS, "circle");
      inner.setAttribute("r", Math.max(1.5, r * 0.3));
      inner.setAttribute("fill", color);
      g.appendChild(inner);

      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", r + 5);
      text.setAttribute("y", 3.5);
      text.setAttribute("fill", "#e8ebee");
      text.setAttribute("font-family", "'IBM Plex Sans KR', sans-serif");
      text.setAttribute("font-size", "11");
      text.setAttribute("font-weight", "500");
      text.style.pointerEvents = "none";
      text.textContent = n.id;
      g.appendChild(text);

      const sub = document.createElementNS(NS, "text");
      sub.setAttribute("x", r + 5);
      sub.setAttribute("y", 14.5);
      sub.setAttribute("fill", "#6a727a");
      sub.setAttribute("font-family", "'IBM Plex Mono', monospace");
      sub.setAttribute("font-size", "9");
      sub.setAttribute("letter-spacing", "0.04em");
      sub.style.pointerEvents = "none";
      sub.textContent = `${n.count}`;
      g.appendChild(sub);

      g.addEventListener("mouseenter", () => {
        if (!svg.__dragging) window.__graphHighlight(svg, n.id);
      });
      g.addEventListener("mouseleave", () => {
        if (!svg.__dragging) window.__graphUnhighlight(svg);
      });

      // Drag support
      let dragInfo = null;
      g.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pt = clientToSvg(svg, e.clientX, e.clientY);
        dragInfo = { startX: pt.x, startY: pt.y, nodeStartX: n.x, nodeStartY: n.y, moved: false };
        svg.__dragging = { node: n, info: dragInfo, el: g };
        g.style.cursor = "grabbing";
        window.__graphUnhighlight(svg);
      });

      g.addEventListener("click", (e) => {
        if (dragInfo && dragInfo.moved) {
          e.stopPropagation();
          dragInfo = null;
          return;
        }
        dragInfo = null;
        onClick && onClick(n.id);
      });

      nodesG.appendChild(g);
    });
    svg.appendChild(nodesG);

    // ─── CLUSTER LABELS ── by dominant topic type, drawn at centroid
    const typeNodes = new Map();
    graph.nodes.forEach(n => {
      if (!typeNodes.has(n.type)) typeNodes.set(n.type, []);
      typeNodes.get(n.type).push(n);
    });
    typeNodes.forEach((ns, type) => {
      if (ns.length < 2) return;
      const cx = ns.reduce((s, n) => s + n.x, 0) / ns.length;
      const cy = ns.reduce((s, n) => s + n.y, 0) / ns.length;
      const label = document.createElementNS(NS, "g");
      label.setAttribute("transform", `translate(${cx}, ${cy})`);
      label.setAttribute("class", "cluster-label");
      label.style.pointerEvents = "none";

      const bgText = document.createElementNS(NS, "text");
      bgText.setAttribute("text-anchor", "middle");
      bgText.setAttribute("fill", "#000");
      bgText.setAttribute("stroke", "#000");
      bgText.setAttribute("stroke-width", "4");
      bgText.setAttribute("stroke-linejoin", "round");
      bgText.setAttribute("font-family", "'IBM Plex Sans KR', sans-serif");
      bgText.setAttribute("font-size", "13");
      bgText.setAttribute("font-weight", "700");
      bgText.setAttribute("letter-spacing", ".08em");
      bgText.textContent = `▌ ${type} (${ns.length})`;
      label.appendChild(bgText);

      const fgText = document.createElementNS(NS, "text");
      fgText.setAttribute("text-anchor", "middle");
      fgText.setAttribute("fill", topicColor(type));
      fgText.setAttribute("font-family", "'IBM Plex Sans KR', sans-serif");
      fgText.setAttribute("font-size", "13");
      fgText.setAttribute("font-weight", "700");
      fgText.setAttribute("letter-spacing", ".08em");
      fgText.textContent = `▌ ${type} (${ns.length})`;
      label.appendChild(fgText);

      svg.appendChild(label);
    });

    // Global mousemove + mouseup for drag
    function onMove(e) {
      if (!svg.__dragging) return;
      const { node, info, el } = svg.__dragging;
      const pt = clientToSvg(svg, e.clientX, e.clientY);
      const dx = pt.x - info.startX;
      const dy = pt.y - info.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) info.moved = true;
      node.x = info.nodeStartX + dx;
      node.y = info.nodeStartY + dy;
      el.setAttribute("transform", `translate(${node.x},${node.y})`);
      // Update connected edges
      svg.querySelectorAll(".graph-edges line").forEach(ln => {
        if (ln.dataset.a === node.id) {
          ln.setAttribute("x1", node.x);
          ln.setAttribute("y1", node.y);
        }
        if (ln.dataset.b === node.id) {
          ln.setAttribute("x2", node.x);
          ln.setAttribute("y2", node.y);
        }
      });
    }
    function onUp() {
      if (svg.__dragging) {
        svg.__dragging.el.style.cursor = "pointer";
        svg.__dragging = null;
      }
    }
    svg.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    // Legend
    const legend = document.createElementNS(NS, "g");
    legend.setAttribute("transform", `translate(14, ${H - 18})`);
    const types = ["정당·국회", "민생·경제", "산업·과학기술", "역사·민주주의", "외교·안보", "검증 요청", "정치 메시지"];
    let lx = 0;
    types.forEach((tp) => {
      const grp = document.createElementNS(NS, "g");
      grp.setAttribute("transform", `translate(${lx}, 0)`);
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", 4);
      c.setAttribute("fill", topicColor(tp));
      grp.appendChild(c);
      const txt = document.createElementNS(NS, "text");
      txt.setAttribute("x", 8);
      txt.setAttribute("y", 4);
      txt.setAttribute("fill", "#6a727a");
      txt.setAttribute("font-family", "'IBM Plex Sans KR', sans-serif");
      txt.setAttribute("font-size", "10");
      txt.textContent = tp;
      grp.appendChild(txt);
      legend.appendChild(grp);
      lx += 70 + tp.length * 7;
    });
    svg.appendChild(legend);

    container.appendChild(svg);
  }

  function highlight(svg, id) {
    // delegated to window.__graphHighlight below to use cached values.
  }
  function unhighlight(svg) {
    // delegated to window.__graphUnhighlight below.
  }

  // Better: cache + restore
  function attachEdgeCache(svg) {
    svg.querySelectorAll(".graph-edges line").forEach((ln) => {
      ln.dataset.op = ln.getAttribute("stroke-opacity");
      ln.dataset.sw = ln.getAttribute("stroke-width");
    });
  }
  function restoreEdgeCache(svg) {
    svg.querySelectorAll(".graph-edges line").forEach((ln) => {
      ln.setAttribute("stroke", "#ffa028");
      ln.setAttribute("stroke-opacity", ln.dataset.op);
      ln.setAttribute("stroke-width", ln.dataset.sw);
    });
    svg.querySelectorAll(".graph-nodes .node").forEach((g) => (g.style.opacity = "1"));
  }
  // Hook into highlight/unhighlight properly
  window.__graphHighlight = (svg, id) => {
    if (!svg.dataset.cached) {
      attachEdgeCache(svg);
      svg.dataset.cached = "1";
    }
    const neighbors = new Set([id]);
    svg.querySelectorAll(".graph-edges line").forEach((ln) => {
      if (ln.dataset.a === id || ln.dataset.b === id) {
        ln.setAttribute("stroke", "#ffd200");
        ln.setAttribute("stroke-opacity", "1");
        ln.setAttribute("stroke-width", "2.4");
        neighbors.add(ln.dataset.a);
        neighbors.add(ln.dataset.b);
      } else {
        ln.setAttribute("stroke-opacity", "0.04");
      }
    });
    svg.querySelectorAll(".graph-nodes .node").forEach((g) => {
      g.style.opacity = neighbors.has(g.dataset.id) ? "1" : "0.18";
    });
  };
  window.__graphUnhighlight = (svg) => restoreEdgeCache(svg);

  // Expose
  window.JMNGGraph = { buildGraph, layout, render, topicColor };
})();
