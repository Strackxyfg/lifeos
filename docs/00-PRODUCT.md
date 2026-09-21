# LifeOS AI — description produit

> État au 21 septembre 2026, **établi depuis le code**, pas depuis le cahier des
> charges initial. Plusieurs choses ont changé depuis ; certaines promesses du
> site ne sont pas encore construites. Les deux sont indiqués.

**Légende** — ✅ fonctionnel · 🟡 démonstration ou partiel · ⛔ annoncé, pas construit

---

## En une phrase

LifeOS AI construit en moins d'une minute un espace Notion complet et
personnalisé à partir de 10 questions, puis le fait vivre avec une IA qui
résume, conseille et — sous votre contrôle — agit à votre place.

## Pour qui

Fondateurs, freelances et managers qui veulent un vrai système d'organisation
sans passer un week-end à le construire, ni payer un consultant pour le faire.

---

## 1. Génération de l'espace Notion ✅

- **10 questions** : prénom, métier, objectifs (projets, finances, clients,
  habitudes, apprentissage, équipe, contenu…), nombre de projets, taille
  d'équipe, chiffre d'affaires, usage actuel de Notion, besoin d'un CRM, d'un
  suivi financier, d'une base de connaissances.
- **Connexion Notion** par OAuth, protégée contre le détournement (CSRF).
- **Jusqu'à 11 bases liées**, choisies selon les réponses : Projets, Tâches,
  Objectifs, Planning hebdo, Habitudes, Journal, CRM, Finance, Base de
  connaissances, Lectures, Comptes rendus de réunion — plus une page d'accueil.
- **Relations entre bases** (projets ↔ tâches…), construites en deux passes.
- **Progression en direct** pendant la génération.

---

## 2. L'application

| Module | État | Ce qu'il fait |
| --- | --- | --- |
| Tableau de bord | ✅ | indicateurs réels du workspace |
| Projets · CRM · Finance | ✅ | données réelles, persistées, états vides soignés |
| Second cerveau 3D | ✅ | cerveau interactif qu'on fait tourner ; 5 catégories — idées, pensées, prochaines actions, connaissances, insights ; capture assistée par IA |
| Assistant IA | ✅ | conversation en streaming qui connaît votre workspace |
| Résumé quotidien · bilan hebdo | ✅ | générés par IA depuis vos vraies données |
| Français / anglais | ✅ | interface intégralement bilingue |
| Analytics | 🟡 | graphiques de démonstration, données fictives |
| Équipe | 🟡 | page statique, aucune gestion réelle des membres |
| Facturation | ⛔ | plans définis, mais **aucun bouton ne déclenche le paiement** |

---

## 3. L'agent autonome — le différenciateur

Un agent IA qui travaille sur vos données, **sur un serveur séparé — jamais
sur votre ordinateur** — et qui ne peut rien faire de dangereux sans vous.

### Calibration
Test de 33 questions : le **Mini-IPIP** (20 items de personnalité, validés
scientifiquement, domaine public) et 12 items opérationnels (rapport à la
délégation, au risque, à la communication). Contrôles anti-triche : question
d'attention, détection des réponses toutes identiques. Un profil invalide
bride l'agent au minimum.

### Autonomie au choix
Quatre niveaux — **observer, assister, agir, étendre**. Le test recommande,
vous décidez ; l'écart est tracé.

### Garde-fous
- **Cinq niveaux de risque** par action. Le haut risque — envoyer un e-mail,
  lancer une publicité — exige **toujours** votre accord, quel que soit le
  niveau d'autonomie.
- **Jamais possible**, à aucun niveau : déplacer de l'argent, signer ou
  accepter des conditions en votre nom, lire des secrets, supprimer
  définitivement des données, modifier les réglages de sécurité.
- **Arrêt d'urgence**, quotas et budget quotidiens, **journal d'audit non
  modifiable**.
- **Il rédige, vous envoyez.** E-mails, campagnes et propositions commerciales
  arrivent en brouillon dans l'app ; rien ne part sans votre validation.

