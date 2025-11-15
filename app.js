// === Sabitler ===
const RACES = [
  "Elf", "Human", "Dwarf", "Hobbit", "Maiar", "Vala",
  "Half-elf", "Dragon", "Spirit", "Spider-Spirit", "Spider", "Ent", "Unknown"
];

const raceStyles = {
  "Elf":          { "fill": "#8FBFE0", "stroke": "#1A3A55", "strokeWidth": 2 },
  "Human":        { "fill": "#E7C7A4", "stroke": "#5A3C20", "strokeWidth": 2 },
  "Dwarf":        { "fill": "#6A5E59", "stroke": "#F2E9CE", "strokeWidth": 2 },
  "Hobbit":       { "fill": "#D97C7C", "stroke": "#5A1E1E", "strokeWidth": 2 },
  "Maiar":        { "fill": "#F2ECAA", "stroke": "#A48B00", "strokeWidth": 2 },
  "Vala":         { "fill": "#D6A122", "stroke": "#4A3300", "strokeWidth": 2 },
  "Half-elf":     { "fill": "#B7A8FF", "stroke": "#3D316F", "strokeWidth": 2 },
  "Dragon":       { "fill": "#922121", "stroke": "#F2A23A", "strokeWidth": 2 },
  "Spirit":       { "fill": "#82D1C9", "stroke": "#1F5C56", "strokeWidth": 2 },
  "Spider-Spirit":{ "fill": "#6B2B6B", "stroke": "#C46CC4", "strokeWidth": 2 },
  "Spider":       { "fill": "#502050", "stroke": "#A35EA3", "strokeWidth": 2 },
  "Ent":          { "fill": "#8A6F4A", "stroke": "#3A2B1A", "strokeWidth": 2 },
  "Unknown":      { "fill": "#BBBBBB", "stroke": "#444444", "strokeWidth": 2 }
};

// === DOM referansları ===
const svg = d3.select("#graph");
const detail = document.getElementById("detailBody");
const closeBtn = document.getElementById("closeDetail");
const panel = document.getElementById("detail");
const toggleBtn = document.getElementById("togglePanel");
const main = document.querySelector(".app-main");

// Search
const searchInput = document.getElementById("searchInput");
const suggestions = document.getElementById("suggestions");

// Filter
const filterToggle = document.getElementById("filterToggle");
const filterPanel = document.getElementById("filterPanel");
const closeFilter = document.getElementById("closeFilter");
const raceFilters = document.getElementById("raceFilters");
const relationFilter = document.getElementById("relationFilter");
const relationTypeFilters = document.getElementById("relationTypeFilters");

// Globals
let nodes, links, sim, node, link;
let infoData = {};
let detailsData = {};
let warsData = {};
let eventsData = {};
let selectedNodeId = null;
let currentZoom = d3.zoomIdentity;

// Minimap
let minimapSvg, miniG, viewportBox;
let minimapScale = 1;
let bounds = { xExtent: [0, 0], yExtent: [0, 0] };

// Filters
let activeRaces = new Set(RACES);
let activeRelation = "all";
let activeRelationTypes = new Set();

// === SVG boyutlandırma ===
function sizeSvg() {
  const h = window.innerHeight - document.querySelector(".app-header").offsetHeight;
  svg.attr("width", window.innerWidth).attr("height", h);
}
window.addEventListener("resize", sizeSvg);
sizeSvg();

// Reposition minimap on resize as panel widths/layout may change on mobile
window.addEventListener("resize", repositionMinimap);

// === Zoom ===
const g = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.5, 2.5])
  .on("zoom", e => {
    currentZoom = e.transform;
    g.attr("transform", currentZoom);
    updateViewportBox();
  });
svg.call(zoom);

