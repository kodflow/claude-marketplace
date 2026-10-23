# kodflow-workflow

La boucle de travail : ouvrir un sujet suivi, le documenter, le chercher, le planifier, le
contester, en faire un contrat exécutable, le livrer. Chaque skill passe à la suivante ce
dont elle a besoin et laisse une trace que la session suivante relit. La carte complète :
`/flow`.

## Installation

```bash
claude plugin marketplace add kodflow/claude-marketplace
claude plugin install kodflow-workflow@kodflow
```

## Les skills

| Skill | Ce qu'elle fait |
|-------|-----------------|
| `/project` | trouve ou crée le dépôt, consigne les contraintes dans `CLAUDE.md`, crée `docs/manifest.json` |
| `/warmup` | charge la hiérarchie des `CLAUDE.md` et le registre des contraintes |
| `/docs` | rédige les documents du projet qui manquent |
| `/search` | recherche une technologie et écrit un contexte pour `/plan` |
| `/plan` | décompose et conçoit, sans rien construire |
| `/challenge` | met le plan à l'épreuve de lentilles contradictoires |
| `/refine` | transforme un plan en contrat `/goal` vérifiable |
| `/git` | branche, commit, PR, suivi de la CI |
| `/feature` · `/fix` | ouvrent un sujet suivi et sa branche |
| `/flow` | dessine la carte des skills |
| `/recap` | l'état du travail en un tableau |

## `/docs` : les documents du projet

Un projet porte jusqu'à quinze documents : exigences produit et techniques, parcours, brief
de design, schéma de données, plan d'implémentation, ADR, ton, glossaire, qualité attendue,
stratégie de test, modèle de menaces, registre RGPD, PRA et runbooks, README. kodflow-hooks
calcule lesquels manquent et les montre dans un panneau dont le bouton « Créer » prépare :

```text
/kodflow-workflow:docs prd,data --mode both
```

| Mode | Comportement |
|------|--------------|
| `both` (défaut) | lit d'abord le dépôt, puis pose des questions sur ce qui manque ou reste douteux |
| `context` | le dépôt seul, le brouillon est montré avant d'être écrit |
| `ask` | des questions à choix (une à quatre à la fois, la recommandée en premier) |

Chaque affirmation cite son `fichier:ligne`, ou porte `(déduit)` ou `(à confirmer)`. Chaque
type de document a son modèle (`skills/docs/templates.md`) : fonctions une à une pour le PRD,
parcours en mermaid, schéma de données avec « qui voit quoi », plan d'implémentation en tâches
avec leurs dépendances, que `/docs` propose ensuite de créer comme tâches de l'épopée.

`docs/manifest.json`, versionné à la racine du dépôt, déplace un document (`path`) ou l'écarte
(`ignored`, avec sa raison). `/docs` ne l'écarte que sur une réponse de l'utilisateur, et ne
l'écrit que par `scripts/docs.sh`, qui garde les clés qu'il ne connaît pas. Sans manifeste,
chaque document est attendu à son chemin par défaut.

`/plan`, `/challenge` et `/refine` lisent les documents présents qui concernent le sujet,
comme les ADR, et signalent une contradiction avec eux.