### Où lui parler
Chat intégré à LifeOS, et **Telegram** (appairage par code à usage unique — un
inconnu qui trouve le bot n'atteint jamais vos données).

### Ouvert
Serveur **MCP** standard : l'agent peut être **Hermes Agent** ou tout client
MCP. Un même agent peut répondre à la fois dans LifeOS et sur Telegram, avec
une mémoire commune.

### Ce qu'il sait réellement faire aujourd'hui

| | |
| --- | --- |
| ✅ | lire le second cerveau et le workspace · créer notes, tâches, projets, opportunités · rédiger e-mails, campagnes, propositions · envoyer un e-mail validé *(si un fournisseur d'envoi est configuré)* |
| ⛔ | écrire dans Notion · gérer l'agenda · chercher sur le web · publier sur Slack · lancer une publicité · appeler un service externe · exécuter du code |

Les actions ⛔ répondent « non implémenté » au lieu de prétendre avoir réussi :
l'agent ne peut pas dire qu'il a envoyé quelque chose qu'il n'a pas envoyé.

---

## 4. Tarifs — promis et réel

| Plan | Prix | Promis sur le site | Réellement disponible |
| --- | --- | --- | --- |
| **Starter** | 19 $/mois | génération complète, 10 bases, synchro Google & Apple Calendar, résumés quotidiens, 1 espace | tout **sauf la synchro agenda** |
| **Pro** | 49 $/mois | + CRM & Finance, bilans hebdo IA, Gmail · Slack · GitHub, assistant vocal, 3 espaces | **ni Gmail/Slack/GitHub, ni assistant vocal** |
| **Founder** | 99 $/mois | + collaboration d'équipe, automatisations, analytics & KPI, espaces illimités | **aucune des trois premières** |

Les limites par plan (nombre d'espaces, de générations) sont définies mais
**jamais appliquées**.

**Seule intégration réellement branchée : Notion.** Le site affiche aussi
Google Calendar, Gmail, Slack, GitHub et Stripe comme intégrations.

---

## 5. Technique

Next.js 15 · React 19 · TypeScript strict · Supabase (authentification,
Postgres, sécurité ligne par ligne) · API Notion · Groq / Cerebras · Stripe ·
Vercel · agent sur VPS en conteneur durci · 116 tests automatisés.

---

## 6. Avant de lancer — trois bloquants

**1. Personne ne peut payer.** La création de session Stripe existe dans le
code mais n'est appelée nulle part ; le bouton « Change plan » renvoie vers une
ancre de la page. Le produit ne peut pas générer un euro.

**2. Les témoignages sont inventés.** Quatre citations avec des noms et
fonctions fictifs — dont une qui invoque une entreprise réelle — affichées en
production sur la page d'accueil.

**3. Le site promet des fonctions qui n'existent pas.** Synchro agenda,
Gmail/Slack/GitHub, assistant vocal, collaboration d'équipe, automatisations,
analytics.

Les points 2 et 3 relèvent en France des **pratiques commerciales trompeuses**
(Code de la consommation). Les faux avis de consommateurs figurent sur la liste
noire européenne depuis la directive « Omnibus » : ils sont interdits en toutes
circonstances, sans qu'il soit nécessaire de prouver un préjudice. À faire
valider par un avocat avant lancement.

---

## Ce qui rend le produit défendable

- **La vitesse** : un système complet en une minute, là où un consultant
  facture des milliers d'euros et un week-end de configuration.
- **La personnalisation** : 10 réponses déterminent les bases, leurs relations
  et leur contenu.
- **Un agent qu'on peut réellement laisser travailler** : c'est rare. La
  plupart des agents sont soit bridés au point d'être inutiles, soit
  dangereux. Le partage *rédiger librement / envoyer sous contrôle*, les
  garde-fous non contournables et l'exécution hors de la machine de
  l'utilisateur sont le vrai différenciateur.
