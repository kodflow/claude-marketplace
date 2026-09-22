#!/usr/bin/env zsh
# run.zsh — tests for the destructive paths of claude-sessions and for the
# installer. Everything happens inside a throwaway CLAUDE_CONFIG_DIR and a
# throwaway HOME: the suite can never see, let alone delete, a real session.
#
#   ./tests/run.zsh            run everything
#   ./tests/run.zsh -v         echo each command's output
emulate -L zsh
setopt no_unset

ROOT=${0:A:h:h}

# Anything that can point the installer outside the sandbox is neutralised here,
# once, for the whole suite.
#
# HOME alone is not enough: kodflow-shell-setup resolves the oh-my-zsh custom
# directory as ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}, so a ZSH_CUSTOM inherited
# from the developer's own shell wins over the fake HOME — and the suite then
# rewrites the real integration it was supposed to be isolated from. That is not
# hypothetical: it happened, and it left a symlink into a deleted sandbox where
# the working one had been, breaking every new terminal until it was repaired.
unset ZSH_CUSTOM ZSH ZDOTDIR 2>/dev/null
VERBOSE=0; [[ ${1:-} == -v ]] && VERBOSE=1
zmodload zsh/datetime
zmodload zsh/zpty

typeset -gi PASS=0 FAIL=0
# (( PASS++ )) returns the value BEFORE the increment: on the very first pass
# that is 0, i.e. a failure status, and `ok … || ko …` would then report the
# same assertion twice. Both helpers end on a true command.
ok()   { print -r -- "  ✓ $1"; (( PASS++ )); return 0 }
ko()   { print -r -- "  ✗ $1"; print -r -- "      $2"; (( FAIL++ )); return 0 }
is()   { [[ $2 == "$3" ]]  && ok "$1" || ko "$1" "attendu [$3], obtenu [$2]" }
has()  { [[ $2 == *"$3"* ]] && ok "$1" || ko "$1" "[$3] absent de [$2]" }
hasnt(){ [[ $2 != *"$3"* ]] && ok "$1" || ko "$1" "[$3] présent dans [$2]" }

# --- fixtures ---------------------------------------------------------------
# One sandbox per test: CLAUDE_CONFIG_DIR points into it, so the project slug,
# the session state and the cache all live under it.
# :A resolves the path the way the shell will report it from $PWD after a cd.
# Without it, macOS hands back a TMPDIR ending in a slash, mktemp doubles it,
# and the project slug the fixtures are written under ("…T--box-work") stops
# matching the one claude-sessions derives from $PWD ("…T-box-work") — so every
# fixture lands in a directory the program never reads.
SANDBOX=${$(mktemp -d "${TMPDIR:-/tmp}/kodflow-shell-tests.XXXXXX"):A}
trap 'rm -rf -- "$SANDBOX"' EXIT INT TERM

new_sandbox() {
  local box=$SANDBOX/$1
  mkdir -p $box/config $box/work
  print -r -- $box
}

# age_file <days> <file> — backdate a file.
#
# `touch -d "N days ago"` is GNU coreutils only: the BSD touch on macOS rejects
# that spelling, so every age-dependent test failed there. `touch -t` takes an
# absolute stamp both implementations understand.
#
# The local is named `file`, never `path`: in zsh `path` is tied to `PATH`, so
# assigning it would replace the command search path with this one filename and
# every external command after it would vanish.
age_file() {
  local days=$1 file=$2 when
  when=$(( EPOCHSECONDS - days * 86400 ))
  touch -t "$(strftime '%Y%m%d%H%M.%S' $when)" $file
}

