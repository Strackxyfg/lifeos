"use strict";

/**
 * The settings window. Reads what the app allows it to know (never a key's
 * value), sends back only what changed, and the app restarts to apply it.
 */
(function () {
  const WORDS = {
    fr: {
      title: "Paramètres de LifeOS",
      intro: "Où LifeOS fonctionne, et avec quels modèles d'IA. Les changements redémarrent l'application.",
      where: "Où fonctionne LifeOS",
      local: "Sur cet ordinateur",
      localHelp: "Vos données restent dans votre dossier Windows. Seuls les modèles d'IA sont appelés sur Internet, avec vos clés.",
      cloud: "En ligne",
      cloudHelp: "L'application ouvre votre espace LifeOS en ligne (votre compte, sur tous vos appareils).",
      cloudUrl: "Adresse de votre LifeOS en ligne",
      keys: "Clés d'IA (mode local)",
      keysHelp: "Ajoutez au moins une clé. Avec une clé Anthropic, OpenAI, DeepSeek ou OpenRouter, l'agent utilise un modèle de premier plan. Les clés sont chiffrées par Windows et ne sont jamais réaffichées.",
      noEncryption: "Le chiffrement de Windows n'est pas disponible : les clés ne peuvent pas être enregistrées.",
      set: "enregistrée",
      unset: "aucune",
      replace: "Nouvelle clé (laisser vide pour garder)",
      add: "Coller la clé",
      remove: "Retirer",
      removing: "sera retirée",
      save: "Enregistrer et redémarrer",
      saving: "Redémarrage…",
      version: "Version {v}",
      errors: {
        cloudUrl: "Indiquez une adresse https:// valide.",
        mode: "Choisissez où LifeOS fonctionne.",
        encryption: "Le chiffrement de Windows n'est pas disponible : la clé n'a pas été enregistrée.",
        key: "Cette clé ne semble pas valide (un seul mot, sans espace).",
        failed: "L'enregistrement a échoué.",
      },
    },
    en: {
      title: "LifeOS settings",
      intro: "Where LifeOS runs, and with which AI models. Changes restart the app.",
      where: "Where LifeOS runs",
      local: "On this computer",
      localHelp: "Your data stays in your Windows folder. Only the AI models are called over the internet, with your keys.",
      cloud: "Online",
      cloudHelp: "The app opens your online LifeOS (your account, on all your devices).",
      cloudUrl: "Address of your online LifeOS",
      keys: "AI keys (local mode)",
      keysHelp: "Add at least one key. With an Anthropic, OpenAI, DeepSeek or OpenRouter key the agent uses a frontier model. Keys are encrypted by Windows and never shown again.",
      noEncryption: "Windows encryption is not available: keys cannot be saved.",
      set: "saved",
      unset: "none",
      replace: "New key (leave empty to keep)",
      add: "Paste the key",
      remove: "Remove",
      removing: "will be removed",
      save: "Save and restart",
      saving: "Restarting…",
      version: "Version {v}",
      errors: {
        cloudUrl: "Enter a valid https:// address.",
        mode: "Choose where LifeOS runs.",
        encryption: "Windows encryption is not available: the key was not saved.",
        key: "This key does not look valid (one word, no spaces).",
        failed: "Saving failed.",
      },
    },
  };
  const PROVIDERS = [
    ["anthropic", "Anthropic (Claude)"],
    ["openai", "OpenAI"],
    ["deepseek", "DeepSeek"],
    ["openrouter", "OpenRouter"],
    ["mistral", "Mistral AI"],
    ["groq", "Groq"],
    ["cerebras", "Cerebras"],
  ];

  const $ = (id) => document.getElementById(id);
  const removed = new Set();
  let t = WORDS.en;

  function render(state) {
    t = WORDS[state.locale] || WORDS.en;
    document.documentElement.lang = state.locale;
    for (const el of document.querySelectorAll("[data-t]")) el.textContent = t[el.getAttribute("data-t")] || "";
    $("version").textContent = t.version.replace("{v}", state.version);
    for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === state.mode;
    $("cloudUrl").value = state.cloudUrl || "";
    $("no-encryption").hidden = state.encryption;

    const list = $("key-list");
    list.textContent = "";
    for (const [id, name] of PROVIDERS) {
      const row = document.createElement("div");
      row.className = "key";
      const label = document.createElement("label");
      const head = document.createElement("span");
      head.textContent = name + " ";
      const status = document.createElement("span");
      status.className = "status" + (state.keys[id] ? " set" : "");
      status.textContent = "· " + (state.keys[id] ? t.set : t.unset);
      head.appendChild(status);
      const input = document.createElement("input");
      input.type = "password";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.dataset.provider = id;
      input.placeholder = state.keys[id] ? t.replace : t.add;
      input.disabled = !state.encryption;
      label.append(head, input);
      row.appendChild(label);
      if (state.keys[id]) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "remove";
        rm.textContent = t.remove;
        rm.addEventListener("click", () => {
          removed.add(id);
          status.textContent = "· " + t.removing;
          status.className = "status";
          input.value = "";
          input.disabled = true;
          rm.disabled = true;
        });
        row.appendChild(rm);
      }
      list.appendChild(row);
    }
    syncMode();
  }

  function mode() {
    const r = document.querySelector('input[name="mode"]:checked');
    return r ? r.value : "local";
  }

  function syncMode() {
    $("cloud-field").hidden = mode() !== "cloud";
    $("keys").hidden = mode() !== "local";
  }

  function showError(code) {
    const key = String(code || "failed").startsWith("key:") ? "key" : code;
    $("error").textContent = t.errors[key] || t.errors.failed;
    $("error").hidden = false;
  }

  document.addEventListener("change", (e) => {
    if (e.target && e.target.name === "mode") syncMode();
  });

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("error").hidden = true;
    const keys = {};
    for (const input of document.querySelectorAll("input[data-provider]")) {
      const v = input.value.trim();
      if (v) keys[input.dataset.provider] = v;
    }
    for (const id of removed) keys[id] = "";
    const update = { mode: mode(), keys };
    if (mode() === "cloud") update.cloudUrl = $("cloudUrl").value.trim();
    $("save").disabled = true;
    $("save").textContent = t.saving;
    try {
      const res = await window.lifeosDesktop.save(update);
      if (!res || !res.ok) {
        showError(res && res.error);
        $("save").disabled = false;
        $("save").textContent = t.save;
      }
    } catch {
      showError("failed");
      $("save").disabled = false;
      $("save").textContent = t.save;
    }
  });

  window.lifeosDesktop.get().then(render, () => showError("failed"));
})();
