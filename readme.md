# TravelMate — Demo Workflow

## 1. What is TravelMate?

TravelMate is a small demo application that allows users to **create and run simple workflows visually**.

For example:

**Get weather → Check temperature → Show advice**

The user can see the workflow as a visual diagram, edit it, and run it step by step.

The goal is to create a simple demo of a **dynamic workflow editor and execution engine using Wavebuinder**.

---

## 2. Workflow Steps

The demo supports three types of steps:

| Step        | Description                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `if`        | Checks a condition on a variable or input defined by the user. It has a true and a false branch.                      |
| `rest-call` | Performs a GET request. The URL can be static or can contain variables. The response is saved in a workflow variable. |
| `output`    | Shows the final value of the workflow. It can be a variable or static text.                                           |



## 3. Pre-loaded Demo Workflows

The application includes some workflows ready to use.



## 4. Workflow Editor

The user can create and edit workflows using a visual editor.

The workflow diagram is drawn by the application using **custom SVG**.


## 5. Running a Workflow

The user can click a **Run** button to execute the workflow step by step.

During execution, the application should show two things at the same time:

### Visual execution

The active node is highlighted or animated in the workflow diagram.

### Execution log

A text log/console shows information such as:

```text
[10:32:01] REST Call started
[10:32:02] Response received
[10:32:02] IF: temperature > 20 → true
[10:32:02] OUTPUT: "Take an umbrella"
```



## 6. WaveBinder API Used

The demo uses the following API:

* `new WaveBinder(license, protoNodes, extApis, customFunctions)`
  Creates the WaveBinder.

* `wb.tangleNodes()`
  Connects the node dependencies.

* `wb.getNodeByName(name).next(value)`
  Sets the value of a `USER_SELECTION` node.

* `node.subscribe(value => ...)`
  Each node is an Observable. We subscribe to it to update the UI.

* `CUSTOM_FUNCTION` nodes
  These nodes are automatically recalculated when their dependencies change.


## 7. Getting Started

Add wavebinder-license.json file to src folder

Then, to install the dependencies and build the application, run:

```bash
npm install

npm run build | npx serve .
```

Then open the URL shown by `serve` in the browser.

## 8. Live demo

[[Watch the video!]](https://youtu.be/ST0M5JkJeAE)

