import { WaveBinder } from "wave-binder";
import { license } from "../../wavebinder-license.json";

/**
 * Dynamic mini-workflow engine.
 *
 * Supported steps:
 * - if
 * - rest-call (GET only)
 * - output
 *
 * REST calls use WaveBinder's native GET support.
 * The absolute URL is split into:
 * - origin -> extApis entry
 * - pathname + search -> WaveBinder addr
 *
 * URL placeholders such as {userId} become REQUEST_PARAMETER
 * dependencies on the node that produces that variable.
 *
 * jsonPath is handled by a CUSTOM_FUNCTION wrapper because
 * WaveBinder does not expose a transformation hook on GET results.
 */

// -----------------------------------------------------------------------------
// Basic utilities
// -----------------------------------------------------------------------------

function getPath(obj, path) {
  if (!path) return obj;

  return path
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function evalCondition(varValue, operator, compareValue) {
  const na = Number(varValue);
  const nb = Number(compareValue);

  const bothNumeric =
    varValue !== "" &&
    varValue != null &&
    compareValue !== "" &&
    compareValue != null &&
    !Number.isNaN(na) &&
    !Number.isNaN(nb);

  switch (operator) {
    case ">":
      return bothNumeric
        ? na > nb
        : String(varValue) > String(compareValue);

    case "<":
      return bothNumeric
        ? na < nb
        : String(varValue) < String(compareValue);

    case ">=":
      return bothNumeric
        ? na >= nb
        : String(varValue) >= String(compareValue);

    case "<=":
      return bothNumeric
        ? na <= nb
        : String(varValue) <= String(compareValue);

    case "==":
      return bothNumeric
        ? na === nb
        : String(varValue) === String(compareValue);

    case "!=":
      return bothNumeric
        ? na !== nb
        : String(varValue) !== String(compareValue);

    case "contains":
      return String(varValue ?? "").includes(String(compareValue ?? ""));

    default:
      return false;
  }
}

export const STEP_TYPES = ["if", "rest-call", "output"];

export function defaultConfigFor(type) {
  if (type === "if") {
    return {
      variable: "",
      operator: ">",
      value: ""
    };
  }

  if (type === "rest-call") {
    return {
      url: "",
      jsonPath: "",
      saveAs: ""
    };
  }

  if (type === "output") {
    return {
      mode: "text",
      value: ""
    };
  }

  return {};
}

// -----------------------------------------------------------------------------
// Workflow helpers
// -----------------------------------------------------------------------------

// Maps a variable name to the REST node that produces it.
function buildVarSourceMap(workflow) {
  const map = new Map();

  workflow.nodes.forEach((node) => {
    if (node.type === "rest-call" && node.config.saveAs) {
      map.set(node.config.saveAs, node.id);
    }
  });

  return map;
}

// Extracts {variableName} placeholders from a URL.
function extractPlaceholders(url) {
  const matches = [];

  for (const match of String(url ?? "").matchAll(/\{(\w+)\}/g)) {
    matches.push(match[1]);
  }

  return matches;
}

// Splits an absolute URL into a WaveBinder service and address.
function splitUrl(url, originToService) {
  if (!url) return null;

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const origin = parsed.origin;

  // Each different origin gets its own WaveBinder service.
  if (!originToService.has(origin)) {
    originToService.set(origin, `api-${originToService.size}`);
  }

  const serviceName = originToService.get(origin);

  // Keep placeholders in addr so WaveBinder can resolve them.
  const addr = url.slice(origin.length) || "/";

  return {
    serviceName,
    addr
  };
}

// Returns the WaveBinder node that provides a variable.
// If the source uses jsonPath, return its extraction wrapper.
function resolveVariableNode(workflow, varSource, variableName) {
  const sourceId = varSource.get(variableName);

  if (!sourceId) {
    return null;
  }

  const sourceNode = workflow.nodes.find((node) => node.id === sourceId);

  return sourceNode?.config.jsonPath
    ? `${sourceId}__extract`
    : sourceId;
}

// Creates a WaveBinder dependency.
function createDependency(nodeName, parameterName) {
  return {
    nodeName,
    parameterName,
    isOptional: false,
    onUpdate: true
  };
}

// -----------------------------------------------------------------------------
// Graph builder
// -----------------------------------------------------------------------------

/**
 * Builds the WaveBinder graph.
 *
 * REST CALL
 *   URL -> native GET
 *   {variable} -> REQUEST_PARAMETER dependency
 *   jsonPath -> __extract CUSTOM_FUNCTION
 *
 * IF
 *   source value -> condition CUSTOM_FUNCTION
 *   parent branch -> activation dependency
 *
 * OUTPUT
 *   source value / branch -> output CUSTOM_FUNCTION
 */
export function buildGraph(workflow) {
  const varSource = buildVarSourceMap(workflow);

  // Maps output nodes to the branch that controls them.
  const incomingBranch = new Map();

  workflow.edges.forEach((edge) => {
    if (edge.branch) {
      incomingBranch.set(edge.to, {
        ifNodeId: edge.from,
        branch: edge.branch
      });
    }
  });

  const protoNodes = [];
  const customFunctions = [];
  const originToService = new Map();

  // Discover all API origins before creating extApis.
  workflow.nodes.forEach((node) => {
    if (node.type === "rest-call") {
      splitUrl(node.config.url, originToService);
    }
  });

  // WaveBinder API configuration.
  const extApis = new Map();

  originToService.forEach((serviceName, origin) => {
    extApis.set(serviceName, {
      target: origin,
      secure: false
    });
  });

  // Build each workflow node.
  workflow.nodes.forEach((node) => {
    // -------------------------------------------------------------------------
    // REST CALL
    // -------------------------------------------------------------------------
    if (node.type === "rest-call") {
      buildRestCallNode(
        workflow,
        node,
        varSource,
        originToService,
        protoNodes,
        customFunctions
      );

      return;
    }

    // -------------------------------------------------------------------------
    // IF
    // -------------------------------------------------------------------------
    if (node.type === "if") {
      buildIfNode(
        workflow,
        node,
        varSource,
        protoNodes,
        customFunctions
      );

      return;
    }

    // -------------------------------------------------------------------------
    // OUTPUT
    // -------------------------------------------------------------------------
    if (node.type === "output") {
      buildOutputNode(
        workflow,
        node,
        varSource,
        incomingBranch,
        protoNodes,
        customFunctions
      );
    }
  });

  return {
    protoNodes,
    customFunctions,
    extApis
  };
}

// -----------------------------------------------------------------------------
// REST CALL node
// -----------------------------------------------------------------------------

function buildRestCallNode(
  workflow,
  node,
  varSource,
  originToService,
  protoNodes,
  customFunctions
) {
  const urlInfo = splitUrl(node.config.url, originToService);

  // Invalid or empty URL: create an inactive node.
  if (!urlInfo) {
    protoNodes.push({
      name: node.id,
      path: node.id,
      type: "SINGLE",
      dep: [],
      la: {
        type: "USER_SELECTION"
      }
    });

    return;
  }

  // Convert URL placeholders into dependencies.
  const placeholders = extractPlaceholders(node.config.url);

  const dep = placeholders
    .map((variableName) => {
      const sourceNode = resolveVariableNode(
        workflow,
        varSource,
        variableName
      );

      return sourceNode
        ? {
            ...createDependency(sourceNode, variableName),
            type: "REQUEST_PARAMETER"
          }
        : null;
    })
    .filter(Boolean);

  // Native WaveBinder GET node.
  protoNodes.push({
    name: node.id,
    path: node.id,
    type: "SINGLE",
    dep,
    la: {
      type: "GET",
      addr: urlInfo.addr,
      serviceName: urlInfo.serviceName
    }
  });

  // Extract jsonPath in a separate node.
  if (node.config.jsonPath) {
    const functionName = `extract_${node.id}`;
    const jsonPath = node.config.jsonPath;

    customFunctions.push({
      name: functionName,
      implementation: (raw) =>
        raw != null
          ? getPath(raw, jsonPath)
          : null
    });

    protoNodes.push({
      name: `${node.id}__extract`,
      path: `${node.id}__extract`,
      type: "SINGLE",
      dep: [
        createDependency(
          node.id,
          "raw"
        )
      ],
      la: {
        type: "CUSTOM_FUNCTION",
        functionName
      }
    });
  }
}

// -----------------------------------------------------------------------------
// IF node
// -----------------------------------------------------------------------------

function buildIfNode(
  workflow,
  node,
  varSource,
  protoNodes,
  customFunctions
) {
  // Find the node that provides the condition value.
  const sourceNode = resolveVariableNode(
    workflow,
    varSource,
    node.config.variable
  );

  const dep = sourceNode
    ? [createDependency(sourceNode, "value")]
    : [];

  // Check whether this IF is controlled by a parent branch.
  const parentEdge = workflow.edges.find(
    (edge) =>
      edge.to === node.id &&
      edge.branch != null
  );

  let parentIfInfo = null;

  if (parentEdge) {
    const parentNode = workflow.nodes.find(
      (candidate) => candidate.id === parentEdge.from
    );

    if (parentNode?.type === "if") {
      parentIfInfo = {
        ifNodeId: parentEdge.from,
        branch: parentEdge.branch
      };

      dep.push(
        createDependency(
          parentEdge.from,
          "parentBranch"
        )
      );
    }
  }

  const functionName = `if_${node.id}`;

  customFunctions.push({
    name: functionName,

    implementation: (...args) => {
      let index = 0;

      const value = sourceNode
        ? args[index++]
        : null;

      const parentBranch = parentIfInfo
        ? args[index++]
        : null;

      // Ignore the node when its parent branch is not active.
      if (
        parentIfInfo &&
        parentBranch !== parentIfInfo.branch
      ) {
        return null;
      }

      if (value == null) {
        return null;
      }

      return evalCondition(
        value,
        node.config.operator,
        node.config.value
      )
        ? "true"
        : "false";
    }
  });

  protoNodes.push({
    name: node.id,
    path: node.id,
    type: "SINGLE",
    dep,
    la: {
      type: "CUSTOM_FUNCTION",
      functionName
    }
  });
}

// -----------------------------------------------------------------------------
// OUTPUT node
// -----------------------------------------------------------------------------

function buildOutputNode(
  workflow,
  node,
  varSource,
  incomingBranch,
  protoNodes,
  customFunctions
) {
  const dep = [];
  const branchInfo = incomingBranch.get(node.id);

  // Output can be enabled by a specific IF branch.
  if (branchInfo) {
    dep.push(
      createDependency(
        branchInfo.ifNodeId,
        "branch"
      )
    );
  }

  // Variable output depends on the node that produces the variable.
  let varNodeId = null;

  if (node.config.mode === "variable") {
    varNodeId = resolveVariableNode(
      workflow,
      varSource,
      node.config.value
    );

    if (varNodeId) {
      dep.push(
        createDependency(
          varNodeId,
          "value"
        )
      );
    }
  }

  const functionName = `out_${node.id}`;

  customFunctions.push({
    name: functionName,

    implementation: (...args) => {
      let index = 0;

      const branchValue = branchInfo
        ? args[index++]
        : null;

      const variableValue = varNodeId
        ? args[index++]
        : null;

      // Do not produce output for an inactive branch.
      if (
        branchInfo &&
        branchValue !== branchInfo.branch
      ) {
        return null;
      }

      return node.config.mode === "variable"
        ? variableValue
        : node.config.value;
    }
  });

  protoNodes.push({
    name: node.id,
    path: node.id,
    type: "SINGLE",
    dep,
    la: {
      type: "CUSTOM_FUNCTION",
      functionName
    }
  });
}

// -----------------------------------------------------------------------------
// Workflow execution
// -----------------------------------------------------------------------------

/**
 * Executes the workflow through WaveBinder.
 *
 * WaveBinder handles:
 * - native GET requests
 * - dependency propagation
 * - custom IF conditions
 * - jsonPath extraction
 * - output generation
 */
export async function runWorkflow(
  workflow,
  { onEvent = () => {} } = {}
) {
  const {
    protoNodes,
    customFunctions,
    extApis
  } = buildGraph(workflow);

  // A workflow must contain at least one node.
  if (protoNodes.length === 0) {
    onEvent({
      type: "log",
      level: "error",
      message: "Workflow vuoto: aggiungi almeno un nodo."
    });

    onEvent({
      type: "done",
      error: true
    });

    return null;
  }

  const wb = new WaveBinder(
    license,
    protoNodes,
    extApis,
    customFunctions
  );

  wb.tangleNodes();

  // Wait for WaveBinder initialization.
  await wb.waitUntilReady().catch(() => {});

  if (!wb.isReady()) {
    onEvent({
      type: "log",
      level: "error",
      message:
        "WaveBinder non pronto (licenza/rete): esecuzione annullata."
    });

    onEvent({
      type: "done",
      error: true
    });

    return null;
  }

  // Skip the initial null emitted by every BehaviorSubject.
  const firstSeen = new Set();

  // Keep events buffered until all REST calls are complete.
  const eventBuffer = [];

  const bufferedEvent = (event) => {
    eventBuffer.push(event);
  };

  // Track REST calls that have completed.
  const restCallIds = new Set(
    workflow.nodes
      .filter((node) => node.type === "rest-call")
      .map((node) => node.id)
  );

  const restCallDone = new Set();

  // Send buffered events once all REST calls are finished.
  const flushIfReady = () => {
    if (
      restCallDone.size < restCallIds.size
    ) {
      return;
    }

    // Outputs are always sent last.
    const nonOutput = eventBuffer.filter(
      (event) =>
        event.type !== "output" &&
        !(
          event.type === "log" &&
          event._isOutput
        )
    );

    const outputEvents = eventBuffer.filter(
      (event) =>
        event.type === "output" ||
        event._isOutput
    );

    [...nonOutput, ...outputEvents].forEach(
      (event) => {
        const {
          _isOutput,
          ...cleanEvent
        } = event;

        onEvent(cleanEvent);
      }
    );

    eventBuffer.length = 0;
  };

  // ---------------------------------------------------------------------------
  // Subscribe to all WaveBinder nodes
  // ---------------------------------------------------------------------------

  protoNodes.forEach((protoNode) => {
    const wbNode = wb.getNodeByName(protoNode.name);

    wbNode.subscribe((value) => {
      // Ignore the initial BehaviorSubject value.
      if (!firstSeen.has(protoNode.name)) {
        firstSeen.add(protoNode.name);
        return;
      }

      // Ignore intermediate null propagation.
      if (value === null) {
        return;
      }

      const isExtract =
        protoNode.name.endsWith("__extract");

      const baseId = isExtract
        ? protoNode.name.replace(
            /__extract$/,
            ""
          )
        : protoNode.name;

      const workflowNode = workflow.nodes.find(
        (node) => node.id === baseId
      );

      if (!workflowNode) {
        return;
      }

      // -----------------------------------------------------------------------
      // REST CALL events
      // -----------------------------------------------------------------------

      if (workflowNode.type === "rest-call") {
        // With jsonPath, the final value comes from __extract.
        if (isExtract) {
          bufferedEvent({
            type: "node-start",
            nodeId: baseId
          });

          bufferedEvent({
            type: "log",
            level: "info",
            message:
              `GET ${workflowNode.config.url} ` +
              `→ ${workflowNode.config.saveAs} = ` +
              `${JSON.stringify(value)}`
          });

          bufferedEvent({
            type: "node-end",
            nodeId: baseId
          });

          restCallDone.add(baseId);
          flushIfReady();

          return;
        }

        // Without jsonPath, the GET result is already final.
        if (!workflowNode.config.jsonPath) {
          bufferedEvent({
            type: "node-start",
            nodeId: baseId
          });

          bufferedEvent({
            type: "log",
            level: "info",
            message:
              `GET ${workflowNode.config.url} ` +
              `→ ${workflowNode.config.saveAs} = ` +
              `${JSON.stringify(value)}`
          });

          bufferedEvent({
            type: "node-end",
            nodeId: baseId
          });

          restCallDone.add(baseId);
          flushIfReady();

          return;
        }

        // With jsonPath, wait for the __extract node.
        return;
      }

      // -----------------------------------------------------------------------
      // IF events
      // -----------------------------------------------------------------------

      if (workflowNode.type === "if") {
        bufferedEvent({
          type: "node-start",
          nodeId: baseId
        });

        bufferedEvent({
          type: "log",
          level: "info",
          message:
            `if (${workflowNode.config.variable} ` +
            `${workflowNode.config.operator} ` +
            `${workflowNode.config.value}) -> ${value}`
        });

        bufferedEvent({
          type: "node-end",
          nodeId: baseId
        });

        return;
      }

      // -----------------------------------------------------------------------
      // OUTPUT events
      // -----------------------------------------------------------------------

      if (
        workflowNode.type === "output" &&
        value != null
      ) {
        bufferedEvent({
          type: "node-start",
          nodeId: baseId
        });

        bufferedEvent({
          type: "output",
          value,
          _isOutput: true
        });

        bufferedEvent({
          type: "log",
          level: "success",
          message: `Output: ${value}`,
          _isOutput: true
        });

        bufferedEvent({
          type: "node-end",
          nodeId: baseId,
          _isOutput: true
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Start independent REST calls
  // ---------------------------------------------------------------------------

  // WaveBinder starts dependent GETs automatically.
  // Root GET nodes have no dependencies, so they must be triggered manually.
  const restCallNodes = workflow.nodes.filter(
    (node) => node.type === "rest-call"
  );

  restCallNodes.forEach((node) => {
    const protoNode = protoNodes.find(
      (candidate) => candidate.name === node.id
    );

    if (
      protoNode &&
      protoNode.dep.length === 0
    ) {
      wb
        .getNodeByName(node.id)
        .next(null);
    }
  });

  // ---------------------------------------------------------------------------
  // Wait for outputs
  // ---------------------------------------------------------------------------

  // Wait until every output has produced a value,
  // or stop after the safety timeout.
  const outputNodeIds = workflow.nodes
    .filter((node) => node.type === "output")
    .map((node) => node.id);

  await new Promise((resolve) => {
    const resolved = new Set();

    const timeout = setTimeout(
      () => resolve(),
      3000
    );

    outputNodeIds.forEach((id) => {
      wb.getNodeByName(id)?.subscribe((value) => {
        if (value != null) {
          resolved.add(id);

          if (
            resolved.size ===
            outputNodeIds.length
          ) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });

    // No outputs means there is nothing to wait for.
    if (outputNodeIds.length === 0) {
      clearTimeout(timeout);
      resolve();
    }
  });

  // Release WaveBinder resources.
  wb.nukeNodes();

  onEvent({
    type: "done"
  });

  return null;
}