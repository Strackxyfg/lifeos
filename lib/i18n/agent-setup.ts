/**
 * The guide that puts the agent on a server, in both languages.
 * `agentSetupFr` is typed from `agentSetupEn`: a key in one and not the
 * other does not compile.
 *
 * The words name what the person sees on their own screen (LifeOS → Agent →
 * Install on a server, Generate token) and what the installer prints, which
 * says the same in its own text (agent-runner/install.sh): keep them in step.
 */

export const agentSetupEn = {
  title: "Install on a server",
  intro:
    "Your agent runs on a server of yours, never on your computer. About five minutes: one command, two pastes, and every step is checked before anything is installed.",
  state: {
    none: "Not installed yet",
    never: "Token ready — waiting for your agent",
    online: "Connected · heard {ago}",
    offline: "Silent for {ago}",
  },
  connected: "Your agent is connected. Write to it in Messages: it answers within seconds.",
  offlineHelp:
    "LifeOS has not heard from it for a while: the server may be off, or the agent stopped. On the server, run lifeos-agent status — it says which.",
  neverHelp: "Waiting for the first call from your server — LifeOS checks every 4 seconds.",
  step1: {
    title: "A server",
    body: "A VPS running Ubuntu 24.04 or Debian 12. 1 GB of memory is plenty — the agent itself uses about 40 MB. Connect to it with SSH:",
    ssh: "ssh root@YOUR-SERVER-ADDRESS",
    none:
      "No server yet? Hetzner, OVHcloud, Scaleway, Hostinger or Oracle Cloud's free tier all fit. Pick a European region if your data must stay in Europe.",
  },
  step2: {
    title: "A model key",
    body:
      "Your agent thinks with an AI model. Groq has a free tier with no card: create a key at console.groq.com/keys. Mistral (hosted in the EU) and OpenRouter work too. The key stays on your server — LifeOS never sees it.",
    groq: "Open Groq's API keys",
  },
  step3: {
    title: "The token and the command",
    body: "Generate the token your server will use, then paste the command on the server. It asks for the token, then the model key, and checks both before installing anything.",
    generate: "Generate token",
    regenerate: "Generate a new token",
    tokenOnce: "Copy it now — it is never shown again.",
    replaceWarning:
      "A new token disconnects the agent running now (and Hermes, if it uses the same one) until you give it the new token: lifeos-agent token on the server.",
    command: "On the server:",
    commandHint: "Nothing secret is in the command: the token is pasted when the installer asks, so it never lands in your shell's history.",
  },
  step4: {
    title: "The check",
    idle: "Once the installer has run on the server, this turns green on its own.",
    watching: "Watching for it — LifeOS checks every 4 seconds.",
    done: "LifeOS hears your agent.",
  },
  local:
    "This address ({origin}) can only be reached from your computer: a server cannot get to it. Deploy LifeOS first, then come back here from its public address.",
  commands: {
    title: "On the server, afterwards",
    status: "Is it running? Does LifeOS hear it?",
    logs: "What it is doing, live",
    update: "The latest agent, from your LifeOS",
    token: "After generating a new token",
    config: "Another model or model key",
    doctor: "Every check, changing nothing",
    uninstall: "Remove it from the server",
  },
  safety:
    "What the server holds: a revocable token and your model key — no access to the database, Notion or payments. Every action goes through LifeOS's rules, and the kill switch or Revoke stop it at once, wherever it runs.",
  revoke: "Revoke",
  revoked: "Token revoked: the agent can no longer reach LifeOS.",
  copy: "Copy",
  copied: "Copied",
  show: "Show the steps",
  hide: "Hide the steps",
};

export type AgentSetupMessages = typeof agentSetupEn;

