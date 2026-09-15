---
name: shell
description: Install, verify or remove the shell integration this plugin ships — `super-claude`
  as a real command on PATH, the TAB session picker that only offers conversations that still
  exist, and `super-claude clean`. Reports what is wired, what drifted and what shadows what,
  then repairs it. The SessionStart hook already does this at every launch; this skill is
  for the first install, for a machine where the hook has not run yet, and for diagnosing.
  Use when right after installing kodflow-shell, on a machine where `super-claude` is not
  found or still resolves to an old alias, after changing shells, or to check what the plugin
  wired before removing it.
metadata:
  short-description: Install, verify or remove the shell integration this plugin ships — `super-claud
  generated-from: plugins/*/skills/shell
  argument-hint: '[check|install|uninstall]'
---

# shell — the shell side of the harness

`kodflow-shell` puts three things on the system and keeps them in sync:

| Ce qui est posé | Où | Pourquoi là |
|---|---|---|
| `super-claude`, `claude-sessions` | liens dans `~/.local/bin` | déjà dans le PATH, donc aucune variable à modifier |
| l'implémentation zsh | `$ZSH_CUSTOM/kodflow-shell.zsh` (oh-my-zsh la source seule) sinon une ligne marquée dans `.zshrc` | complétion et autosuggestion vivent dans le shell interactif, pas dans un binaire |
| le contenu du plugin | copié dans `~/.claude/kodflow-shell/` | le plugin s'installe dans un chemin versionné qui disparaît à chaque update ; les liens pointent vers un chemin stable |

Le hook `SessionStart` relance la synchronisation à chaque lancement de Claude : mettre à jour
le marketplace suffit à mettre à jour le shell, sans rien retaper.

## Marche à suivre

1. **`check`** (défaut si l'utilisateur demande un état) — lancer
   `"${CLAUDE_PLUGIN_ROOT}"/bin/kodflow-shell-setup --check` et rapporter chaque ligne telle
   quelle. Ne rien modifier.
2. **`install`** — lancer `"${CLAUDE_PLUGIN_ROOT}"/bin/kodflow-shell-setup`. Le script est
   idempotent : sur une machine déjà câblée il ne fait que comparer une somme de contrôle.
3. **`uninstall`** — lancer `"${CLAUDE_PLUGIN_ROOT}"/bin/kodflow-shell-setup --uninstall`, puis
   dire explicitement que **les sessions Claude ne sont pas touchées** : le script ne supprime
   que ses propres liens et sa copie.

## Ce qu'il faut vérifier et dire

- `type super-claude` doit répondre un chemin dans `~/.local/bin`, **pas** « is a shell function ».
  Une fonction du même nom masque la commande : le plugin livrerait des mises à jour que
  personne n'exécute. Le setup commente l'ancienne définition dans `~/.shell-functions.sh` et
  en garde une sauvegarde `.pre-kodflow-shell` — le dire quand ça arrive.
- Après un premier install, la complétion n'est active que dans un **nouveau** shell (`exec zsh`).
  Le dire au lieu de laisser croire que ça n'a pas marché.
- Si `~/.local/bin` n'est pas dans le PATH, le script le signale : c'est la seule chose que
  l'utilisateur doit corriger lui-même, dans son `.zshrc` ou `.profile`.

## Ce que l'intégration donne, une fois posée

```
super-claude                  session neuve ici
super-claude <TAB>            les sessions de ce dossier puis des autres, filtrées sur les
                              mots du titre autant que sur l'id, âge colorié
super-claude <uuid>           reprend — depuis le dossier d'origine de la session
super-claude sessions [-a]    la liste
super-claude clean red|warn|green [-a] [-n]
                              supprime les vieilles sessions, une confirmation par session
                              (Entrée = oui), avec tout ce qui est indexé sur leur id
```

Les titres ne sont pas inventés : Claude Code écrit lui-même des enregistrements
`{"type":"ai-title"}` dans le transcript, et c'est ce que la liste affiche.
