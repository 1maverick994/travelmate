import { runWorkflow, buildGraph } from "./workflow/engine.js";
import { WorkflowEditor } from "./workflow/editor.js";
import { ExecutionRenderer } from "./workflow/renderer.js";
import { listWorkflows, saveWorkflow, deleteWorkflow, ensureDefaults, exportWorkflowJSON, importWorkflowJSON } from "./workflow/store.js";
import { createDemoWorkflows } from "./workflow/demo-workflows.js";

const editorRoot = document.getElementById("wf2-editor");
const select = document.getElementById("wf2-select");
const btnNew = document.getElementById("wf2-new");
const btnSave = document.getElementById("wf2-save");
const btnDelete = document.getElementById("wf2-delete");
const btnRun = document.getElementById("wf2-run");
const btnExport = document.getElementById("wf2-export");
const fileImport = document.getElementById("wf2-import");
const nameInput = document.getElementById("wf2-name");

const editor = new WorkflowEditor(editorRoot, { onChange: () => {} });
const renderer = new ExecutionRenderer({
  canvasEl: editorRoot.querySelector(".wf2-canvas"),
  logEl: document.getElementById("wf2-log"),
  outputEl: document.getElementById("wf2-output"),
  blueprintEl: document.getElementById("wf2-blueprint")
});

// DEBUG temporaneo
window._dbg = renderer;
console.log("[dbg] canvasEl:", renderer.canvasEl);
console.log("[dbg] logEl:", renderer.logEl);
console.log("[dbg] outputEl:", renderer.outputEl);

function refreshSelect(selectedId) {
  const workflows = listWorkflows();
  select.innerHTML = workflows.map((w) => `<option value="${w.id}">${w.name}</option>`).join("");
  if (selectedId) select.value = selectedId;
}

function loadIntoEditor(id) {
  const workflow = listWorkflows().find((w) => w.id === id);
  if (!workflow) return;
  editor.loadWorkflow(workflow);
  nameInput.value = workflow.name;
}

ensureDefaults(createDemoWorkflows());
refreshSelect();
if (select.value) loadIntoEditor(select.value);

select.addEventListener("change", () => loadIntoEditor(select.value));

btnNew.addEventListener("click", () => {
  const id = `wf-${Date.now()}`;
  const workflow = { id, name: "Nuovo workflow", nodes: [], edges: [], startNodeId: null };
  saveWorkflow(workflow);
  refreshSelect(id);
  loadIntoEditor(id);
});

btnSave.addEventListener("click", () => {
  const workflow = editor.getWorkflow();
  if (!workflow) return;
  workflow.name = nameInput.value || workflow.name;
  saveWorkflow(workflow);
  refreshSelect(workflow.id);
});

btnDelete.addEventListener("click", () => {
  const workflow = editor.getWorkflow();
  if (!workflow) return;
  deleteWorkflow(workflow.id);
  refreshSelect();
  if (select.value) loadIntoEditor(select.value);
  else editor.loadWorkflow({ id: `wf-${Date.now()}`, name: "Nuovo workflow", nodes: [], edges: [], startNodeId: null });
});

btnExport.addEventListener("click", () => {
  const workflow = editor.getWorkflow();
  if (!workflow) return;
  const blob = new Blob([exportWorkflowJSON(workflow)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${workflow.id}.json`;
  a.click();
});

fileImport.addEventListener("change", async () => {
  const file = fileImport.files[0];
  if (!file) return;
  const text = await file.text();
  const workflow = importWorkflowJSON(text);
  refreshSelect(workflow.id);
  loadIntoEditor(workflow.id);
  fileImport.value = "";
});

btnRun.addEventListener("click", async () => {
  console.log("[dbg] click Esegui");
  const workflow = editor.getWorkflow();
  console.log("[dbg] workflow:", workflow);
  if (!workflow || !workflow.startNodeId) {
    alert("Imposta un nodo iniziale prima di eseguire il workflow.");
    return;
  }
  try {
    renderer.reset();
  } catch (e) {
    console.error("[dbg] renderer.reset() crash:", e);
    return;
  }

  // Blueprint: costruisce il grafo e lo mostra PRIMA dell'esecuzione
  try {
    const graph = buildGraph(workflow);
    renderer.showBlueprint(graph, workflow);
  } catch (e) {
    console.warn("Blueprint non disponibile:", e);
  }

  btnRun.disabled = true;
  const TIMEOUT_SEC = 3;
  let remaining = TIMEOUT_SEC;
  btnRun.textContent = `⏳ ${remaining}s`;
  const countdownInterval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      btnRun.textContent = `⏳ ${remaining}s`;
    }
  }, 1000);
  try {
    await runWorkflow(workflow, { onEvent: (e) => renderer.handleEvent(e) });
  } catch (e) {
    console.error("[dbg] runWorkflow crash:", e);
  } finally {
    clearInterval(countdownInterval);
    btnRun.disabled = false;
    btnRun.innerHTML = "&#9654; Esegui";
  }
});