export const agentSetupFr: AgentSetupMessages = {
  title: "Installer sur un serveur",
  intro:
    "Votre agent tourne sur un serveur à vous, jamais sur votre ordinateur. Comptez cinq minutes : une commande, deux collages, et chaque étape est vérifiée avant que rien ne soit installé.",
  state: {
    none: "Pas encore installé",
    never: "Jeton prêt — en attente de votre agent",
    online: "Connecté · entendu {ago}",
    offline: "Silencieux depuis {ago}",
  },
  connected: "Votre agent est connecté. Écrivez-lui dans Messages : il répond en quelques secondes.",
  offlineHelp:
    "LifeOS ne l'a pas entendu depuis un moment : le serveur est peut-être éteint, ou l'agent arrêté. Sur le serveur, lancez lifeos-agent status — il dit lequel.",
  neverHelp: "En attente du premier appel de votre serveur — LifeOS vérifie toutes les 4 secondes.",
  step1: {
    title: "Un serveur",
    body: "Un VPS sous Ubuntu 24.04 ou Debian 12. 1 Go de mémoire suffit largement — l'agent lui-même en utilise environ 40 Mo. Connectez-vous-y en SSH :",
    ssh: "ssh root@ADRESSE-DE-VOTRE-SERVEUR",
    none:
      "Pas encore de serveur ? Hetzner, OVHcloud, Scaleway, Hostinger ou l'offre gratuite d'Oracle Cloud conviennent. Choisissez une région européenne si vos données doivent rester en Europe.",
  },
  step2: {
    title: "Une clé de modèle",
    body:
      "Votre agent pense avec un modèle d'IA. Groq a une offre gratuite, sans carte : créez une clé sur console.groq.com/keys. Mistral (hébergé dans l'UE) et OpenRouter conviennent aussi. La clé reste sur votre serveur — LifeOS ne la voit jamais.",
    groq: "Ouvrir les clés d'API de Groq",
  },
  step3: {
    title: "Le jeton et la commande",
    body: "Générez le jeton qu'utilisera votre serveur, puis collez la commande sur le serveur. Elle demande le jeton, puis la clé du modèle, et vérifie les deux avant d'installer quoi que ce soit.",
    generate: "Générer un jeton",
    regenerate: "Générer un nouveau jeton",
    tokenOnce: "Copiez-le maintenant — il ne sera plus jamais affiché.",
    replaceWarning:
      "Un nouveau jeton déconnecte l'agent actuel (et Hermes, s'il utilise le même) jusqu'à ce que vous lui donniez le nouveau : lifeos-agent token sur le serveur.",
    command: "Sur le serveur :",
    commandHint: "Rien de secret dans la commande : le jeton se colle quand l'installateur le demande, il ne reste donc pas dans l'historique de votre terminal.",
  },
  step4: {
    title: "La vérification",
    idle: "Une fois l'installateur lancé sur le serveur, ce statut passe au vert tout seul.",
    watching: "LifeOS le guette — vérification toutes les 4 secondes.",
    done: "LifeOS entend votre agent.",
  },
  local:
    "Cette adresse ({origin}) n'est joignable que depuis votre ordinateur : un serveur ne peut pas l'atteindre. Déployez d'abord LifeOS, puis revenez ici depuis son adresse publique.",
  commands: {
    title: "Sur le serveur, ensuite",
    status: "Il tourne ? LifeOS l'entend ?",
    logs: "Ce qu'il fait, en direct",
    update: "La dernière version, depuis votre LifeOS",
    token: "Après avoir généré un nouveau jeton",
    config: "Un autre modèle ou une autre clé",
    doctor: "Tout vérifier, sans rien changer",
    uninstall: "Le retirer du serveur",
  },
  safety:
    "Ce que garde le serveur : un jeton révocable et votre clé de modèle — aucun accès à la base, à Notion ni aux paiements. Chaque action passe par les règles de LifeOS, et l'arrêt d'urgence ou « Révoquer » l'arrêtent aussitôt, où qu'il tourne.",
  revoke: "Révoquer",
  revoked: "Jeton révoqué : l'agent ne peut plus joindre LifeOS.",
  copy: "Copier",
  copied: "Copié",
  show: "Voir les étapes",
  hide: "Masquer les étapes",
};
