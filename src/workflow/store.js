// Persistenza workflow su localStorage (JSON). Demo: nessun backend.

const STORAGE_KEY = "travelmate.workflows.v1";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list, null, 2));
}

export function listWorkflows() {
  return readAll();
}

export function getWorkflow(id) {
  return readAll().find((w) => w.id === id) ?? null;
}

export function saveWorkflow(workflow) {
  const list = readAll();
  const idx = list.findIndex((w) => w.id === workflow.id);
  if (idx >= 0) list[idx] = workflow;
  else list.push(workflow);
  writeAll(list);
  return workflow;
}

export function deleteWorkflow(id) {
  writeAll(readAll().filter((w) => w.id !== id));
}

export function ensureDefaults(demoWorkflows) {
  const list = readAll();
  if (list.length > 0) return list;
  writeAll(demoWorkflows);
  return demoWorkflows;
}

export function exportWorkflowJSON(workflow) {
  return JSON.stringify(workflow, null, 2);
}

export function importWorkflowJSON(jsonText) {
  const workflow = JSON.parse(jsonText);
  if (!workflow.id) workflow.id = `wf-${Date.now()}`;
  saveWorkflow(workflow);
  return workflow;
}