// === Veriler ===
Promise.all([
  d3.json("data.json"),
  d3.json("inf.json").catch(() => ({})),
  d3.json("detail.json").catch(() => ({})),
  d3.json("war.json").catch(() => ({})),
  d3.json("events.json").catch(() => ({}))
]).then(([data, info, details, wars, events]) => {
  nodes = data.nodes;
  links = data.links;
  infoData = info;
  detailsData = details;
  warsData = wars || {};
  eventsData = events || {};

  // === Connected Component hesaplama ===
  function computeComponents() {
    const visited = new Set();
    const comps = [];

    nodes.forEach(n => {
      if (!visited.has(n.id)) {
        const stack = [n];
        const comp = [];
        visited.add(n.id);

        while (stack.length) {
          const cur = stack.pop();
          comp.push(cur);

          links.forEach(l => {
            if (l.source === cur.id && !visited.has(l.target)) {
              visited.add(l.target);
              stack.push(nodes.find(n => n.id === l.target));
            }
            if (l.target === cur.id && !visited.has(l.source)) {
              visited.add(l.source);
              stack.push(nodes.find(n => n.id === l.source));
            }
          });
        }
        comps.push(comp);
      }
    });
    return comps;
  }

  const components = computeComponents();
  const mainComponent = components.reduce((a, b) => (a.length > b.length ? a : b));

  // === Force sim ===
  sim = d3.forceSimulation(nodes)
    // Bağların daha az iç içe girmesi için mesafe ve itme artırıldı
    .force("link", d3.forceLink(links).id(d => d.id).distance(110).strength(0.6))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("collision", d3.forceCollide().radius(22))
    .force("center", d3.forceCenter(window.innerWidth / 2, window.innerHeight / 2).strength(0.1))

    // === Component Gravity (alt grupları ana gruba yaklaştırır) ===
    .force("componentGravity", alpha => {
      const mainCx = d3.mean(mainComponent, d => d.x);
      const mainCy = d3.mean(mainComponent, d => d.y);

      components.forEach(comp => {
        if (comp === mainComponent) return;

        const cx = d3.mean(comp, d => d.x);
        const cy = d3.mean(comp, d => d.y);

        comp.forEach(n => {
          n.vx += (mainCx - cx) * 0.02 * alpha;
          n.vy += (mainCy - cy) * 0.02 * alpha;
        });
      });
    });

  // === Çizim ===
  link = g.append("g").selectAll("line")
    .data(links).join("line")
    .attr("class", d => `link ${relationClass(d)}`);

  node = g.append("g").selectAll("g.node")
    .data(nodes).join("g")
    .attr("class", "node")
    .call(drag(sim));

  node.append("circle")
    .attr("r", 12)
    .attr("fill", d => raceStyles[d.race]?.fill || "#CCC")
    .attr("stroke", d => raceStyles[d.race]?.stroke || "#111")
    .attr("stroke-width", 2);

  node.append("text")
    .attr("class", "label")
    .attr("y", -16)
    .attr("text-anchor", "middle")
    .text(d => d.id);

  node.on("click", (_, d) => showDetails(d));

  sim.on("tick", () => {
    link.attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  sim.on("end", initMinimap);

  buildFilters();
  initSearch();
  initRandom();
  initBottomBanner();
  initConsoleAscii();
});

// ------------------------------------------------------
// === SEARCH ===
// ------------------------------------------------------
function initSearch() {
  let currentIndex = -1;

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    currentIndex = -1;

    if (!q) return (suggestions.style.display = "none");

    const results = nodes.filter(n =>
      n.id.toLowerCase().includes(q)
    ).slice(0, 12);

    if (!results.length)
      return (suggestions.style.display = "none");

    suggestions.innerHTML = results
      .map(n => `<li data-id="${n.id}">${n.id}</li>`)
      .join("");

    suggestions.style.display = "block";
  });

  suggestions.addEventListener("click", e => {
    if (e.target.tagName !== "LI") return;
    selectById(e.target.dataset.id);
  });

  searchInput.addEventListener("keydown", e => {
    const items = Array.from(suggestions.querySelectorAll("li"));
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      currentIndex = (currentIndex + 1) % items.length;
      highlight(items, currentIndex);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      currentIndex = (currentIndex - 1 + items.length) % items.length;
      highlight(items, currentIndex);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (currentIndex >= 0) items[currentIndex].click();
    }
    if (e.key === "Escape") {
      suggestions.style.display = "none";
    }
  });

  function selectById(id) {
    const d = nodes.find(n => n.id === id);
    if (!d) return;
    focusNode(d);
    searchInput.value = d.id;
    suggestions.style.display = "none";
  }

  function highlight(items, idx) {
    items.forEach(i => i.classList.remove("active"));
    if (idx >= 0) {
      items[idx].classList.add("active");
      // Ensure the active item is visible while navigating with arrows
      items[idx].scrollIntoView({ block: "nearest" });
    }
  }
}

