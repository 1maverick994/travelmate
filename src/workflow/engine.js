// Motore esecuzione mini workflow dinamici — backend di stato: WaveBinder.
// Step supportati: if | rest-call (solo GET) | output.
//
// I nodi rest-call usano la.type: "GET" nativo di WaveBinder 
// l'URL assoluto inserito dall'utente viene splittato in origin (→ extApis entry)
// + pathname+search (→ la.addr). I placeholder {varName} nell'URL diventano
// dipendenze REQUEST_PARAMETER sul nodo sorgente. WaveBinder esegue la GET e
// propaga il risultato automaticamente ai nodi if/output dipendenti.
// jsonPath viene applicato in un CUSTOM_FUNCTION wrapper sul valore ricevuto,
// perché WaveBinder non espone hook di trasformazione sul raw della risposta.

import { WaveBinder } from "wave-binder";
import { license } from "../../wavebinder-license.json";

function getPath(obj, path) {
  if (!path) return obj;
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function evalCondition(varValue, operator, compareValue) {
  const na = Number(varValue);
  const nb = Number(compareValue);
  const bothNumeric =
    varValue !== "" && varValue != null &&
    compareValue !== "" && compareValue != null &&
    !Number.isNaN(na) && !Number.isNaN(nb);

  switch (operator) {
    case ">":  return bothNumeric ? na > nb  : String(varValue) > String(compareValue);
    case "<":  return bothNumeric ? na < nb  : String(varValue) < String(compareValue);
    case ">=": return bothNumeric ? na >= nb : String(varValue) >= String(compareValue);
    case "<=": return bothNumeric ? na <= nb : String(varValue) <= String(compareValue);
    case "==": return bothNumeric ? na === nb : String(varValue) === String(compareValue);
    case "!=": return bothNumeric ? na !== nb : String(varValue) !== String(compareValue);
    case "contains": return String(varValue ?? "").includes(String(compareValue ?? ""));
    default: return false;
  }
}

export const STEP_TYPES = ["if", "rest-call", "output"];

export function defaultConfigFor(type) {
  if (type === "if")        return { variable: "", operator: ">", value: "" };
  if (type === "rest-call") return { url: "", jsonPath: "", saveAs: "" };
  if (type === "output")    return { mode: "text", value: "" };
  return {};
}

// Mappa nome-variabile (config.saveAs di un rest-call) -> id nodo che la produce.
function buildVarSourceMap(workflow) {
  const map = new Map();
  workflow.nodes.forEach((n) => {
    if (n.type === "rest-call" && n.config.saveAs) map.set(n.config.saveAs, n.id);
  });
  return map;
}

// Estrae i nomi dei placeholder {varName} da un URL template.
function extractPlaceholders(url) {
  const matches = [];
  for (const m of String(url ?? "").matchAll(/\{(\w+)\}/g)) matches.push(m[1]);
  return matches;
}

// Splitta un URL assoluto in { serviceName, addr }.
// URL con domini diversi producono chiavi diverse in extApis (es. "api-0", "api-1").
// Restituisce null se l'URL non è parsabile (nodo non ancora configurato).
function splitUrl(url, originToService) {
  if (!url) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const origin = parsed.origin; 
  if (!originToService.has(origin)) {
    originToService.set(origin, `api-${originToService.size}`);
  }
  const serviceName = originToService.get(origin);
  // addr = tutto tranne l'origin; i placeholder {var} rimangono nell'addr
  const addr = url.slice(origin.length) || "/";
  return { serviceName, addr };
}

/**
 * Costruisce protoNodes, customFunctions ed extApis per WaveBinder.
 *
 * rest-call → la.type: "GET" nativo; le variabili interpolate diventano
 *             dipendenze REQUEST_PARAMETER. Se il nodo ha jsonPath, un nodo
 *             wrapper CUSTOM_FUNCTION (id: "<id>__extract") applica getPath
 *             sul raw e i nodi a valle dipendono dal wrapper, non dal GET raw.
 *
 */
export function buildGraph(workflow) {
  const varSource = buildVarSourceMap(workflow);

  // per ogni nodo "output", trova l'eventuale edge in ingresso con ramo
  const incomingBranch = new Map(); // outputNodeId -> {ifNodeId, branch}
  workflow.edges.forEach((e) => {
    if (e.branch) incomingBranch.set(e.to, { ifNodeId: e.from, branch: e.branch });
  });

  const protoNodes = [];
  const customFunctions = [];
  const originToService = new Map(); // origin -> serviceName

  // Prima passata: costruiamo extApis leggendo tutti gli URL dei rest-call.
  // (splitUrl popola originToService come side effect)
  workflow.nodes.forEach((node) => {
    if (node.type === "rest-call") splitUrl(node.config.url, originToService);
  });

  // extApis: Map<serviceName, { baseUrl, headers }>
  const extApis = new Map();
  originToService.forEach((serviceName, origin) => {
    extApis.set(serviceName, { target: origin, secure: false });
  });

  workflow.nodes.forEach((node) => {
    // ── REST-CALL ──────────────────────────────────────────────────────────
    if (node.type === "rest-call") {
      const urlInfo = splitUrl(node.config.url, originToService);

      if (!urlInfo) {
        // URL non configurato: fallback USER_SELECTION (nodo inerte)
        protoNodes.push({
          name: node.id, path: node.id, type: "SINGLE", dep: [],
          la: { type: "USER_SELECTION" }
        });
        return;
      }

      // Dipendenze dai placeholder {varName} nell'URL
      const placeholders = extractPlaceholders(node.config.url);
      const dep = placeholders.map((varName) => {
        const sourceId = varSource.get(varName);
        // Se c'è jsonPath sul nodo sorgente, il valore estratto viene dal wrapper __extract
        const resolvedSource = sourceId
          ? (workflow.nodes.find(n => n.id === sourceId)?.config.jsonPath ? `${sourceId}__extract` : sourceId)
          : null;
        return resolvedSource
          ? { nodeName: resolvedSource, parameterName: varName, isOptional: false, onUpdate: true, type: "REQUEST_PARAMETER" }
          : null;
      }).filter(Boolean);

      // Nodo GET nativo
      protoNodes.push({
        name: node.id,
        path: node.id,
        type: "SINGLE",
        dep,
        la: { type: "GET", addr: urlInfo.addr, serviceName: urlInfo.serviceName }
      });

      // Se c'è jsonPath, aggiungiamo un nodo wrapper __extract che fa getPath
      if (node.config.jsonPath) {
        const fnName = `extract_${node.id}`;
        const jsonPath = node.config.jsonPath; // closure
        customFunctions.push({
          name: fnName,
          implementation: (raw) => (raw != null ? getPath(raw, jsonPath) : null)
        });
        protoNodes.push({
          name: `${node.id}__extract`,
          path: `${node.id}__extract`,
          type: "SINGLE",
          dep: [{ nodeName: node.id, parameterName: "raw", isOptional: false, onUpdate: true }],
          la: { type: "CUSTOM_FUNCTION", functionName: fnName }
        });
      }

      return;
    }

    // ── IF ────────────────────────────────────────────────────────────────
    if (node.type === "if") {
      const sourceNodeId = varSource.get(node.config.variable);
      // Se il nodo sorgente ha jsonPath, dipende dal wrapper __extract
      const resolvedSource = sourceNodeId
        ? (workflow.nodes.find(n => n.id === sourceNodeId)?.config.jsonPath ? `${sourceNodeId}__extract` : sourceNodeId)
        : null;
      const dep = resolvedSource
        ? [{ nodeName: resolvedSource, parameterName: "value", isOptional: false, onUpdate: true }]
        : [];

      // Se questo nodo if è raggiunto tramite un branch di un altro nodo if (o rest-call),
      // aggiungiamo quella dipendenza così il nodo si attiva SOLO se il branch è corretto.
      const parentEdge = workflow.edges.find((e) => e.to === node.id && e.branch != null);
      let parentIfInfo = null;
      if (parentEdge) {
        const parentNode = workflow.nodes.find((n) => n.id === parentEdge.from);
        if (parentNode && parentNode.type === "if") {
          parentIfInfo = { ifNodeId: parentEdge.from, branch: parentEdge.branch };
          dep.push({ nodeName: parentEdge.from, parameterName: "parentBranch", isOptional: false, onUpdate: true });
        }
      }

      const fnName = `if_${node.id}`;
      customFunctions.push({
        name: fnName,
        implementation: (...args) => {
          let idx = 0;
          const value       = resolvedSource ? args[idx++] : null;
          const parentBranch = parentIfInfo  ? args[idx++] : null;
          // Se il parent non ha prodotto il branch atteso, propaghiamo null (percorso inattivo)
          if (parentIfInfo && parentBranch !== parentIfInfo.branch) return null;
          if (value == null) return null;
          return evalCondition(value, node.config.operator, node.config.value) ? "true" : "false";
        }
      });
      protoNodes.push({
        name: node.id, path: node.id, type: "SINGLE", dep,
        la: { type: "CUSTOM_FUNCTION", functionName: fnName }
      });
      return;
    }

    // ── OUTPUT ────────────────────────────────────────────────────────────
    if (node.type === "output") {
      const dep = [];
      const branchInfo = incomingBranch.get(node.id);
      if (branchInfo) {
        dep.push({ nodeName: branchInfo.ifNodeId, parameterName: "branch", isOptional: false, onUpdate: true });
      }
      let varNodeId = null;
      if (node.config.mode === "variable") {
        const rawSourceId = varSource.get(node.config.value);
        // dipende dal wrapper __extract se presente
        varNodeId = rawSourceId
          ? (workflow.nodes.find(n => n.id === rawSourceId)?.config.jsonPath ? `${rawSourceId}__extract` : rawSourceId)
          : null;
        if (varNodeId) dep.push({ nodeName: varNodeId, parameterName: "value", isOptional: false, onUpdate: true });
      }
      const fnName = `out_${node.id}`;
      customFunctions.push({
        name: fnName,
        implementation: (...args) => {
          let idx = 0;
          const branchValue = branchInfo ? args[idx++] : null;
          const varValue    = varNodeId  ? args[idx++] : null;
          if (branchInfo && branchValue !== branchInfo.branch) return null;
          return node.config.mode === "variable" ? varValue : node.config.value;
        }
      });
      protoNodes.push({
        name: node.id, path: node.id, type: "SINGLE", dep,
        la: { type: "CUSTOM_FUNCTION", functionName: fnName }
      });
    }
  });

  return { protoNodes, customFunctions, extApis };
}

/**
 * Esegue il workflow interamente tramite WaveBinder:
 * - GET nativi per i rest-call (WaveBinder li esegue e propaga)
 * - CUSTOM_FUNCTION per if / output / jsonPath-extract
 */
export async function runWorkflow(workflow, { onEvent = () => {} } = {}) {
  const { protoNodes, customFunctions, extApis } = buildGraph(workflow);

  if (protoNodes.length === 0) {
    onEvent({ type: "log", level: "error", message: "Workflow vuoto: aggiungi almeno un nodo." });
    onEvent({ type: "done", error: true });
    return null;
  }

  const wb = new WaveBinder(license, protoNodes, extApis, customFunctions);
  wb.tangleNodes();

  await wb.waitUntilReady().catch(() => {});
  if (!wb.isReady()) {
    onEvent({ type: "log", level: "error", message: "WaveBinder non pronto (licenza/rete): esecuzione annullata." });
    onEvent({ type: "done", error: true });
    return null;
  }

  // Sottoscrizione a tutti i nodi (inclusi __extract) per log + UI.
  // Il primo emit di ogni BehaviorSubject è il valore iniziale null: lo saltiamo.
  const firstSeen = new Set();

  // Buffer eventi: li accumuliamo e li flussiamo solo dopo che tutti i rest-call
  // hanno completato, così il log è ordinato e l'output è sempre l'ultimo step.
  const eventBuffer = [];
  const bufferedEvent = (e) => eventBuffer.push(e);

  // Traccia quali rest-call hanno completato (con valore estratto finale)
  const restCallIds = new Set(
    workflow.nodes.filter((n) => n.type === "rest-call").map((n) => n.id)
  );
  const restCallDone = new Set();

  const flushIfReady = () => {
    if (restCallDone.size < restCallIds.size) return;
    // Tutti i rest-call completati: flush in ordine, output per ultimi
    const nonOutput = eventBuffer.filter((e) => e.type !== "output" && !(e.type === "log" && e._isOutput));
    const outputEvts = eventBuffer.filter((e) => e.type === "output" || e._isOutput);
    [...nonOutput, ...outputEvts].forEach((e) => {
      const { _isOutput, ...clean } = e;
      onEvent(clean);
    });
    eventBuffer.length = 0;
  };

  protoNodes.forEach((pn) => {
    const wbNode = wb.getNodeByName(pn.name);
    wbNode.subscribe((value) => {
      if (!firstSeen.has(pn.name)) { firstSeen.add(pn.name); return; }
      if (value === null) return; // ignora propagazioni intermedie null

      const isExtract    = pn.name.endsWith("__extract");
      const baseId       = isExtract ? pn.name.replace(/__extract$/, "") : pn.name;
      const workflowNode = workflow.nodes.find((n) => n.id === baseId);

      if (!workflowNode) return;

      if (workflowNode.type === "rest-call") {
        if (isExtract) {
          bufferedEvent({ type: "node-start", nodeId: baseId });
          bufferedEvent({ type: "log", level: "info",
            message: `GET ${workflowNode.config.url} \u2192 ${workflowNode.config.saveAs} = ${JSON.stringify(value)}` });
          bufferedEvent({ type: "node-end", nodeId: baseId });
          restCallDone.add(baseId);
          flushIfReady();
        } else if (!workflowNode.config.jsonPath) {
          bufferedEvent({ type: "node-start", nodeId: baseId });
          bufferedEvent({ type: "log", level: "info",
            message: `GET ${workflowNode.config.url} \u2192 ${workflowNode.config.saveAs} = ${JSON.stringify(value)}` });
          bufferedEvent({ type: "node-end", nodeId: baseId });
          restCallDone.add(baseId);
          flushIfReady();
        } else {
          // GET raw completata, il valore estratto arriverà dall'__extract — nessun log qui
        }
      } else if (workflowNode.type === "if") {
        bufferedEvent({ type: "node-start", nodeId: baseId });
        bufferedEvent({ type: "log", level: "info",
          message: `if (${workflowNode.config.variable} ${workflowNode.config.operator} ${workflowNode.config.value}) -> ${value}` });
        bufferedEvent({ type: "node-end", nodeId: baseId });
      } else if (workflowNode.type === "output" && value != null) {
        bufferedEvent({ type: "node-start", nodeId: baseId });
        bufferedEvent({ type: "output", value, _isOutput: true });
        bufferedEvent({ type: "log", level: "success", message: `Output: ${value}`, _isOutput: true });
        bufferedEvent({ type: "node-end", nodeId: baseId, _isOutput: true });
      }
    });
  });

  // I nodi rest-call con GET nativo si attivano solo quando le loro dipendenze
  // sono soddisfatte. I nodi senza dipendenze (primo nodo della catena) vanno
  // triggerati esplicitamente — WaveBinder non fa partire da solo un GET senza dep.
  const restCallNodes = workflow.nodes.filter((n) => n.type === "rest-call");
  restCallNodes.forEach((node) => {
    const pn = protoNodes.find((p) => p.name === node.id);
    if (pn && pn.dep.length === 0) {
      wb.getNodeByName(node.id).next(null); // trigger avvio GET senza dipendenze
    }
  });

  // Attesa completamento: aspettiamo che tutti i nodi output abbiano emesso
  // almeno un valore non-null, oppure timeout di sicurezza (15s).
  const outputNodeIds = workflow.nodes.filter((n) => n.type === "output").map((n) => n.id);
  await new Promise((resolve) => {
    const resolved = new Set();
    const timeout = setTimeout(() => resolve(), 3000);
    outputNodeIds.forEach((id) => {
      wb.getNodeByName(id)?.subscribe((v) => {
        if (v != null) {
          resolved.add(id);
          if (resolved.size === outputNodeIds.length) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });
    if (outputNodeIds.length === 0) { clearTimeout(timeout); resolve(); }
  });

  wb.nukeNodes();
  onEvent({ type: "done" });
  return null; 
}