# make_session <box> <id> <days old> [title]
make_session() {
  local box=$1 id=$2 days=$3 title=${4:-FIXTURE $2}
  local work=$box/work
  local pdir=$box/config/projects/${work//[^a-zA-Z0-9]/-}
  mkdir -p $pdir/$id/subagents $box/config/session-env/$id $box/config/file-history/$id
  mkdir -p $box/config/tasks/session-${id[1,8]} $box/config/teams/session-${id[1,8]}
  printf '{"type":"user","cwd":"%s","message":{"content":"bonjour"}}\n{"type":"ai-title","aiTitle":"%s"}\n' \
    "$work" "$title" > $pdir/$id.jsonl
  print -n "xxxxxxxxxx" > $pdir/$id/subagents/sub.jsonl
  age_file $days $pdir/$id.jsonl
  print -r -- $pdir
}

# run_setup <fakehome> [args...] — the installer, confined.
#
# Sets every variable it reads to somewhere inside the sandbox. ZSH_CUSTOM and
# ZDOTDIR especially: they are absolute paths that would otherwise survive the
# fake HOME and send the installer at the developer's own files.
run_setup() {
  local fh=$1; shift
  HOME=$fh CLAUDE_CONFIG_DIR=$fh/.claude ZSH_CUSTOM=$fh/.oh-my-zsh/custom \
    ZDOTDIR=$fh XDG_CACHE_HOME=$fh/cache \
    $ROOT/bin/kodflow-shell-setup "$@"
}

# run_cs <box> <stdin-mode: none|pty> <input> <args...>
# pty mode drives a real interactive zsh: [[ -t 0 ]] is true there, and what
# follows the input is a closed stream — exactly the case the EOF guards exist
# for. zpty -r takes a PATTERN, not a timeout, hence the sleeps.
run_cs() {
  local box=$1 mode=$2 input=$3; shift 3
  local out
  if [[ $mode == none ]]; then
    out=$(cd $box/work && CLAUDE_CONFIG_DIR=$box/config XDG_CACHE_HOME=$box/cache NO_COLOR=1 \
          $ROOT/bin/claude-sessions "$@" 2>&1 </dev/null) || true
  else
    zpty -b cs "TERM=dumb zsh -f"
    sleep 0.5
    zpty -w cs "cd $box/work"
    zpty -w cs "export CLAUDE_CONFIG_DIR=$box/config XDG_CACHE_HOME=$box/cache NO_COLOR=1"
    sleep 0.3
    zpty -w cs "$ROOT/bin/claude-sessions $*"
    sleep 1.5
    [[ -n $input ]] && zpty -w -n cs "$input"
    sleep 2
    local line acc=
    while zpty -r -t cs line; do acc+=$line; done
    zpty -d cs 2>/dev/null || true
    out=${acc//$'\r'/}
  fi
  print -r -- "$out"
  (( VERBOSE )) && print -r -- "----- $* -----\n$out\n-----" >&2
  return 0
}

count_sessions() { print -r -- ${#${(f)"$(ls $1/*.jsonl 2>/dev/null)"}:#} }
n_jsonl() { local -a f=($1/*.jsonl(N)); print -r -- ${#f} }

# --- 1. seuils d'âge --------------------------------------------------------
print -r -- "seuils"
box=$(new_sandbox seuils)
source $ROOT/shell/claude-sessions.zsh
is "moins de 72 h = vert"   "$(_claude_sessions_level $(( EPOCHSECONDS - 3600 )))"      0
is "71 h = vert"            "$(_claude_sessions_level $(( EPOCHSECONDS - 71*3600 )))"   0
is "73 h = jaune"           "$(_claude_sessions_level $(( EPOCHSECONDS - 73*3600 )))"   1
is "6 j = jaune"            "$(_claude_sessions_level $(( EPOCHSECONDS - 6*86400 )))"   1
is "7 j = rouge"            "$(_claude_sessions_level $(( EPOCHSECONDS - 7*86400 )))"   2

# --- 2. sélection vide ------------------------------------------------------
# {1..${#a}} vaut "1 0" sur un tableau vide en zsh : l'itération fantôme
# passait des chemins vides à du, qui remontait jusqu'à la racine.
print -r -- "sélection vide"
box=$(new_sandbox vide)
start=$EPOCHSECONDS
out=$(run_cs $box none "" clean green)
has "annonce qu'il n'y a rien" "$out" "Rien à nettoyer"
(( EPOCHSECONDS - start < 10 )) && ok "ne parcourt pas le système de fichiers" \
  || ko "ne parcourt pas le système de fichiers" "a pris $(( EPOCHSECONDS - start )) s"

# --- 3. simulation ----------------------------------------------------------
print -r -- "simulation"
box=$(new_sandbox dryrun)
pdir=$(make_session $box aaaaaaa1-0000-0000-0000-000000000001 30)
out=$(run_cs $box none "" clean red -n)
has "annonce la simulation" "$out" "Simulation"
is  "ne supprime rien"      "$(n_jsonl $pdir)" 1

# --- 4. EOF sans terminal ---------------------------------------------------
print -r -- "EOF"
box=$(new_sandbox eof-pipe)
pdir=$(make_session $box aaaaaaa1-0000-0000-0000-000000000001 30)
out=$(run_cs $box none "" clean red)
has "abandonne sans terminal" "$out" "pas de terminal"
is  "ne supprime rien"        "$(n_jsonl $pdir)" 1

# --- 5. EOF sur un pty (personne ne tape) -----------------------------------
box=$(new_sandbox eof-pty)
pdir=$(make_session $box aaaaaaa1-0000-0000-0000-000000000001 30)
# ^D on a pty is exactly what a closed input looks like to read.
out=$(run_cs $box pty $'\004' clean red)
has "abandonne à la fermeture de l'entrée" "$out" "entrée fermée"
is  "ne supprime rien"                     "$(n_jsonl $pdir)" 1

# --- 6. Entrée vaut oui -----------------------------------------------------
print -r -- "confirmations"
box=$(new_sandbox enter)
pdir=$(make_session $box aaaaaaa1-0000-0000-0000-000000000001 30)
out=$(run_cs $box pty $'\n' clean red)
is "Entrée supprime" "$(n_jsonl $pdir)" 0

# --- 7. « a » refusé par défaut ---------------------------------------------
box=$(new_sandbox bulk-no)
pdir=$(make_session $box aaaaaaa1-0000-0000-0000-000000000001 30)
make_session $box aaaaaaa2-0000-0000-0000-000000000002 30 >/dev/null
make_session $box aaaaaaa3-0000-0000-0000-000000000003 30 >/dev/null
out=$(run_cs $box pty $'a\n\nn\nn\nn\n' clean red)
has "« a » pose une deuxième question" "$out" "sans redemander"
is  "réponse vide = non"               "$(n_jsonl $pdir)" 3

# --- 8. « a » accepté -------------------------------------------------------
box=$(new_sandbox bulk-yes)
pdir=$(make_session $box aaaaaaa1-0000-0000-0000-000000000001 30)
make_session $box aaaaaaa2-0000-0000-0000-000000000002 30 >/dev/null
make_session $box aaaaaaa3-0000-0000-0000-000000000003 30 >/dev/null
out=$(run_cs $box pty $'a\ny\n' clean red)
is "« a » + y supprime tout le reste" "$(n_jsonl $pdir)" 0

# --- 9. ce qu'une suppression emporte --------------------------------------
print -r -- "portée de la suppression"
box=$(new_sandbox portee)
id=aaaaaaa1-0000-0000-0000-000000000001
pdir=$(make_session $box $id 30)
mkdir -p $box/config/exports; print -n keep > $box/config/exports/$id-20260101T000000Z
out=$(run_cs $box pty $'\n' clean red)
for art in "projects/${pdir:t}/$id.jsonl" "projects/${pdir:t}/$id" "session-env/$id" \
           "file-history/$id" "tasks/session-${id[1,8]}" "teams/session-${id[1,8]}"; do
  [[ ! -e $box/config/$art ]] && ok "supprime $art" || ko "supprime $art" "encore présent"
done
[[ -e $box/config/exports/$id-20260101T000000Z ]] && ok "épargne exports/" || ko "épargne exports/" "supprimé"

# --- 10. au-delà du plafond d'affichage -------------------------------------
# Les sélecteurs n'offrent que les 40 plus récentes ; le ménage doit voir tout,
# sinon clean épargne exactement les plus vieilles.
print -r -- "plafond"
box=$(new_sandbox plafond)
for i in {1..45}; do
  make_session $box "aaaa$(printf '%04d' $i)-0000-0000-0000-000000000001" 30 >/dev/null
done
pdir=$box/config/projects/${${box}//[^a-zA-Z0-9]/-}-work
out=$(run_cs $box none "" clean red -n)
has "les 45 sont vues" "$out" "45 session(s)"

# --- 11. les chargeurs n'écrivent rien sur la sortie standard ---------------
# Tout ce qu'ils impriment atterrit dans la ligne de commande quand la
# complétion les appelle. Un `local` répété suffit à salir l'écran.
print -r -- "silence des chargeurs"
box=$(new_sandbox silence)
# Au moins DEUX dossiers étrangers : la fuite ne commence qu'à la deuxième
# exécution du `local`, donc un seul dossier ne prouverait rien.
integer n=0
for d in $box/work $box/work-a $box/work-b $box/work-c; do
  (( n++ )); mkdir -p $d
  pdir=$box/config/projects/${d//[^a-zA-Z0-9]/-}
  mkdir -p $pdir
  printf '{"type":"user","cwd":"%s"}\n{"type":"ai-title","aiTitle":"T%d"}\n' "$d" $n \
    > $pdir/aaaaaaa$n-0000-0000-0000-00000000000$n.jsonl
done
noise=$(
  cd $box/work
  CLAUDE_CONFIG_DIR=$box/config XDG_CACHE_HOME=$box/cache zsh -f -c "
    source $ROOT/shell/claude-sessions.zsh
    _claude_sessions_load
    _claude_sessions_load_foreign
  " 2>/dev/null
)
is "aucune fuite sur la sortie" "$noise" ""

# --- 12. installateur : --check ne modifie rien -----------------------------
print -r -- "installateur"
box=$(new_sandbox setup)
fakehome=$box/home; mkdir -p $fakehome
run_setup $fakehome --quiet >/dev/null 2>&1 || true
[[ -L $fakehome/.local/bin/super-claude ]] && ok "installe le lien" || ko "installe le lien" "absent"
out=$(run_setup $fakehome --check --uninstall 2>&1)
[[ -L $fakehome/.local/bin/super-claude ]] && ok "--check --uninstall ne supprime rien" \
  || ko "--check --uninstall ne supprime rien" "le lien a disparu"

# --- 13. désinstallation : ne touche pas au lien d'un autre -----------------
ln -sfn /bin/true $fakehome/.local/bin/claude-sessions
out=$(run_setup $fakehome --uninstall 2>&1)
[[ -L $fakehome/.local/bin/claude-sessions ]] && ok "épargne un lien étranger" \
  || ko "épargne un lien étranger" "supprimé"
[[ ! -e $fakehome/.local/bin/super-claude ]] && ok "retire son propre lien" \
  || ko "retire son propre lien" "encore là"

# --- 14. mise à jour : un fichier retiré en amont disparaît -----------------
box=$(new_sandbox stale)
fakehome=$box/home; mkdir -p $fakehome
run_setup $fakehome --quiet >/dev/null 2>&1 || true
print -n 'obsolete' > $fakehome/.claude/kodflow-shell/bin/vieux-outil
print -n 'x' >> $fakehome/.claude/kodflow-shell/.stamp     # force la resynchro
run_setup $fakehome --quiet >/dev/null 2>&1 || true
[[ ! -e $fakehome/.claude/kodflow-shell/bin/vieux-outil ]] && ok "purge un fichier qui n'est plus livré" \
  || ko "purge un fichier qui n'est plus livré" "encore présent"

# --- 15. status line : câblage de settings.json -----------------------------
# Le binaire est déjà là (exécutable factice) : aucun téléchargement, seul le
# câblage de settings.json est exercé.
print -r -- "status line"
run_sl() {
  local fh=$1; shift
  HOME=$fh CLAUDE_CONFIG_DIR=$fh/.claude $ROOT/bin/kodflow-statusline-setup --quiet "$@"
}
box=$(new_sandbox statusline)
fakehome=$box/home; mkdir -p $fakehome/.local/bin $fakehome/.claude
print '#!/bin/sh' > $fakehome/.local/bin/status-line; chmod +x $fakehome/.local/bin/status-line
sl=$fakehome/.claude/settings.json

print '{}' > $sl
run_sl $fakehome >/dev/null 2>&1 || true
is "configure la commande" "$(jq -r .statusLine.command $sl)" "$fakehome/.local/bin/status-line"
is "rafraîchit toutes les secondes" "$(jq -r .statusLine.refreshInterval $sl)" "1"

print '{"statusLine":{"type":"command","command":"status-line"}}' > $sl
run_sl $fakehome >/dev/null 2>&1 || true
is "ajoute le rafraîchissement à une commande par nom" "$(jq -r .statusLine.refreshInterval $sl)" "1"
is "garde la commande par nom" "$(jq -r .statusLine.command $sl)" "status-line"

print '{"statusLine":{"type":"command","command":"status-line","refreshInterval":5}}' > $sl
run_sl $fakehome >/dev/null 2>&1 || true
is "garde un intervalle choisi" "$(jq -r .statusLine.refreshInterval $sl)" "5"

print '{"statusLine":{"type":"command","command":"/opt/autre"}}' > $sl
run_sl $fakehome >/dev/null 2>&1 || true
is "ne touche pas une status line étrangère" "$(jq -c .statusLine $sl)" '{"type":"command","command":"/opt/autre"}'

# --- bilan ------------------------------------------------------------------
print -r -- ""
print -r -- "$PASS réussis, $FAIL échoués"
(( FAIL == 0 ))
