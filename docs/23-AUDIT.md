# Audit interne — 3 novembre 2026

Audit de LifeOS sur `main` après le module Ventes : sécurité (dépendances,
routes, actions serveur, identité), fiabilité de l'IA, performance du
navigateur, langue, et complétude en tant que progiciel. Chaque constat ci-dessous
a été vérifié (test, mesure ou essai réel) ; rien n'est supposé.

## Verdict : un progiciel, avec quatre conditions de mise en vente

LifeOS couvre aujourd'hui le cœur de gestion d'une TPE ou d'un indépendant
français : CRM et pipeline, projets et tâches, trésorerie et runway datés,
**devis, factures et avoirs conformes** (numérotation continue, mentions
légales, immutabilité garantie par la base), paiements reliés aux finances,
**journal des ventes pour l'expert-comptable**, **relances de paiement**,
revue hebdomadaire, rapport investisseurs, trois éditions, SSO/SCIM pour
l'entreprise, un agent qui agit sur tout cela avec garde-fous, une application
Windows. C'est un progiciel au sens propre : un logiciel standard, paramétrable
(l'entreprise, le catalogue, l'édition), qui sert le même métier à beaucoup de
clients.

Ce qui manque pour le **vendre** — aucune de ces décisions ne m'appartient :

1. **Paiement** : Stripe n'est pas branché au parcours d'achat ; les prix sont
   à fixer (édition Équipe par siège, Personnel gratuit ou non).
2. **Pages légales** : mentions légales, CGU/CGV, politique de confidentialité —
   obligatoires en France (LCEN, RGPD) ; elles exigent l'identité de l'éditeur,
   que je n'invente pas.
3. **Migrations 013 à 017** à appliquer sur le Supabase de production, puis le
   parcours ventes à refaire une fois sur la vraie base (017 n'a été que relue :
   pas de Postgres sur ce poste).
4. **Crédits OpenRouter** : la clé fonctionne, le compte est à 0 crédit acheté
   (voir §2).

## 1. Sécurité

| Constat | Gravité | État |
|---|---|---|
| zod 3.25.76 : épuisement mémoire par tableau d'éléments invalides (GHSA-mrhx-c7xc-m3w5, CVE-2023-54404) ; aucun correctif en 3.x | Élevée | **Corrigé** — zod 4.6.7 (07b5a64) |
| qs 6.16.0 sous Stripe : déni de service (GHSA-6pq8-jhm2-2vcw) | Modérée | **Corrigé** — 6.16.1 (07b5a64) |
| 12 routes API lisaient le corps entier en mémoire avant tout contrôle ; 9 sans aucune limite | Élevée | **Corrigé** — lecture bornée en flux, 413 au-delà (07b5a64) |
| Actions serveur appelables par un POST sur n'importe quelle page (`/login` compris) : les écritures du cerveau, de la mémoire et de l'espace de travail tombaient, déconnecté, sur le compte de démonstration partagé | Moyenne (sans Supabase) | **Corrigé** — `writerKey()` refuse ; un test l'impose à toute action (07b5a64) |
| vitest 2.1.9 (outil de développement) : 2 critiques, 1 élevée | Critique (poste de dev) | **Corrigé** — vitest 5.0.5, vite 8.3.4 (57fb266) |
| ESLint : 14 alertes modérées (minimatch), sans version corrigée dans sa gamme ; ESLint n'est d'ailleurs pas configuré | Modérée (dev) | Ouvert — configurer ESLint (config « flat ») ou le retirer |
| Pas de Content-Security-Policy | Moyenne | Ouvert — à poser avec des nonces (Next.js) |
| Cookies de session httpOnly : jamais vérifiés sur un vrai projet Supabase | Moyenne | Ouvert — à vérifier au déploiement |

`npm audit --omit=dev` : **0**. `npm audit` : 0 critique, 0 élevée.

## 2. IA et agent

- **La clé OpenRouter fonctionne** : les 9 modèles configurés répondent
  (Claude Sonnet/Opus/Haiku 5.5, GPT-6.1 Sol, GPT-6 Luna, Gemini 4 Argon,
  Kimi K3, DeepSeek V4 Pro et V4.1 Flash). La recherche web répond avec ses
  sources ; l'agent tourne sur Claude Sonnet 5.5, le mode approfondi sur Opus
  avec des sous-agents en parallèle.
- **Le compte n'a aucun crédit acheté** : OpenRouter refuse au-delà d'une petite
  marge (« can only afford 3789 tokens », puis « would exceed your available
  credits »). Il faut ajouter des crédits sur openrouter.ai.
- **Corrigé (3d8a3bf)** : un 402 « réduisez max_tokens » écartait tout OpenRouter
  pendant une heure, sans trace, et l'agent retombait sur Groq. Désormais : même
  modèle redemandé avec moins de tokens ; repos de 10 min seulement quand il
  n'y a plus rien ; chaque bascule journalisée (sans adresse ni clé).
- **Corrigé (3d8a3bf)** : les sous-agents de recherche ne recevaient pas l'outil
  de lecture de pages ; ils ne lisaient que les extraits de recherche.

## 3. Performance

Après zod 4, quatre pages chargeaient zod dans le navigateur. Corrigé
(798a197) — premier chargement : /onboarding 158 kB, /settings 162 kB,
/sales 166 kB, /sales/[id] 173 kB, tous sous leur niveau d'avant.

## 4. Langue

Erreurs affichées en anglais sur un écran français : formulaires rapides
(projets, opportunités, écritures) et connexion (phrases brutes de Supabase).
Corrigé (07b5a64) : chaque erreur nomme le champ dans la langue de la personne ;
la connexion traduit les codes d'erreur de Supabase.

## 5. Ce que je recommande ensuite, par ordre

1. Les quatre conditions de mise en vente ci-dessus.
2. Une surveillance des erreurs en production (aucune aujourd'hui) — demande un
   compte chez un fournisseur : votre choix.
3. Une Content-Security-Policy avec nonces.
4. ESLint configuré et ajouté aux contrôles (aujourd'hui : TypeScript, 1 114 tests, build).
5. Ventes : envoi de la facture par e-mail en PDF, factures récurrentes,
   ventes partagées entre membres d'une équipe (aujourd'hui, par personne).