// ------------------------------------------------------
// === Fokus Node ===
// ------------------------------------------------------
function focusNode(d) {
  const t = d3.zoomIdentity
    .translate(window.innerWidth / 2 - d.x * 1.4,
               (window.innerHeight / 2 - 60) - d.y * 1.4)
    .scale(1.4);

  svg.transition().duration(350).call(zoom.transform, t);

  showDetails(d);
}

// ------------------------------------------------------
// === Detay Paneli ===
// ------------------------------------------------------
function showDetails(d) {
  selectedNodeId = d.id;
  if (node) {
    node.classed("selected", n => n.id === selectedNodeId);
  }

  const connections = links.filter(
    l => l.source.id === d.id || l.target.id === d.id
  ).map(l => {
    const other = l.source.id === d.id ? l.target.id : l.source.id;
    return `<li class="conn-item" data-id="${other}"><span class="conn-name">${other}</span> <span class="relation-type">${l.relation}</span></li>`;
  }).join("");

  const info = infoData[d.id] || "";
  const extra = detailsData[d.id] || null;

  const meta = [];
  meta.push({ label: "Irk:", value: d.race || "—" });
  meta.push({ label: "Hane:", value: d.house || "—" });
  if (extra && (extra.birth || extra.death)) {
    if (extra.birth) meta.push({ label: "Doğum:", value: extra.birth });
    if (extra.death) meta.push({ label: "Ölüm:", value: extra.death });
  }

  const metaGrid = `
    <div class="meta-grid">
      ${meta.map(m => `
        <div class="meta-label">${m.label}</div>
        <div class="meta-value">${m.value}</div>
      `).join("")}
    </div>
  `;

  const eventsHtml = extra && Array.isArray(extra.major_events) && extra.major_events.length
    ? `
      <div class="char-section">
        <h3>Öne Çıkan Olaylar:</h3>
        <ul>
          ${extra.major_events.map(e => `<li>${e}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  const warsHtml = extra && Array.isArray(extra.wars) && extra.wars.length
    ? `
      <div class="char-section">
        <h3>Savaşlar:</h3>
        <ul class="war-list">
          ${extra.wars.map(w => `<li class="war-item" data-war="${w}">${w}</li>`).join("")}
        </ul>
      </div>
    `
    : "";

  const connectionsHtml = connections
    ? `
      <div class="char-section">
        <h3>Bağlantılar:</h3>
        <ul class="connections-list">${connections}</ul>
      </div>
    `
    : "";

  detail.innerHTML = `
    ${d.img ? `<div class="char-image"><img src="${d.img}" alt="${d.id}"/></div>` : ""}
    <h2>${d.id}</h2>
    ${metaGrid}
    ${info ? `<div class="char-info">${info}</div>` : ""}
    ${eventsHtml}
    ${warsHtml}
    ${connectionsHtml}
  `;

  panel.classList.remove("hidden");
  main.classList.remove("fullwidth");
  repositionMinimap();
}

