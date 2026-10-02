// Editor visuale drag&drop per i workflow dinamici.
// Nodi = div assoluti dentro .wf2-canvas, connessioni = linee SVG ricalcolate a ogni render.
import { STEP_TYPES, defaultConfigFor } from "./engine.js";

const TYPE_LABEL = { "if": "IF", "rest-call": "REST GET", "output": "OUTPUT" };
const NODE_W = 180;
const NODE_H = 64;

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export class WorkflowEditor {
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.onChange = onChange ?? (() => {});
    this.workflow = null;
    this.selectedNodeId = null;
    this.connectMode = false;
    this.connectSourceId = null;
    this.drag = null; // {nodeId, offsetX, offsetY}

    this.root.innerHTML = `
      <div class="wf2-toolbar">
        <button data-act="add-if">+ If</button>
        <button data-act="add-rest">+ Rest GET</button>
        <button data-act="add-output">+ Output</button>
        <button data-act="connect" class="wf2-btn-connect">Collega nodi</button>
        <button data-act="delete-node" class="wf2-btn-danger">Elimina nodo</button>
        <span class="wf2-hint" data-el="hint"></span>
      </div>
      <div class="wf2-body">
        <div class="wf2-canvas-wrap">
          <div class="wf2-canvas" data-el="canvas">
            <svg class="wf2-edges" data-el="svg"></svg>
          </div>
        </div>
        <div class="wf2-panel" data-el="panel">
          <p class="wf2-panel-empty">Seleziona un nodo per modificarne le proprietà.</p>
        </div>
      </div>
    `;

    this.canvas = this.root.querySelector('[data-el="canvas"]');
    this.svg = this.root.querySelector('[data-el="svg"]');
    this.panel = this.root.querySelector('[data-el="panel"]');
    this.hint = this.root.querySelector('[data-el="hint"]');

    this.root.querySelector('[data-act="add-if"]').onclick = () => this.addNode("if");
    this.root.querySelector('[data-act="add-rest"]').onclick = () => this.addNode("rest-call");
    this.root.querySelector('[data-act="add-output"]').onclick = () => this.addNode("output");
    this.root.querySelector('[data-act="connect"]').onclick = () => this.toggleConnectMode();
    this.root.querySelector('[data-act="delete-node"]').onclick = () => this.deleteSelectedNode();

    this.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    window.addEventListener("mouseup", () => this.onMouseUp());
  }

  loadWorkflow(workflow) {
    this.workflow = workflow;
    this.selectedNodeId = null;
    this.connectMode = false;
    this.connectSourceId = null;
    this.render();
  }

  getWorkflow() {
    return this.workflow;
  }

  addNode(type) {
    if (!this.workflow) return;
    const id = uid(type);
    this.workflow.nodes.push({
      id, type, x: 40 + Math.random() * 40, y: 40 + Math.random() * 200,
      config: defaultConfigFor(type)
    });
    if (!this.workflow.startNodeId) this.workflow.startNodeId = id;
    this.selectedNodeId = id;
    this.render();
    this.onChange(this.workflow);
  }

  deleteSelectedNode() {
    if (!this.workflow || !this.selectedNodeId) return;
    const id = this.selectedNodeId;
    this.workflow.nodes = this.workflow.nodes.filter((n) => n.id !== id);
    this.workflow.edges = this.workflow.edges.filter((e) => e.from !== id && e.to !== id);
    if (this.workflow.startNodeId === id) {
      this.workflow.startNodeId = this.workflow.nodes[0]?.id ?? null;
    }
    this.selectedNodeId = null;
    this.render();
    this.onChange(this.workflow);
  }

  toggleConnectMode() {
    this.connectMode = !this.connectMode;
    this.connectSourceId = null;
    this.hint.textContent = this.connectMode
      ? "Modalità collega: clicca nodo sorgente poi nodo destinazione. Per un IF, il 1° collegamento creato è il ramo VERO, il 2° il ramo FALSO."
      : "";
    this.render();
  }

  onNodeClick(nodeId) {
    if (this.connectMode) {
      if (!this.connectSourceId) {
        this.connectSourceId = nodeId;
      } else if (this.connectSourceId !== nodeId) {
        this.addEdge(this.connectSourceId, nodeId);
        this.connectSourceId = null;
      }
      this.render();
      return;
    }
    this.selectedNodeId = nodeId;
    this.render();
  }

  addEdge(fromId, toId) {
    const fromNode = this.workflow.nodes.find((n) => n.id === fromId);
    let branch;
    if (fromNode.type === "if") {
      const existing = this.workflow.edges.filter((e) => e.from === fromId);
      if (existing.some((e) => e.branch === "true") && existing.some((e) => e.branch === "false")) {
        this.hint.textContent = "Questo IF ha già i due rami (vero/falso). Elimina un collegamento per rifarlo.";
        return;
      }
      branch = existing.some((e) => e.branch === "true") ? "false" : "true";
    }
    this.workflow.edges.push({ from: fromId, to: toId, ...(branch ? { branch } : {}) });
    this.onChange(this.workflow);
  }

  removeEdgesFrom(nodeId) {
    this.workflow.edges = this.workflow.edges.filter((e) => e.from !== nodeId);
    this.render();
    this.onChange(this.workflow);
  }

  onNodeMouseDown(e, nodeId) {
    if (this.connectMode) return;
    const node = this.workflow.nodes.find((n) => n.id === nodeId);
    const rect = this.canvas.getBoundingClientRect();
    this.drag = {
      nodeId,
      offsetX: e.clientX - rect.left - node.x,
      offsetY: e.clientY - rect.top - node.y
    };
  }

  onMouseMove(e) {
    if (!this.drag) return;
    const rect = this.canvas.getBoundingClientRect();
    const node = this.workflow.nodes.find((n) => n.id === this.drag.nodeId);
    if (!node) return;
    node.x = Math.max(0, e.clientX - rect.left - this.drag.offsetX);
    node.y = Math.max(0, e.clientY - rect.top - this.drag.offsetY);
    this.render();
  }

  onMouseUp() {
    if (this.drag) {
      this.onChange(this.workflow);
    }
    this.drag = null;
  }

  renderPanel() {
    const node = this.workflow?.nodes.find((n) => n.id === this.selectedNodeId);
    if (!node) {
      this.panel.innerHTML = `<p class="wf2-panel-empty">Seleziona un nodo per modificarne le proprietà.</p>`;
      return;
    }

    const isStart = this.workflow.startNodeId === node.id;
    let fields = "";
    if (node.type === "if") {
      fields = `
        <label>Variabile <input data-f="variable" value="${node.config.variable ?? ""}" placeholder="es. temp"></label>
        <label>Operatore
          <select data-f="operator">
            ${["\>", "\<", "\>=", "\<=", "==", "!=", "contains"].map(op =>
              `<option value="${op}" ${node.config.operator === op ? "selected" : ""}>${op}</option>`
            ).join("")}
          </select>
        </label>
        <label>Valore confronto <input data-f="value" value="${node.config.value ?? ""}" placeholder="es. 20"></label>
      `;
    } else if (node.type === "rest-call") {
      fields = `
        <label>URL (GET) <input data-f="url" value="${node.config.url ?? ""}" placeholder="https://... usa {variabile} per interpolare"></label>
        <label>Percorso JSON risultato <input data-f="jsonPath" value="${node.config.jsonPath ?? ""}" placeholder="es. current.temperature_2m"></label>
        <label>Salva in variabile <input data-f="saveAs" value="${node.config.saveAs ?? ""}" placeholder="es. temp"></label>
      `;
    } else if (node.type === "output") {
      fields = `
        <label>Modalità
          <select data-f="mode">
            <option value="text" ${node.config.mode === "text" ? "selected" : ""}>Testo fisso</option>
            <option value="variable" ${node.config.mode === "variable" ? "selected" : ""}>Variabile</option>
          </select>
        </label>
        <label>Valore <input data-f="value" value="${node.config.value ?? ""}" placeholder="testo oppure nome variabile"></label>
      `;
    }

    this.panel.innerHTML = `
      <h3>${TYPE_LABEL[node.type]}</h3>
      <label>Nodo iniziale
        <input type="checkbox" data-f="__start" ${isStart ? "checked" : ""}>
      </label>
      ${fields}
      <button data-act="clear-edges" class="wf2-btn-danger-small">Rimuovi collegamenti uscenti</button>
    `;

    this.panel.querySelectorAll("[data-f]").forEach((el) => {
      el.addEventListener("input", () => {
        const key = el.getAttribute("data-f");
        if (key === "__start") {
          this.workflow.startNodeId = el.checked ? node.id : this.workflow.startNodeId;
        } else {
          node.config[key] = el.value;
        }
        this.onChange(this.workflow);
      });
    });
    this.panel.querySelector('[data-act="clear-edges"]').onclick = () => this.removeEdgesFrom(node.id);
  }

  render() {
    if (!this.workflow) return;

    this.canvas.querySelectorAll(".wf2-node").forEach((el) => el.remove());

    this.workflow.nodes.forEach((node) => {
      const el = document.createElement("div");
      el.className = `wf2-node wf2-node-${node.type}`;
      if (node.id === this.selectedNodeId) el.classList.add("wf2-node-selected");
      if (node.id === this.workflow.startNodeId) el.classList.add("wf2-node-start");
      if (node.id === this.connectSourceId) el.classList.add("wf2-node-connecting");
      el.dataset.nodeId = node.id;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;
      el.style.width = `${NODE_W}px`;
      el.style.minHeight = `${NODE_H}px`;
      el.innerHTML = `<strong>${TYPE_LABEL[node.type]}</strong><span>${this.nodeSummary(node)}</span>`;
      el.addEventListener("mousedown", (e) => this.onNodeMouseDown(e, node.id));
      el.addEventListener("click", (e) => { e.stopPropagation(); this.onNodeClick(node.id); });
      this.canvas.appendChild(el);
    });

    this.renderEdges();
    this.renderPanel();
  }

  nodeSummary(node) {
    if (node.type === "if") return `${node.config.variable || "?"} ${node.config.operator} ${node.config.value}`;
    if (node.type === "rest-call") return node.config.saveAs ? `\u2192 ${node.config.saveAs}` : "(configura URL)";
    if (node.type === "output") return node.config.value || "(vuoto)";
    return "";
  }

  renderEdges() {
    const w = this.canvas.scrollWidth || 1000;
    const h = this.canvas.scrollHeight || 600;
    this.svg.setAttribute("width", w);
    this.svg.setAttribute("height", h);
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

    const byId = new Map(this.workflow.nodes.map((n) => [n.id, n]));
    const lines = this.workflow.edges.map((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return "";
      const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
      const x2 = to.x, y2 = to.y + NODE_H / 2;
      const midX = (x1 + x2) / 2;
      const color = edge.branch === "true" ? "var(--wf2-true, #2e7d32)" : edge.branch === "false" ? "var(--wf2-false, #c62828)" : "var(--wf2-edge, #666)";
      const label = edge.branch ? `<text x="${midX}" y="${(y1 + y2) / 2 - 6}" class="wf2-edge-label" fill="${color}">${edge.branch === "true" ? "vero" : "falso"}</text>` : "";
      return `<path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" stroke="${color}" fill="none" stroke-width="2" marker-end="url(#wf2-arrow)"/>${label}`;
    }).join("");

    this.svg.innerHTML = `
      <defs>
        <marker id="wf2-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#666" />
        </marker>
      </defs>
      ${lines}
    `;
  }
}
