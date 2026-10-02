// Disegna il workflow come SVG (nodi = box, archi = frecce) e gestisce le
// select HTML (una per nodo) usate per pilotare setSelection(index) su
// WaveBinder. Nessuna dipendenza esterna: SVG custom + DOM nativo.

const LABELS = {
  paese: "Paese",
  regione: "Regione",
  citta: "Citta'",
  attivita: "Attivita'"
};

const BOX_W = 160;
const BOX_H = 70;
const GAP = 60;
const SVG_NS = "http://www.w3.org/2000/svg";

export function initRenderer(names, handlers) {
  renderSvg(names);
  renderControls(names, handlers);
  names.forEach((name) => {
    setNodeState(name, "idle");
    setNodeValue(name, null);
  });
}

function renderSvg(names) {
  const container = document.getElementById("workflow");
  container.innerHTML = "";

  const totalW = names.length * BOX_W + (names.length - 1) * GAP + 40;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${totalW} 160`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("id", "workflow-svg");

  const defs = document.createElementNS(SVG_NS, "defs");
  defs.innerHTML = `
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" class="wf-arrowhead" />
    </marker>`;
  svg.appendChild(defs);

  names.forEach((name, i) => {
    const x = 20 + i * (BOX_W + GAP);
    const y = 45;

    if (i > 0) {
      const arrow = document.createElementNS(SVG_NS, "line");
      arrow.setAttribute("x1", x - GAP);
      arrow.setAttribute("y1", y + BOX_H / 2);
      arrow.setAttribute("x2", x);
      arrow.setAttribute("y2", y + BOX_H / 2);
      arrow.setAttribute("class", "wf-arrow");
      arrow.setAttribute("marker-end", "url(#arrowhead)");
      svg.appendChild(arrow);
    }

    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("id", `node-${name}`);
    g.setAttribute("class", "wf-node idle");

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", BOX_W);
    rect.setAttribute("height", BOX_H);
    rect.setAttribute("rx", 10);
    rect.setAttribute("class", "wf-box");
    g.appendChild(rect);

    const title = document.createElementNS(SVG_NS, "text");
    title.setAttribute("x", x + BOX_W / 2);
    title.setAttribute("y", y + 24);
    title.setAttribute("class", "wf-title");
    title.textContent = LABELS[name] ?? name;
    g.appendChild(title);

    const value = document.createElementNS(SVG_NS, "text");
    value.setAttribute("x", x + BOX_W / 2);
    value.setAttribute("y", y + 46);
    value.setAttribute("class", "wf-value");
    value.setAttribute("id", `value-${name}`);
    value.textContent = "-";
    g.appendChild(value);

    svg.appendChild(g);
  });

  container.appendChild(svg);
}

function renderControls(names, handlers) {
  const container = document.getElementById("controls");
  container.innerHTML = "";

  names.forEach((name) => {
    const wrap = document.createElement("div");
    wrap.className = "wf-control";

    const label = document.createElement("label");
    label.textContent = LABELS[name] ?? name;
    label.setAttribute("for", `select-${name}`);

    const select = document.createElement("select");
    select.id = `select-${name}`;
    select.disabled = true;
    select.innerHTML = `<option value="">-</option>`;
    select.addEventListener("change", (e) => {
      if (e.target.value === "") return;
      handlers?.onSelect?.(name, Number(e.target.value));
    });

    wrap.appendChild(label);
    wrap.appendChild(select);
    container.appendChild(wrap);
  });
}

export function setNodeState(name, state) {
  const g = document.getElementById(`node-${name}`);
  if (g) g.setAttribute("class", `wf-node ${state}`);
}

export function setNodeValue(name, value) {
  const el = document.getElementById(`value-${name}`);
  if (el) el.textContent = value == null ? "-" : String(value);
}

export function setNodeChoices(name, choices) {
  const select = document.getElementById(`select-${name}`);
  if (!select) return;
  select.innerHTML = `<option value="">-</option>` +
    choices.map((c, i) => `<option value="${i}">${c}</option>`).join("");
  select.disabled = choices.length === 0;
}