// Sidebar connection click → jump to that character
detail.addEventListener('click', e => {
  const connItem = e.target.closest('.conn-item');
  if (connItem) {
    const id = connItem.getAttribute('data-id');
    if (id) jumpToNodeById(id);
    return;
  }

  const eventItem = e.target.closest('.event-item');
  if (eventItem) {
    const eventName = eventItem.getAttribute('data-event');
    if (!eventName) return;

    const ev = eventsData && eventsData[eventName] ? eventsData[eventName] : {};

    const meta = [];
    if (ev.age) meta.push({ label: "��a�Y:", value: ev.age });
    if (ev.period) meta.push({ label: "D��nem:", value: ev.period });
    if (ev.type) meta.push({ label: "TǬr:", value: ev.type });
    if (ev.outcome) meta.push({ label: "Sonu��:", value: ev.outcome });

    const metaGrid = meta.length
      ? `
        <div class="meta-grid">
          ${meta.map(m => `
            <div class="meta-label">${m.label}</div>
            <div class="meta-value">${m.value}</div>
          `).join("")}
        </div>
      `
      : "";

    const summaryHtml = ev.summary
      ? `<div class="char-info">${ev.summary}</div>`
      : "";

    const participants = Object.entries(detailsData || {})
      .filter(([, extra]) => extra && Array.isArray(extra.major_events) && extra.major_events.includes(eventName))
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b));

    const participantsHtml = participants.length
      ? `
        <div class="char-section">
          <h3>Kat��lanlar:</h3>
          <ul class="war-participants">
            ${participants.map(p => `<li class="war-participant" data-id="${p}">${p}</li>`).join("")}
          </ul>
        </div>
      `
      : "";

    detail.innerHTML = `
      <h2>${eventName}</h2>
      ${metaGrid}
      ${summaryHtml}
      ${participantsHtml}
    `;

    panel.classList.remove("hidden");
    main.classList.remove("fullwidth");
    repositionMinimap();
    return;
  }

  const warItem = e.target.closest('.war-item');
  if (warItem) {
    const warName = warItem.getAttribute('data-war');
    if (!warName) return;

    const war = warsData && warsData[warName] ? warsData[warName] : {};

    const meta = [];
    if (war.age) meta.push({ label: "Çağ:", value: war.age });
    if (war.period) meta.push({ label: "Dönem:", value: war.period });
    if (war.type) meta.push({ label: "Tür:", value: war.type });
    if (war.outcome) meta.push({ label: "Sonuç:", value: war.outcome });

    const metaGrid = meta.length
      ? `
        <div class="meta-grid">
          ${meta.map(m => `
            <div class="meta-label">${m.label}</div>
            <div class="meta-value">${m.value}</div>
          `).join("")}
        </div>
      `
      : "";

    const summaryHtml = war.summary
      ? `<div class="char-info">${war.summary}</div>`
      : "";

    const participants = Object.entries(detailsData || {})
      .filter(([, extra]) => extra && Array.isArray(extra.wars) && extra.wars.includes(warName))
      .map(([id]) => id)
      .sort((a, b) => a.localeCompare(b));

    const participantsHtml = participants.length
      ? `
        <div class="char-section">
          <h3>Katılanlar:</h3>
          <ul class="war-participants">
            ${participants.map(p => `<li class="war-participant" data-id="${p}">${p}</li>`).join("")}
          </ul>
        </div>
      `
      : "";

    detail.innerHTML = `
      <h2>${warName}</h2>
      ${metaGrid}
      ${summaryHtml}
      ${participantsHtml}
    `;

    panel.classList.remove("hidden");
    main.classList.remove("fullwidth");
    repositionMinimap();
    return;
  }

  const participantItem = e.target.closest('.war-participant');
  if (participantItem) {
    const pid = participantItem.getAttribute('data-id');
    if (pid) jumpToNodeById(pid);
  }
});

function jumpToNodeById(id) {
  const d = nodes.find(n => n.id === id);
  if (!d) return;
  ensureRaceForNode(d);
  focusNode(d);
}

function ensureRaceForNode(d) {
  if (activeRaces.has(d.race)) return;
  const inputs = raceFilters ? Array.from(raceFilters.querySelectorAll('input[type="checkbox"]')) : [];
  inputs.forEach(cb => {
    if (cb.value === d.race) cb.checked = true;
  });
  activeRaces.add(d.race);
  updateFilters();
}

closeBtn.onclick = () => {
  panel.classList.add("hidden");
  main.classList.add("fullwidth");
  repositionMinimap();
};

