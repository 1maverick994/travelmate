// 3 workflow dimostrativi precaricati. Usano API pubbliche reali, senza chiave, CORS-friendly.
import { defaultConfigFor } from "./engine.js";

function node(id, type, x, y, config) {
  return { id, type, x, y, config: { ...defaultConfigFor(type), ...config } };
}

export function createDemoWorkflows() {
  return [
     {
      id: "demo-avanzato",
      name: "Meteo + Cambio -> Consiglio viaggio avanzato",
      startNodeId: "n1",
      nodes: [
        // ── API calls ──────────────────────────────────────────────────────
        node("n1", "rest-call", 40, 160, {
          url: "https://api.open-meteo.com/v1/forecast?latitude=45.4642&longitude=9.19&current=temperature_2m",
          jsonPath: "current.temperature_2m",
          saveAs: "temp"
        }),
        node("n2", "rest-call", 40, 340, {
          url: "https://api.frankfurter.dev/v1/latest?from=EUR&to=USD",
          jsonPath: "rates.USD",
          saveAs: "tasso"
        }),

        // ── Livello 1: estate? ─────────────────────────────────────────────
        node("n3", "if", 320, 160, { variable: "temp", operator: ">", value: "25" }),

        // ── Livello 2a: mezza stagione? (branch false di n3) ──────────────
        node("n4", "if", 320, 380, { variable: "temp", operator: ">", value: "10" }),

        // ── Livello 2b: gelido ma non sotto zero? (branch false di n4) ────
        node("n5", "if", 320, 580, { variable: "temp", operator: ">", value: "0" }),

        // ── Livello 3a: cambio in estate (branch true di n3) ──────────────
        node("n6", "if", 620, 60, { variable: "tasso", operator: "<", value: "1.10" }),

        // ── Livello 3b: cambio in mezza stagione (branch true di n4) ──────
        node("n7", "if", 620, 320, { variable: "tasso", operator: "<", value: "1.15" }),

        // ── Livello 3c: cambio in inverno (branch true di n5) ─────────────
        node("n8", "if", 620, 540, { variable: "tasso", operator: "<", value: "1.05" }),

        // ── Output (7 exit point) ──────────────────────────────────────────
        node("out-A", "output", 920, -40,  { mode: "text", value: "Vola ora! Clima e cambio perfetti \u2708\ufe0f\ud83c\udf1e" }),
        node("out-B", "output", 920, 120,  { mode: "text", value: "Clima top ma cambio alto, aspetta \ud83c\udf1e\u23f3" }),
        node("out-C", "output", 920, 260,  { mode: "text", value: "Buona stagione, cambio favorevole \ud83c\udf42\ud83d\udcb6" }),
        node("out-D", "output", 920, 380,  { mode: "text", value: "Stagione ok ma cambio alto, rimanda \ud83c\udf42\u23f3" }),
        node("out-E", "output", 920, 480,  { mode: "text", value: "Destinazione invernale + cambio straordinario \u2744\ufe0f\ud83d\udcb0" }),
        node("out-F", "output", 920, 600,  { mode: "text", value: "Freddo e cambio mediocre, rimanda \ud83e\udde4\u23f3" }),
        node("out-G", "output", 920, 720,  { mode: "text", value: "Temperatura sotto zero: sconsigliato viaggiare \u274c\ud83e\udd76" })
      ],
      edges: [
        // Catena sequenziale: meteo -> cambio -> primo if
        // tasso è già nel contesto quando i nodi if successivi lo leggono
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },

        // Livello 1
        { from: "n3", to: "n6", branch: "true"  },
        { from: "n3", to: "n4", branch: "false" },

        // Livello 2a
        { from: "n4", to: "n7", branch: "true"  },
        { from: "n4", to: "n5", branch: "false" },

        // Livello 2b
        { from: "n5", to: "n8", branch: "true"  },
        { from: "n5", to: "out-G", branch: "false" },

        // Livello 3a (estate)
        { from: "n6", to: "out-A", branch: "true"  },
        { from: "n6", to: "out-B", branch: "false" },

        // Livello 3b (mezza stagione)
        { from: "n7", to: "out-C", branch: "true"  },
        { from: "n7", to: "out-D", branch: "false" },

        // Livello 3c (inverno)
        { from: "n8", to: "out-E", branch: "true"  },
        { from: "n8", to: "out-F", branch: "false" }
      ]
    },
    {
      id: "demo-meteo",
      name: "Meteo -> consiglio abbigliamento",
      startNodeId: "n1",
      nodes: [
        node("n1", "rest-call", 40, 60, {
          url: "https://api.open-meteo.com/v1/forecast?latitude=45.4642&longitude=9.19&current=temperature_2m",
          jsonPath: "current.temperature_2m",
          saveAs: "temp"
        }),
        node("n2", "if", 320, 60, { variable: "temp", operator: ">", value: "20" }),
        node("n3", "output", 600, -20, { mode: "text", value: "Sereno, giornata calda \u2600\ufe0f" }),
        node("n4", "output", 600, 140, { mode: "text", value: "Porta l'ombrello, temperature basse \u2614" })
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3", branch: "true" },
        { from: "n2", to: "n4", branch: "false" }
      ]
    },
    {
      id: "demo-cambio",
      name: "Cambio EUR/USD -> prenota o aspetta",
      startNodeId: "n1",
      nodes: [
        node("n1", "rest-call", 40, 60, {
          url: "https://api.frankfurter.dev/v1/latest?from=EUR&to=USD",
          jsonPath: "rates.USD",
          saveAs: "tasso"
        }),
        node("n2", "if", 320, 60, { variable: "tasso", operator: "<", value: "1.15" }),
        node("n3", "output", 600, -20, { mode: "text", value: "Prenota ora: cambio favorevole \ud83d\udcb6" }),
        node("n4", "output", 600, 140, { mode: "text", value: "Aspetta: cambio ancora alto \u23f3" })
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3", branch: "true" },
        { from: "n2", to: "n4", branch: "false" }
      ]
    },
    {
      id: "demo-battuta",
      name: "Battuta random -> contiene 'Chuck'?",
      startNodeId: "n1",
      nodes: [
        node("n1", "rest-call", 40, 60, {
          url: "https://api.chucknorris.io/jokes/random",
          jsonPath: "value",
          saveAs: "battuta"
        }),
        node("n2", "if", 320, 60, { variable: "battuta", operator: "contains", value: "Chuck" }),
        node("n3", "output", 600, -20, { mode: "text", value: "Battuta autoreferenziale trovata \ud83e\udd4b" }),
        node("n4", "output", 600, 140, { mode: "text", value: "Chuck non nominato stavolta \ud83e\udd14" })
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3", branch: "true" },
        { from: "n2", to: "n4", branch: "false" }
      ]
    }   
  ];
}
