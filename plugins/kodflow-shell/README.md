# kodflow-shell

`super-claude` sur le PATH plutôt qu'un alias, un sélecteur de sessions sur TAB, un ménage
qui supprime vraiment une session, et la status line installée sans rien télécharger à la main.

## Installation

```bash
claude plugin marketplace add kodflow/claude-marketplace
claude plugin install kodflow-shell@kodflow
```

Le hook `SessionStart` fait le reste au prochain lancement de `claude` : il copie ce que le
plugin embarque dans `~/.claude/kodflow-shell/`, lie `super-claude` et `claude-sessions` dans
`~/.local/bin`, et branche l'implémentation zsh (via `$ZSH_CUSTOM` quand oh-my-zsh est là, une
ligne marquée dans `.zshrc` sinon). Rien à retaper après une mise à jour du marketplace :
la même synchronisation se rejoue à chaque lancement. En une ligne, tout de suite, sans
attendre la prochaine session : `/shell install`.

Le même hook installe **`status-line`** s'il manque : il récupère la release qui correspond à
la plateforme, vérifie sa somme de contrôle, la pose dans `~/.local/bin` et renseigne
`statusLine` dans `settings.json`.

macOS, Linux et Windows, en amd64 comme en arm64. Un shell Windows arrive ici par Git Bash,
MSYS2 ou Cygwin — qui annoncent leur propre noyau et non « Windows » — et récupère le `.exe` ;
WSL annonce Linux et prend le binaire Linux, ce qui est correct.

Deux choses qu'il ne fait pas, volontairement. Il ne réécrit jamais un `statusLine` déjà
configuré vers autre chose — c'est un choix, pas un défaut à corriger. Et il ne re-télécharge
pas à chaque lancement : le binaire consulte les releases lui-même une fois par heure et se
remplace, donc vérifier ici doublerait ce travail et cognerait l'API pour rien.

```bash
kodflow-statusline-setup --check       # ce qui est installé, et où pointe le réglage
kodflow-statusline-setup --force       # réinstaller par-dessus
kodflow-statusline-setup --uninstall   # retirer le binaire, et le réglage s'il est à nous
```

## Ce que ça donne

```
super-claude                  une session neuve ici
super-claude <TAB>            les sessions de ce dossier, puis celles des autres
super-claude <uuid>           reprend cette session, depuis son dossier d'origine
super-claude sessions [-a]    la liste, coloriée par âge
super-claude clean <niveau>   le ménage
super-claude help             tout
```

TAB filtre sur les **mots du titre** autant que sur l'id : `super-claude wifi<TAB>` trouve la
session « Hotspot wifi 5 GHz ». Les titres viennent des enregistrements `ai-title` que Claude
Code écrit lui-même dans le transcript — ceux que `/resume` affiche — avec, à défaut, le
premier vrai prompt de la session.

Les suggestions grises de zsh ne proposent plus que des sessions **qui existent encore** : les
`--resume <uuid>` morts qui traînaient dans l'historique sont filtrés, et une stratégie
d'autosuggestion les remplace par une session réelle du dossier courant.

## Ménage

| Niveau | Ce qu'il vise |
|---|---|
| `red` | les rouges seulement, plus de 7 jours |
| `warn` | les jaunes et les rouges, plus de 72 heures |
| `green` | toutes |

`-a` étend à tous les dossiers, `-n` simule. Chaque suppression demande confirmation, Entrée
vaut oui, `a` accepte les suivantes, `q` arrête.

Une session n'est pas seulement son transcript : `projects/<slug>/<id>/` (les transcripts de
sous-agents, plusieurs dizaines de Mo), `session-env/<id>`, `file-history/<id>`,
`tasks/session-<id8>` et `teams/session-<id8>` portent le même id et partent avec elle.
`exports/` est laissé intact : ces fichiers-là ont été demandés explicitement.

## Réglages

| Variable | Défaut | Effet |
|---|---|---|
| `CLAUDE_SESSIONS_FRESH_H` | 72 | en dessous, la session est verte |
| `CLAUDE_SESSIONS_WARN_D` | 7 | en dessous, jaune ; au-delà, rouge |
| `CLAUDE_SESSIONS_ALL` | 1 | 0 retire le groupe « autres dossiers » de la complétion |
| `CLAUDE_SESSIONS_MAX` | 40 | sessions proposées pour le dossier courant |
| `CLAUDE_SESSIONS_ALL_MAX` | 40 | sessions proposées pour les autres dossiers |
| `SUPER_CLAUDE_MODEL` | `default` | modèle d'un lancement : `SUPER_CLAUDE_MODEL=opus super-claude` |
| `NO_COLOR` | — | coupe les couleurs |

Les titres sont mis en cache dans `~/.cache/claude-sessions/`, invalidés par la date du
transcript : un TAB coûte ~45 ms à chaud, une frappe ~15 ms, même avec des transcripts de 10 Mo.

## Tests

```bash
./plugins/kodflow-shell/tests/run.zsh        # 30 assertions
```

Le ménage supprime des choses : la suite couvre les seuils d'âge, la simulation, les deux
manières dont l'entrée peut se fermer (pipe sans terminal, `^D` sur un pty), Entrée qui vaut
oui, `a` refusé par défaut puis accepté, la liste exacte de ce qu'une suppression emporte —
et ce qu'elle épargne —, le plafond d'affichage qui ne doit pas limiter le ménage, et
l'installateur (`--check` qui n'écrit rien, un lien étranger qu'on n'arrache pas, un fichier
retiré en amont qui disparaît du miroir). Tout tourne dans un `HOME` et un dossier de
configuration jetables : la suite ne peut pas voir une vraie session, encore moins la supprimer.

## Désinstallation

```bash
claude-sessions --help          # ce que ça fait
kodflow-shell-setup --uninstall # retire liens, copie et ligne de .zshrc
```

Les sessions Claude ne sont jamais touchées par la désinstallation.