toggleBtn.onclick = () => {
  panel.classList.toggle("hidden");
  main.classList.toggle("fullwidth");
  repositionMinimap();
};

// ------------------------------------------------------
// DRAG
// ------------------------------------------------------
function drag(sim) {
  return d3.drag()
    .on("start", (e, d) => {
      if (!e.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on("drag", (e, d) => {
      d.fx = e.x; d.fy = e.y;
    })
    .on("end", (e, d) => {
      if (!e.active) sim.alphaTarget(0);
      d.fx = d.fy = null;
    });
}

// ------------------------------------------------------
// RANDOM CHARACTER JUMP
// ------------------------------------------------------
function initRandom() {
  const btn = document.getElementById("randomChar");
  if (!btn) return;
  btn.onclick = () => {
    // Prefer currently visible nodes (respecting filters)
    let visible = [];
    try {
      visible = nodes.filter((d, i) => node.nodes()[i].style.display !== "none");
    } catch (_) {
      visible = [];
    }
    const pool = (visible && visible.length) ? visible : nodes || [];
    if (!pool.length) return;
    const d = pool[Math.floor(Math.random() * pool.length)];
    focusNode(d);
  };
}

// ------------------------------------------------------
// === FİLTRE ===
// ------------------------------------------------------
  function buildFilters() {
    // Build race filters dynamically from data to avoid hiding unknown races
    const allRaces = Array.from(new Set((nodes || []).map(n => n.race))).sort();
  raceFilters.innerHTML = "";
  allRaces.forEach(r => {
    const lbl = document.createElement("label");
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.value = r;
    inp.checked = true;
    inp.onchange = updateFilters;
    lbl.append(inp, " " + r);
    raceFilters.append(lbl);
  });
    activeRaces = new Set(allRaces);

    // Build relation category (ba�Y tǬrǬ) options
    if (relationFilter) {
      relationFilter.innerHTML = `
        <option value="all">Hepsi</option>
        <option value="kinship">Kinship</option>
        <option value="fellowship">Fellowship</option>
        <option value="master-servant">Master\u2013Servant</option>
        <option value="enemy">Enemy</option>
        <option value="historical">Historical Influence</option>
        <option value="romantic">Romantic</option>
        <option value="alliance">Alliance</option>
      `;
    }
  
    relationFilter.onchange = e => {
      activeRelation = e.target.value;
      updateFilters();
    };

  // Build relation type multi-select checkboxes based on data
  if (relationTypeFilters) {
    const types = Array.from(new Set(
      (links || []).map(l => (l.relation || "").trim()).filter(Boolean)
    )).sort();
    relationTypeFilters.innerHTML = "";
    types.forEach(t => {
      const lbl = document.createElement("label");
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.value = t;
      inp.checked = true;
      inp.onchange = updateFilters;
      lbl.append(inp, " " + t);
      relationTypeFilters.append(lbl);
    });
    activeRelationTypes = new Set(types);
  }

  filterToggle.onclick = () => filterPanel.classList.toggle("hidden");
  closeFilter.onclick = () => filterPanel.classList.add("hidden");

  // Wire actions for multi-select groups
  setupMultiSelectActions();
}

function updateFilters() {
  activeRaces = new Set(
    [...raceFilters.querySelectorAll("input:checked")].map(i => i.value)
  );

  // Active relation types (from checkboxes). If none, it will filter out all relations
  if (relationTypeFilters) {
    activeRelationTypes = new Set(
      [...relationTypeFilters.querySelectorAll("input:checked")].map(i => i.value)
    );
  }

    const visibleLinks = links.filter(l => {
      const cls = relationClass(l);
    const relMatch = activeRelation === "all" || activeRelation === cls;
    const relType = (l.relation || "").trim();
    const typeMatch = !relationTypeFilters || activeRelationTypes.has(relType);
    return relMatch && typeMatch &&
      activeRaces.has(l.source.race) &&
      activeRaces.has(l.target.race);
  });

  // Show nodes purely by race selection; links are filtered above
  node.style("display", d => activeRaces.has(d.race) ? null : "none");
  link.style("display", l => visibleLinks.includes(l) ? null : "none");

  updateMinimap();
}

// Add handlers for Hepsini Seç / Hepsini Kaldır in multi-select groups
function setupMultiSelectActions() {
  document.querySelectorAll('.multiselect-actions').forEach(bar => {
    const targetId = bar.getAttribute('data-for');
    const container = document.getElementById(targetId);
    if (!container) return;
    const sel = bar.querySelector('[data-action="select-all"]');
    const clr = bar.querySelector('[data-action="clear-all"]');
    if (sel) sel.onclick = () => {
      container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
      updateFilters();
    };
    if (clr) clr.onclick = () => {
      container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
      updateFilters();
    };
  });
}

// ------------------------------------------------------
// === MINIMAP ===
// ------------------------------------------------------
function initMinimap() {
  const box = d3.select("#minimap");
  box.selectAll("*").remove();

  minimapSvg = box.append("svg").attr("width", 180).attr("height", 130);
  miniG = minimapSvg.append("g");

  viewportBox = minimapSvg.append("rect")
    .attr("class", "minimap-viewport")
    .attr("stroke", "#CC3355")
    .attr("fill", "none")
    .attr("stroke-width", 2);

  updateMinimap();
  updateViewportBox();

  viewportBox.call(
    d3.drag().on("drag", e => moveMainView(e.x, e.y))
  );
}

function updateMinimap() {
  const visible = nodes.filter((d, i) => node.nodes()[i].style.display !== "none");
  if (!visible.length) return;

  const xExt = d3.extent(visible, d => d.x);
  const yExt = d3.extent(visible, d => d.y);

  bounds = { xExtent: xExt, yExtent: yExt };

  const mapW = 180, mapH = 130;
  minimapScale = Math.min(
    mapW / (xExt[1] - xExt[0]),
    mapH / (yExt[1] - yExt[0])
  ) * 0.9;

  miniG.selectAll("*").remove();

  miniG.selectAll("line")
    .data(links).join("line")
    .attr("x1", d => (d.source.x - xExt[0]) * minimapScale)
    .attr("y1", d => (d.source.y - yExt[0]) * minimapScale)
    .attr("x2", d => (d.target.x - xExt[0]) * minimapScale)
    .attr("y2", d => (d.target.y - yExt[0]) * minimapScale)
    .attr("stroke", "#777")
    .attr("stroke-opacity", 0.4);

  miniG.selectAll("circle")
    .data(visible).join("circle")
    .attr("cx", d => (d.x - xExt[0]) * minimapScale)
    .attr("cy", d => (d.y - yExt[0]) * minimapScale)
    .attr("r", 2)
    .attr("fill", "#ccc");

  miniG.attr("transform", "translate(5,5)");
}

function updateViewportBox() {
  if (!viewportBox) return;

  const mapOffset = 5;
  const viewW = (window.innerWidth) / currentZoom.k * minimapScale;
  const viewH = (window.innerHeight - 60) / currentZoom.k * minimapScale;

  const offsetX = (-currentZoom.x / currentZoom.k - bounds.xExtent[0]) * minimapScale;
  const offsetY = (-currentZoom.y / currentZoom.k - bounds.yExtent[0]) * minimapScale;

  viewportBox
    .attr("x", mapOffset + offsetX)
    .attr("y", mapOffset + offsetY)
    .attr("width", viewW)
    .attr("height", viewH);
}

function moveMainView(mx, my) {
  const mapOffset = 5;
  const cx = (mx - mapOffset) / minimapScale + bounds.xExtent[0];
  const cy = (my - mapOffset) / minimapScale + bounds.yExtent[0];

  const tx = window.innerWidth / 2 - cx * currentZoom.k;
  const ty = (window.innerHeight / 2 - 60) - cy * currentZoom.k;

  const t = d3.zoomIdentity.translate(tx, ty).scale(currentZoom.k);

  svg.transition().duration(50).call(zoom.transform, t);
}

// ------------------------------------------------------
function repositionMinimap() {
  const mini = document.getElementById("minimap");
  if (!mini) return;
  const isHidden = panel.classList.contains("hidden");
  if (isHidden) {
    mini.style.right = "12px";
    return;
  }
  const panelRect = panel.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth;
  // If the panel is effectively full-width (mobile), keep minimap at edge
  if (panelRect.width >= vw - 24) {
    mini.style.right = "12px";
  } else {
    mini.style.right = `${Math.round(panelRect.width + 20)}px`;
  }
}

// ------------------------------------------------------
function relationClass(link) {
    if (!link) return "alliance";

    // Explicit bondType from JSON, if present
    if (link.bondType) return link.bondType;

    const r = (link.relation || "").toLowerCase();

    // Enemy / antagonistic
    if (r.includes("enemy") || r.includes("betrayal")) return "enemy";

    // Master–Servant / hierarchical
    if (r.includes("master/servant") || r.includes("servant/") || r.includes("king/liege")) {
      return "master-servant";
    }

    // Romantic bonds
    if (r.includes("spouse")) return "romantic";

    // Fellowship / close companions
    if (r.includes("friend")) return "fellowship";

    // Kinship (family relations)
    if (
      r.includes("father") ||
      r.includes("mother") ||
      r.includes("daughter") ||
      r.includes("son") ||
      r.includes("siblings") ||
      r.includes("half-brothers") ||
      r.includes("uncle") ||
      r.includes("niece") ||
      r.includes("nephew") ||
      r.includes("cousin")
    ) {
      return "kinship";
    }

    // Historical influence (ancestry, heirs, notable legacy)
    if (
      r.includes("ancestor") ||
      r.includes("descendant") ||
      r.includes("lineage") ||
      r.includes("heir")
    ) {
      return "historical";
    }

    // Alliances, default positive ties
    if (r.includes("ally")) return "alliance";

    // Fallback
    return "alliance";
  }

// ------------------------------------------------------
// === BOTTOM BANNER (LocalStorage persist) ===
// ------------------------------------------------------
function initBottomBanner() {
  const banner = document.getElementById("bottomBanner");
  if (!banner) return;
  const close = document.getElementById("closeBanner");
  const dismissed = localStorage.getItem("bottomBannerDismissed") === "1";
  if (!dismissed) {
    banner.style.display = "flex";
  }
  if (close) {
    close.addEventListener("click", () => {
      banner.style.display = "none";
      try { localStorage.setItem("bottomBannerDismissed", "1"); } catch (_) {}
    });
  }
}

// ------------------------------------------------------
// === CONSOLE ASCII ART ===
// ------------------------------------------------------
function initConsoleAscii() {
  const art = `
████████╗██╗  ██╗███████╗     ██████╗ ███╗   ██╗███████╗    ██╗    ██╗ █████╗ ███╗   ██╗██████╗ 
╚══██╔══╝██║  ██║██╔════╝    ██╔═══██╗████╗  ██║██╔════╝    ██║    ██║██╔══██╗████╗  ██║██╔══██╗
   ██║   ███████║█████╗      ██║   ██║██╔██╗ ██║█████╗      ██║ █╗ ██║███████║██╔██╗ ██║██║  ██║
   ██║   ██╔══██║██╔══╝      ██║   ██║██║╚██╗██║██╔══╝      ██║███╗██║██╔══██║██║╚██╗██║██║  ██║
   ██║   ██║  ██║███████╗    ╚██████╔╝██║ ╚████║███████╗    ╚███╔███╔╝██║  ██║██║ ╚████║██████╔╝
   ╚═╝   ╚═╝  ╚═╝╚══════╝     ╚═════╝ ╚═╝  ╚═══╝╚══════╝     ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ 
`;
  try {
    // Force monospace so spacing aligns perfectly in DevTools
    console.log('%c' + art, 'font-family: monospace; line-height: 1.05; font-size: 12px;');
    console.log("%cThe One Wand | Orta Dünya İlişki Haritası", "color:#CC3355;font-weight:700;");
    console.log("%c:)", "color:#bbb;");
  } catch (_) {
    // no-op
  }
}
