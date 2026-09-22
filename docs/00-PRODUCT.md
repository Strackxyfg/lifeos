# LifeOS — description produit

> État au 22 septembre 2026, **établi depuis le code**. Le produit a pivoté :
> ce n'est plus un générateur d'espaces Notion, c'est un second cerveau
> souverain avec un agent IA. Notion devient un export facultatif. Depuis, le
> cerveau se relie lui-même (section 2).

**Légende** — ✅ fonctionnel · 🟡 partiel · ⛔ pas construit

---

## En une phrase

Un second cerveau qui vous appartient : vous capturez vos pensées, LifeOS les
range, les relie et en tire votre focus du jour ; un agent IA travaille à partir
de ce que vous avez écrit, dans l'application et sur Telegram, dans les limites
que vous fixez.

## Pour qui

Fondateurs, freelances et managers qui pensent vite et oublient autant. Ils
veulent un endroit unique pour leurs idées, leurs objectifs et leurs prochaines
actions, et un assistant qui les connaît vraiment.

---

## 1. Le second cerveau ✅

- **Capture** au clavier ou à la voix, depuis la page du cerveau ou depuis
  n'importe quelle page (bouton « Capturer »). Chaque pensée est rangée dans
  une des **six régions** : objectifs, prochaines actions, idées, pensées,
  connaissances, insights. Classement par IA, repli sur des règles si l'IA est
  absente. Déplaçable en un clic.
- **Connexions** entre notes : tracées par LifeOS, expliquées, validées par
  vous (section 2).
- **Focus** déterministe : d'abord les actions qui font avancer un objectif,
  puis les objectifs sans prochaine action, puis ce qui attend, puis les idées
  récentes non reliées.
- **Résurgence** : chaque jour, une note d'il y a une semaine ou plus revient,
  de préférence une note isolée.
- **Recherche** instantanée, insensible aux accents.
- **Carte 3D** interactive : régions, notes et connexions.
- **Export complet** en Markdown (liens Obsidian) et en JSON.

## 2. Les connexions — ce qui fait la différence ✅

Un second cerveau ne vaut que par ce qu'il relie. Le nôtre comprend ses notes
et les relie lui-même.

