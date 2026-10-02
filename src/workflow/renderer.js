// Renderer esecuzione: evidenzia nodo attivo sul canvas + log console + area output.
export class ExecutionRenderer {
  constructor({ canvasEl, logEl, outputEl, blueprintEl }) {
    this.canvasEl = canvasEl;
    this.logEl = logEl;
    this.outputEl = outputEl;
    this.blueprintEl = blueprintEl ?? null;
  }

  /**
   * Mostra il blueprint del grafo WaveBinder prima dell'esecuzione.
   * Riceve il risultato di buildGraph(workflow) e il workflow originale.
   */
  showBlueprint({ protoNodes, extApis }, workflow) {
    if (!this.blueprintEl) return;

    const apiCount = extApis instanceof Map ? extApis.size : Object.keys(extApis ?? {}).length;
    const nodeCount = protoNodes.length;

    // Mappa id nodo → tipo originale (per label leggibili)
    const nodeTypeMap = new Map();
    (workflow.nodes ?? []).forEach((n) => nodeTypeMap.set(n.id, n));

    const rows = protoNodes.map((pn) => {
      const isExtract = pn.name.endsWith("__extract");
      const baseId    = isExtract ? pn.name.replace(/__extract$/, "") : pn.name;
      const wfNode    = nodeTypeMap.get(baseId);

      let badge, label;
      if (isExtract) {
        badge = "extract";
        const jp = wfNode?.config?.jsonPath ?? "";
        label = `CUSTOM_FUNCTION → jsonPath(${jp})`;
      } else if (!wfNode) {
        badge = "?";
        label = pn.la?.type ?? "?";
      } else if (wfNode.type === "rest-call") {
        badge = "rest";
        const la = pn.la ?? {};
        label = `GET ${la.serviceName ?? ""}${la.addr ?? ""}${wfNode.config?.saveAs ? " → " + wfNode.config.saveAs : ""}`;
      } else if (wfNode.type === "if") {
        badge = "if";
        label = `CUSTOM_FUNCTION (${wfNode.config?.variable ?? "?"} ${wfNode.config?.operator ?? ""} ${wfNode.config?.value ?? ""})`;
      } else if (wfNode.type === "output") {
        badge = "output";
        label = `CUSTOM_FUNCTION → ${wfNode.config?.mode === "variable" ? "var:" + wfNode.config.value : JSON.stringify(wfNode.config?.value ?? "")}`;
      } else {
        badge = wfNode.type;
        label = pn.la?.type ?? "";
      }

      return `<div class="wf2-bp-row">
        <span class="wf2-bp-badge wf2-bp-badge-${badge}">${badge}</span>
        <span class="wf2-bp-name">${pn.name}</span>
        <span class="wf2-bp-label">${label}</span>
      </div>`;
    }).join("");

    this.blueprintEl.innerHTML = `
      <details class="wf2-bp-details">
        <summary class="wf2-bp-summary">
          <span class="wf2-bp-title">⚙️ Grafo WaveBinder generato</span>
          <span class="wf2-bp-meta">${nodeCount} nodi · ${apiCount} API esterna${apiCount !== 1 ? "e" : ""}</span>
        </summary>
        <div class="wf2-bp-body">${rows}</div>
      </details>`;
    this.blueprintEl.style.display = "block";
  }

  reset() {
    this.logEl.innerHTML = "";
    this.outputEl.innerHTML = "";
    if (this.blueprintEl) this.blueprintEl.style.display = "none";
    this.canvasEl.querySelectorAll(".wf2-node").forEach((el) => el.classList.remove("wf2-node-active", "wf2-node-error"));
  }

  findNodeEl(nodeId) {
    return this.canvasEl.querySelector(`.wf2-node[data-node-id="${nodeId}"]`);
  }

  async handleEvent(event) {
    if (event.type === "node-start") {
      this.findNodeEl(event.nodeId)?.classList.add("wf2-node-active");
      await sleep(500); // rallenta l'esecuzione per rendere visibile il flusso, solo demo
    }
    if (event.type === "node-end") {
      const el = this.findNodeEl(event.nodeId);
      el?.classList.remove("wf2-node-active");
      if (event.error) el?.classList.add("wf2-node-error");
    }
    if (event.type === "log") {
      const line = document.createElement("div");
      line.className = `wf2-log wf2-log-${event.level}`;
      const time = new Date().toLocaleTimeString("it-IT");
      const icon = { info: "🟡", error: "🔴", success: "🟢" }[event.level] ?? "⚪";
      line.textContent = `${icon} [${time}] ${event.message}`;
      this.logEl.appendChild(line);
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
    if (event.type === "output") {
      const box = document.createElement("div");
      box.className = "wf2-output-box";
      box.textContent = event.value;
      this.outputEl.appendChild(box);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
