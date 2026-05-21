/* ──────────────────────────────────────────────────────────────
   charts.js — sparklines + stacked-area topic mix
   ────────────────────────────────────────────────────────────── */

(function () {
  const NS = "http://www.w3.org/2000/svg";

  const TYPE_ORDER = [
    "정치 메시지",
    "민생·경제",
    "역사·민주주의",
    "외교·안보",
    "지역",
    "검증 요청",
    "사법·권력기관",
  ];

  const TYPE_COLOR = {
    "정치 메시지":   "#ffa028",
    "민생·경제":     "#41d186",
    "역사·민주주의": "#b58bff",
    "외교·안보":     "#4ec9ff",
    "지역":          "#f5d442",
    "검증 요청":     "#ff5757",
    "사법·권력기관": "#ff5cd2",
  };

  function sparkline(values, opts = {}) {
    const { w = 96, h = 22, color = "#ffa028", fill = true, labels = [], valueFormatter = v => String(v), name = "" } = opts;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.style.display = "block";
    svg.style.overflow = "visible";
    if (!values || values.length < 2) return svg;

    const max = Math.max(...values, 1);
    const n = values.length;
    const pts = values.map((v, i) => {
      const x = (i / (n - 1)) * w;
      const y = h - (v / max) * (h - 3) - 1.5;
      return [x, y];
    });
    const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");

    if (fill) {
      const f = document.createElementNS(NS, "path");
      f.setAttribute("d", path + ` L${w},${h} L0,${h} Z`);
      f.setAttribute("fill", color);
      f.setAttribute("fill-opacity", "0.16");
      svg.appendChild(f);
    }
    const line = document.createElementNS(NS, "path");
    line.setAttribute("d", path);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1.4");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);

    const hoverLine = document.createElementNS(NS, "line");
    hoverLine.setAttribute("y1", 1);
    hoverLine.setAttribute("y2", h - 1);
    hoverLine.setAttribute("stroke", color);
    hoverLine.setAttribute("stroke-width", "1");
    hoverLine.setAttribute("stroke-opacity", "0");
    svg.appendChild(hoverLine);

    const last = pts[pts.length - 1];
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", last[0]);
    dot.setAttribute("cy", last[1]);
    dot.setAttribute("r", "2");
    dot.setAttribute("fill", color);
    svg.appendChild(dot);

    pts.forEach(([x, y], i) => {
      const hit = document.createElementNS(NS, "circle");
      hit.setAttribute("cx", x);
      hit.setAttribute("cy", y);
      hit.setAttribute("r", "5.5");
      hit.setAttribute("fill", color);
      hit.setAttribute("fill-opacity", "0");
      hit.style.cursor = "crosshair";
      const title = document.createElementNS(NS, "title");
      const label = labels[i] || `#${i + 1}`;
      title.textContent = `${label} · ${name ? `${name} ` : ""}${valueFormatter(values[i])}`;
      hit.appendChild(title);
      hit.addEventListener("mouseenter", () => {
        hoverLine.setAttribute("x1", x);
        hoverLine.setAttribute("x2", x);
        hoverLine.setAttribute("stroke-opacity", "0.65");
        hit.setAttribute("fill-opacity", "0.95");
      });
      hit.addEventListener("mouseleave", () => {
        hoverLine.setAttribute("stroke-opacity", "0");
        hit.setAttribute("fill-opacity", "0");
      });
      svg.appendChild(hit);
    });

    return svg;
  }

  function stackedArea(monthly, opts = {}) {
    const { width = 880, height = 220, onMonthClick, events = [] } = opts;
    const N = monthly.length;
    const totals = monthly.map(([, counts]) =>
      TYPE_ORDER.reduce((s, t) => s + (counts[t] || 0), 0)
    );
    const maxTotal = Math.max(...totals, 1);

    const pad = { top: 14, right: 12, bottom: 28, left: 38 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const xFor = i => pad.left + (i / (N - 1 || 1)) * innerW;
    const yFor = v => pad.top + innerH - (v / maxTotal) * innerH;

    const cum = monthly.map(([, counts]) => {
      let acc = 0;
      return TYPE_ORDER.map(t => (acc += counts[t] || 0));
    });

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", height);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.display = "block";

    // Y grid + labels
    const gridSteps = 4;
    for (let i = 0; i <= gridSteps; i++) {
      const yVal = (maxTotal / gridSteps) * i;
      const y = yFor(yVal);
      const ln = document.createElementNS(NS, "line");
      ln.setAttribute("x1", pad.left); ln.setAttribute("x2", width - pad.right);
      ln.setAttribute("y1", y); ln.setAttribute("y2", y);
      ln.setAttribute("stroke", "#1f262c");
      ln.setAttribute("stroke-dasharray", "2,3");
      svg.appendChild(ln);
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", pad.left - 6); t.setAttribute("y", y + 3);
      t.setAttribute("text-anchor", "end");
      t.setAttribute("fill", "#4a5159");
      t.setAttribute("font-family", "'IBM Plex Mono', monospace");
      t.setAttribute("font-size", "9");
      t.textContent = Math.round(yVal);
      svg.appendChild(t);
    }

    // Stacked area paths (bottom→top)
    TYPE_ORDER.forEach((type, ti) => {
      let d = "";
      for (let i = 0; i < N; i++) {
        d += (i ? "L" : "M") + xFor(i).toFixed(1) + "," + yFor(cum[i][ti]).toFixed(1);
      }
      for (let i = N - 1; i >= 0; i--) {
        const bottom = ti === 0 ? 0 : cum[i][ti - 1];
        d += "L" + xFor(i).toFixed(1) + "," + yFor(bottom).toFixed(1);
      }
      d += "Z";
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("fill", TYPE_COLOR[type]);
      p.setAttribute("fill-opacity", "0.82");
      p.setAttribute("stroke", "#0b0e10");
      p.setAttribute("stroke-width", "0.4");
      p.dataset.type = type;
      p.style.transition = "fill-opacity .15s";
      p.addEventListener("mouseenter", () => {
        svg.querySelectorAll("path[data-type]").forEach(pp => {
          pp.setAttribute("fill-opacity", pp.dataset.type === type ? "1" : "0.22");
        });
      });
      p.addEventListener("mouseleave", () => {
        svg.querySelectorAll("path[data-type]").forEach(pp => pp.setAttribute("fill-opacity", "0.82"));
      });
      svg.appendChild(p);
    });

    // X-axis: month labels + totals + click targets
    monthly.forEach(([month], i) => {
      const x = xFor(i);
      const [y, m] = month.split("-");
      const lbl = document.createElementNS(NS, "text");
      lbl.setAttribute("x", x); lbl.setAttribute("y", height - pad.bottom + 14);
      lbl.setAttribute("text-anchor", "middle");
      lbl.setAttribute("fill", "#6a727a");
      lbl.setAttribute("font-family", "'IBM Plex Mono', monospace");
      lbl.setAttribute("font-size", "9");
      lbl.textContent = m;
      svg.appendChild(lbl);

      if (i === 0 || m === "01" || i === N - 1) {
        const yr = document.createElementNS(NS, "text");
        yr.setAttribute("x", x); yr.setAttribute("y", height - pad.bottom + 24);
        yr.setAttribute("text-anchor", "middle");
        yr.setAttribute("fill", "#4a5159");
        yr.setAttribute("font-family", "'IBM Plex Mono', monospace");
        yr.setAttribute("font-size", "8");
        yr.textContent = y;
        svg.appendChild(yr);
      }

      const tot = document.createElementNS(NS, "text");
      tot.setAttribute("x", x); tot.setAttribute("y", yFor(totals[i]) - 5);
      tot.setAttribute("text-anchor", "middle");
      tot.setAttribute("fill", "#e8ebee");
      tot.setAttribute("font-family", "'IBM Plex Mono', monospace");
      tot.setAttribute("font-size", "10");
      tot.setAttribute("font-weight", "500");
      tot.textContent = totals[i];
      svg.appendChild(tot);

      if (onMonthClick) {
        const click = document.createElementNS(NS, "rect");
        const colW = innerW / Math.max(1, N - 1);
        click.setAttribute("x", x - colW / 2);
        click.setAttribute("y", pad.top);
        click.setAttribute("width", colW);
        click.setAttribute("height", innerH);
        click.setAttribute("fill", "transparent");
        click.style.cursor = "pointer";
        const title = document.createElementNS(NS, "title");
        const topTypes = Object.entries(monthly[i][1] || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([type, count]) => `${type} ${count}`)
          .join(" · ");
        title.textContent = `${month} · 총 ${totals[i]}건${topTypes ? ` · ${topTypes}` : ""}`;
        click.appendChild(title);
        click.addEventListener("click", () => onMonthClick(month));
        svg.appendChild(click);
      }
    });

    // ─── EVENT MARKERS ── vertical dashed lines + labels
    if (events && events.length) {
      const monthIndex = Object.fromEntries(monthly.map((m, i) => [m[0], i]));
      events.forEach(ev => {
        if (!ev.date) return;
        const [y, m, d] = ev.date.split("-").map(Number);
        const mKey = `${y}-${String(m).padStart(2, "0")}`;
        const mi = monthIndex[mKey];
        if (mi === undefined) return;
        const daysInMonth = new Date(y, m, 0).getDate();
        const frac = (d - 1) / daysInMonth;
        const x = xFor(mi + frac);

        const ln = document.createElementNS(NS, "line");
        ln.setAttribute("x1", x); ln.setAttribute("x2", x);
        ln.setAttribute("y1", pad.top); ln.setAttribute("y2", height - pad.bottom + 4);
        ln.setAttribute("stroke", ev.color || "#f5d442");
        ln.setAttribute("stroke-width", "1");
        ln.setAttribute("stroke-dasharray", "3,3");
        ln.setAttribute("stroke-opacity", "0.7");
        svg.appendChild(ln);

        // Marker dot at top
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", pad.top);
        dot.setAttribute("r", 3.5);
        dot.setAttribute("fill", ev.color || "#f5d442");
        dot.setAttribute("stroke", "#0b0e10");
        dot.setAttribute("stroke-width", 1);
        svg.appendChild(dot);

        // Label background + text
        const lbl = document.createElementNS(NS, "text");
        lbl.setAttribute("x", x + 5);
        lbl.setAttribute("y", pad.top + 4);
        lbl.setAttribute("fill", ev.color || "#f5d442");
        lbl.setAttribute("font-family", "'IBM Plex Sans KR', sans-serif");
        lbl.setAttribute("font-size", "10");
        lbl.setAttribute("font-weight", "500");
        lbl.setAttribute("paint-order", "stroke");
        lbl.setAttribute("stroke", "#0b0e10");
        lbl.setAttribute("stroke-width", "3");
        lbl.setAttribute("stroke-linejoin", "round");
        lbl.textContent = ev.label;
        svg.appendChild(lbl);
      });
    }

    return svg;
  }

  window.JMNGCharts = { sparkline, stackedArea, TYPE_ORDER, TYPE_COLOR };
})();