**Comprendre.** Chaque note est lue une fois par le modèle, qui en extrait 2 à
5 **concepts** : une clé canonique en anglais (ce qui sert à comparer) et un
libellé dans la langue de la note (ce qui s'affiche). Une note française sur
le « parrainage » rencontre ainsi une note anglaise sur le « referral
program ». Une empreinte du texte évite de réanalyser une note inchangée, et
les clés déjà utilisées sont proposées au modèle pour qu'un même sujet garde
une même clé.

**Relier.** Les paires candidates — mots partagés, concepts partagés, et
toujours les objectifs ouverts, là où une action se cache sans partager un
mot — sont soumises au modèle, qui dit s'il existe une vraie relation :

| Type | Sens |
| --- | --- |
| **fait avancer** | une action, une idée ou un plan qui fait progresser un objectif |
| **étaye** | un fait, un chiffre ou une raison qui appuie une autre note |
| **développe** | une note qui prolonge ou affine une autre |
| **en tension avec** | deux notes qui se contredisent ou se disputent le même temps |
| **lié à** | même sujet précis, rien de plus fin |

Chaque connexion porte son **sens**, sa **direction**, une **confiance** et une
**raison en une phrase**, dans votre langue. Seules les plus sûres sont
tracées, et elles arrivent **« à valider »** : vous gardez ou vous retirez, et
un retrait est mémorisé — cette paire ne sera plus jamais proposée.

**Quand.** Après chaque capture (cerveau, barre du haut, accueil), et à la
demande avec « Organiser mon cerveau ». Les budgets sont calibrés sur le quota
par minute d'un fournisseur gratuit ; ce qui ne tient pas dans une passe est
repris à la suivante, sans rien perdre.

**Ce que ça donne, en vrai** (session de test) : le programme de parrainage
*fait avancer* l'objectif « Signer 10 clients » ; une statistique en anglais
*étaye* ce même objectif ; et « je n'ai plus le temps de m'entraîner le soir »
est détecté *en tension avec* « courir un semi-marathon ».

**Autour :**
- **Thèmes** : les sujets qui reviennent, calculés depuis les concepts.
- **Tensions** : une section à part, parce qu'une contradiction demande une décision.
- **Développer** : transformer un objectif ou une idée en prochaines actions
  concrètes, déjà reliées — et qui tiennent compte des tensions détectées.
- **Sans IA** : les suggestions par mots partagés restent, expliquées. Rien ne
  dépend d'une clé pour fonctionner.

## 3. L'accueil — natif, sans Notion ✅

Sept questions construisent le cerveau sur-le-champ :

| Question | Où va la réponse |
| --- | --- |
| Prénom, métier | profil |
| Objectif principal, second objectif | notes « objectif » |
| Prochaine action | note « prochaine action », **reliée à l'objectif** |
| Ce que vous avez en tête | une note par ligne, rangée par région |
| Domaines de vie | profil (l'assistant et l'agent en tiennent compte) |

Relancer l'accueil ne duplique rien : une note dont le titre existe déjà est
réutilisée. Le brouillon survit à un rechargement et à une reconnexion.

## 4. L'assistant ✅

Il répond **à partir du second cerveau** : qui vous êtes (profil), vos
objectifs, votre focus, les notes liées à la question **et ce à quoi ces notes
sont reliées** — le fait derrière une décision, l'action derrière un objectif,
la note qu'elle contredit. Il **cite ses sources** : les notes utilisées
s'affichent sous la réponse et s'ouvrent d'un clic. Sans clé IA, il le dit et
affiche le focus au lieu d'inventer.

## 5. L'agent autonome ✅

Un agent IA qui travaille sur vos données, **sur un serveur séparé — jamais
sur votre ordinateur** — et qui ne peut rien faire de dangereux sans vous.

- **Calibration** : test de 33 questions (Mini-IPIP + items opérationnels),
  avec contrôles anti-triche.
- **Autonomie au choix** : observer, assister, agir, étendre.
- **Garde-fous** : cinq niveaux de risque ; le haut risque exige toujours votre
  accord ; certaines actions sont impossibles à tout niveau (argent, signature,
  secrets, suppression définitive, sécurité) ; arrêt d'urgence ; journal
  d'audit non modifiable. Il rédige, vous envoyez.
- **Où lui parler** : dans l'app et sur Telegram. En mode relais
  (`AGENT_BACKEND=hermes`), c'est le même agent Hermes, avec la même mémoire.
- **Ce qu'il lit** : le second cerveau (avec votre profil) et le résumé de
  l'activité, via MCP.

| | Aujourd'hui |
| --- | --- |
| ✅ | lire et chercher dans le second cerveau · voir à quoi une note est reliée et pourquoi · relier deux notes avec un sens et une raison (marqué « agent, à valider ») · lancer le moteur de connexions · créer des notes (reliées automatiquement) · créer tâches, projets, opportunités · rédiger e-mails, campagnes, propositions · envoyer un e-mail validé *(si un fournisseur d'envoi est configuré)* |
| ⛔ | agenda · recherche web · Slack · publicité · services externes · exécution de code — ces actions répondent « non implémenté » au lieu de prétendre avoir réussi |

## 6. Le reste de l'activité ✅

Tableau de bord, projets, clients (CRM) et finances, avec de vraies données
persistées. Le **résumé du jour** et le **bilan de la semaine** partent
désormais du second cerveau — le focus dans l'ordre, les objectifs sans
prochaine action, les tensions à arbitrer, ce qui a été capturé et relié cette
semaine — puis situent les projets et les finances. Sans IA, le même texte est
calculé depuis les mêmes faits.

## 7. Notion — export facultatif ✅

Depuis les Paramètres, une fois Notion connecté : LifeOS montre les bases qu'il
va créer (un socle, plus un module par domaine de vie choisi), attend votre
clic, puis les crée dans la page partagée avec une page d'accueil. L'écran de
progression n'affiche que les étapes réellement exécutées. Sans connexion, il
refuse au lieu de simuler.

## 8. Vos données ✅

- Export Markdown / JSON à tout moment.
- **Suppression complète** depuis les Paramètres (mot à taper, vérifié côté
  serveur) : notes, connexions, projets, opportunités, transactions, tâches,
  profil. Le compte et le contenu Notion restent.

## 9. Tarifs — accès anticipé

Gratuit, sans carte. Prix affichés pour après l'accès anticipé :
**Essentiel 19 $**, **Pro 49 $**, **Souverain 99 $** par mois. Chaque promesse
de la grille correspond à une fonction qui existe. Rien n'est facturé : le
paiement n'est pas branché.

## 10. Technique

Next.js 15 · React 19 · TypeScript strict · Supabase (authentification,
Postgres, sécurité ligne par ligne) · Groq / Cerebras · API Notion · agent sur
VPS · interface intégralement bilingue (langue détectée au premier passage) ·
303 tests automatisés, dont des gardes contre les fausses allégations, les
routes non protégées et les caractères de contrôle dans le code.

---

## 11. Avant de lancer

1. **Appliquer les migrations 007 puis 008** dans Supabase. Sans 007 : pas de
   connexions, profil limité au navigateur. Sans 008 : les connexions restent
   simples (sans sens ni direction) et le moteur de connexions reste éteint —
   l'app le dit, elle ne fait pas semblant.
2. **Paiement** : Stripe n'est pas branché. Aucun revenu possible.
3. **Pages légales** : mentions légales, CGU et politique de confidentialité
   sont obligatoires pour un site commercial en France (LCEN, RGPD). Elles
   n'existent pas.
4. **Cohérence « souverain »** : les prix sont en dollars ; la région Supabase
   n'est pas vérifiée ; les questions et notes pertinentes partent chez Groq ou
   Cerebras (États-Unis). Le site ne revendique donc aucun hébergement européen.
   Pour que la promesse tienne : prix en euros, Supabase en région UE, et un
   fournisseur de modèle européen (Mistral, par exemple) en option.

## Ce qui a été retiré parce que c'était faux

Témoignages inventés (y compris sur la page de connexion) · « 2 400+ personnes
en attente » · une liste d'attente qui n'enregistrait rien et promettait un
e-mail jamais envoyé · « Généré en 47 s » · garantie de remboursement sur un
produit qui ne facture rien · « All systems operational » · « LifeOS AI, Inc. »
· intégrations Google Agenda, Gmail, Slack, GitHub, Stripe affichées
« Connecté » · e-mails de bilan jamais envoyés · fuseau horaire codé en dur ·
bouton de suppression sans effet · étapes de génération Notion jamais
exécutées · série d'habitudes de 23 jours transmise à l'IA · « MRR » qui était
le total des revenus.

## Ce qui rend le produit défendable

- **Un cerveau qui vous appartient** : formats ouverts, export et suppression
  à tout moment, rien d'inventé à l'écran.
- **Un focus qui découle de vos objectifs**, pas d'une liste de tâches de plus.
- **Des connexions qui ont un sens** — et qui se valident : le cerveau
  propose, vous tranchez, il se souvient de vos refus.
- **Un agent qu'on peut réellement laisser travailler** : rédiger librement,
  envoyer sous contrôle, garde-fous non contournables, exécution hors de la
  machine de l'utilisateur, le même agent dans l'app et sur Telegram.
