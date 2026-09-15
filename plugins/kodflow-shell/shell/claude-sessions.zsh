# claude-sessions.zsh — completion, autosuggestion and housekeeping for
# `super-claude` / `claude`.
#
# Shipped by the kodflow-shell plugin. Do not edit the copy under
# ~/.claude/kodflow-shell: the SessionStart hook overwrites it from the plugin
# at every launch. Edit it in the marketplace and update the plugin.
#
# Sourced twice over: by the interactive zsh (completion + autosuggestion) and
# by bin/claude-sessions, which only needs the functions. Everything below is
# definitions and cheap assignments — no side effect at source time.
#
# Sessions live in $CLAUDE_CONFIG_DIR/projects/<slug>/<uuid>.jsonl, one folder
# per working directory (slug = the absolute path, every non-alphanumeric
# character replaced by "-"). Claude Code itself appends `{"type":"ai-title"}`
# records to the transcript once a conversation has a subject, so the titles
# shown here are the ones /resume displays — nothing is invented locally.
#
#   claude-sessions [-a] [<dir>]        the list, coloured by age
#   claude-sessions clean <niveau>      delete old sessions, one Y/n each
#   super-claude sessions|clean …       the same, from the command you type
#   TAB after `super-claude `           sessions of this directory, then of
#                                       every other one, matched on the id *and*
#                                       on the words of the title
#   autosuggestion                      `--resume <uuid>` rebuilt from sessions
#                                       that still exist, not dead ids from history
#
# Titles are cached in ~/.cache/claude-sessions/<slug>/<uuid> and re-extracted
# only when the transcript's mtime moves: completion must stay instant even
# though transcripts reach 10 MB.

zmodload -F zsh/stat b:zstat 2>/dev/null
zmodload zsh/datetime 2>/dev/null

CLAUDE_SESSIONS_CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/claude-sessions
CLAUDE_SESSIONS_MAX=${CLAUDE_SESSIONS_MAX:-40}         # sessions of the current dir
CLAUDE_SESSIONS_ALL_MAX=${CLAUDE_SESSIONS_ALL_MAX:-40} # sessions of other dirs
CLAUDE_SESSIONS_ALL=${CLAUDE_SESSIONS_ALL:-1}          # 0 disables the second group
CLAUDE_SESSIONS_FRESH_H=${CLAUDE_SESSIONS_FRESH_H:-72} # green below this many hours
CLAUDE_SESSIONS_WARN_D=${CLAUDE_SESSIONS_WARN_D:-7}    # yellow below this many days

typeset -ga _cs_ids _cs_titles _cs_ages _cs_dirs _cs_mtimes _cs_pdirs
typeset -gA _cs_pruned
typeset -g _cs_key= _cs_stamp=0

_claude_sessions_root() { print -r -- "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" }
_claude_sessions_dir()  { print -r -- "$(_claude_sessions_root)/${${1:-$PWD}//[^a-zA-Z0-9]/-}" }

#--------------------------------------------------------------------#
# Age, colour, size                                                   #
#--------------------------------------------------------------------#

# 0 = green (fresh), 1 = yellow (ageing), 2 = red (old).
_claude_sessions_level() {
  local -i d=$(( EPOCHSECONDS - $1 ))
  if   (( d < CLAUDE_SESSIONS_FRESH_H * 3600 ));  then print -r -- 0
  elif (( d < CLAUDE_SESSIONS_WARN_D  * 86400 )); then print -r -- 1
  else                                                 print -r -- 2
  fi
}

_claude_sessions_color() {
  [[ -n $NO_COLOR ]] && return
  case $1 in
    0) print -rn -- $'\e[32m' ;;   # vert   < 72 h
    1) print -rn -- $'\e[33m' ;;   # jaune  < 7 j
    2) print -rn -- $'\e[31m' ;;   # rouge  au-delà
  esac
}
_claude_sessions_reset() { [[ -n $NO_COLOR ]] || print -rn -- $'\e[0m' }

# Age of a timestamp, at most 4 characters.
_claude_sessions_age() {
  local -i d=$(( EPOCHSECONDS - $1 ))
  if (( d < 3600 )); then
    print -r -- "$(( d / 60 ))m"
  elif (( d < 86400 )); then
    print -r -- "$(( d / 3600 ))h"
  else
    print -r -- "$(( d / 86400 ))d"
  fi
}

_claude_sessions_human() {
  local -i b=$1
  if   (( b > 1073741824 )); then printf '%.1fG' $(( b / 1073741824.0 ))
  elif (( b > 1048576 ));    then printf '%dM'   $(( b / 1048576 ))
  elif (( b > 1024 ));       then printf '%dk'   $(( b / 1024 ))
  else                            printf '%dB'   $b
  fi
}

# Disk used by one session: the transcript plus its subagent transcripts.
_claude_sessions_size() {
  local pdir=$1 id=$2
  local -a st
  local -i b=0
  zstat -A st +size -- "$pdir/$id.jsonl" 2>/dev/null && b=$st[1]
  if [[ -d $pdir/$id ]]; then
    b+=$(du -sb -- "$pdir/$id" 2>/dev/null | cut -f1)
  fi
  print -r -- $b
}

#--------------------------------------------------------------------#
# Reading a transcript                                                #
#--------------------------------------------------------------------#

# Title + originating directory of one transcript, as "cwd<TAB>title".
# Title := the AI title Claude Code wrote, else the first real user prompt,
# else the last prompt. An empty title means "no conversation in there".
_claude_session_meta() {
  local f=$1 size title= cwd=
  local -a st
  zstat -A st +size -- "$f" 2>/dev/null || return 1
  size=$st[1]

  cwd=$(head -c 65536 -- "$f" | jq -Rr 'fromjson? | .cwd // empty' 2>/dev/null | head -1)

  if (( size > 262144 )); then
    title=$(tail -c 262144 -- "$f" | tail -n +2 |
      jq -Rr 'fromjson? | select(.type=="ai-title") | .aiTitle // empty' 2>/dev/null | tail -1)
  else
    title=$(jq -Rr 'fromjson? | select(.type=="ai-title") | .aiTitle // empty' -- "$f" 2>/dev/null | tail -1)
  fi

  # No AI title: take the first real user prompt. Slash commands (/model …) are
  # kept only as a last resort, and everything Claude Code injects into the
  # transcript (caveats, task-resources, interruptions) is skipped.
  if [[ -z $title ]]; then
    local -a cands
    cands=(${(f)"$(head -c 1048576 -- "$f" | jq -Rr '
        fromjson?
        | select(.type=="user")
        | .message.content
        | (if type=="string" then . else ([.[]? | select(.type=="text") | .text] | join(" ")) end)
        | select(type=="string")
        | gsub("\\s+";" ") | gsub("^ +| +$";"")
        | select(length > 0)
        | if test("^<command-name>") then
            "1\t" + (((capture("<command-name>(?<n>[^<]*)") // {n:""}).n | gsub("^ +| +$";"")) + " " +
                     ((capture("<command-args>(?<a>[^<]*)") // {a:""}).a | gsub("^ +| +$";"")) | gsub(" +$";""))
          elif test("^(<|\\[Request interrupted|\\[Image|Caveat:|A session-scoped Stop hook|A <task-resources>|This session is being continued)") then empty
          else "0\t" + . end' 2>/dev/null)"})
    local c
    for c in $cands; do
      [[ $c == 0$'\t'* ]] && { title=${c#*$'\t'}; break }
    done
    if [[ -z $title ]]; then
      for c in $cands; do
        [[ $c == 1$'\t'* ]] && { title=${c#*$'\t'}; break }
      done
    fi
  fi

  if [[ -z $title ]]; then
    title=$(tail -c 262144 -- "$f" | tail -n +2 |
      jq -Rr 'fromjson? | select(.type=="last-prompt") | .lastPrompt // empty' 2>/dev/null | tail -1)
  fi

  title=${title//[$'\n\r\t']/ }
  while [[ $title == *"  "* ]]; do title=${title//  / }; done
  title=${title## }; title=${title%% }
  (( ${#title} > 76 )) && title="${title[1,75]}…"
  print -r -- "$cwd	$title"
}

# Drop cached titles whose transcript is gone, once per project dir per shell.
_claude_sessions_prune() {
  local pdir=$1 cdir=$2 c
  [[ -n ${_cs_pruned[$pdir]} ]] && return
  _cs_pruned[$pdir]=1
  for c in $cdir/*(.N); do
    [[ -f $pdir/${c:t}.jsonl ]] || rm -f -- "$c"
  done
}

# Append the sessions of one project dir to the _cs_* arrays, newest first.
# $1 = project dir, $2 = max entries.
_claude_sessions_scan() {
  local pdir=$1 max=$2
  local cdir=$CLAUDE_SESSIONS_CACHE/${pdir:t}
  local f id mtime cached meta title cwd
  local -a st files
  files=("$pdir"/*.jsonl(.Nom))
  (( ${#files} )) || return 1
  _claude_sessions_prune "$pdir" "$cdir"

  for f in ${files[1,max]}; do
    id=${${f:t}%.jsonl}
    zstat -A st +mtime -- "$f" 2>/dev/null || continue
    mtime=$st[1]
    cached=
    [[ -r $cdir/$id ]] && cached=$(<$cdir/$id)
    if [[ $cached == "$mtime	"* ]]; then
      meta=${cached#*	}
    else
      meta=$(_claude_session_meta "$f") || continue
      [[ -d $cdir ]] || mkdir -p $cdir
      print -r -- "$mtime	$meta" > $cdir/$id
    fi
    cwd=${meta%%	*}
    title=${meta#*	}
    [[ -n $title ]] || continue           # empty transcript: not resumable
    _cs_ids+=("$id")
    _cs_titles+=("$title")
    _cs_ages+=("$(_claude_sessions_age $mtime)")
    _cs_dirs+=("${cwd:-${pdir:t}}")
    _cs_mtimes+=("$mtime")
    _cs_pdirs+=("$pdir")
  done
  return 0
}

_claude_sessions_reset_arrays() {
  _cs_ids=() _cs_titles=() _cs_ages=() _cs_dirs=() _cs_mtimes=() _cs_pdirs=()
}

# Sessions of $PWD only. Memoized for 3 s: this runs on every keystroke.
_claude_sessions_load() {
  local pdir=$(_claude_sessions_dir "$PWD")
  if [[ $pdir == $_cs_key ]] && (( EPOCHSECONDS - _cs_stamp < 3 )); then
    (( ${#_cs_ids} ))
    return
  fi
  _cs_key=$pdir _cs_stamp=$EPOCHSECONDS
  _claude_sessions_reset_arrays
  [[ -d $pdir ]] || return 1
  _claude_sessions_scan "$pdir" $CLAUDE_SESSIONS_MAX
  (( ${#_cs_ids} ))
}

# Sessions of every other project dir, newest first, capped.
# Fills the _cs_* arrays from scratch; not memoized (TAB only).
_claude_sessions_load_foreign() {
  local here=$(_claude_sessions_dir "$PWD")
  _claude_sessions_reset_arrays
  local -a files
  files=($(_claude_sessions_root)/*/*.jsonl(.Nom))
  (( ${#files} )) || return 1

  local f pdir
  local -a picked
  for f in $files; do
    [[ ${f:h} == $here ]] && continue
    picked+=("$f")
    (( ${#picked} >= CLAUDE_SESSIONS_ALL_MAX )) && break
  done
  (( ${#picked} )) || return 1

  local -A dirs
  for f in $picked; do dirs[${f:h}]=1; done
  # Scan each owning dir once (cheap, cached), then keep the picked ids in the
  # order the glob gave them: globally newest first.
  local -a apaths aids atitles aages adirs amtimes apdirs
  for pdir in ${(k)dirs}; do
    _claude_sessions_reset_arrays
    _claude_sessions_scan "$pdir" $CLAUDE_SESSIONS_ALL_MAX
    aids+=($_cs_ids); atitles+=($_cs_titles); aages+=($_cs_ages)
    adirs+=($_cs_dirs); amtimes+=($_cs_mtimes); apdirs+=($_cs_pdirs)
    local k
    for k in $_cs_ids; do apaths+=("$pdir/$k.jsonl"); done
  done
  _claude_sessions_reset_arrays
  local id i
  for f in $picked; do
    id=${${f:t}%.jsonl}
    # by full path, not by id: the same id can exist under two project dirs
    i=${apaths[(Ie)$f]}
    (( i )) || continue
    _cs_ids+=("$id"); _cs_titles+=("$atitles[i]"); _cs_ages+=("$aages[i]")
    _cs_dirs+=("$adirs[i]"); _cs_mtimes+=("$amtimes[i]"); _cs_pdirs+=("$apdirs[i]")
  done
  (( ${#_cs_ids} ))
}

# Pretty path for the directory column.
_claude_sessions_short() {
  local d=${1/#$HOME/\~}
  if (( ${#d} > 28 )); then
    d="${${d:h}:t}/${d:t}"                  # last two components
    (( ${#d} > 28 )) && d="${d[1,27]}…"
  fi
  print -r -- "$d"
}

#--------------------------------------------------------------------#
# Deleting a session                                                  #
#--------------------------------------------------------------------#
# A session is not only its transcript: subagent transcripts, the environment
# snapshot, the file history and the task/team state are keyed by its id too.
# Exports under ~/.claude/exports are left alone — those were asked for.

_claude_sessions_rm() {
  local pdir=$1 id=$2
  [[ -n $pdir && -n $id ]] || return 1
  local root=${CLAUDE_CONFIG_DIR:-$HOME/.claude} short=${id[1,8]}
  local -i rc=0
  # Every removal counts: reporting "supprimée" for a session whose transcript
  # survived a permission error would be a lie the caller repeats in its total.
  rm -f  -- "$pdir/$id.jsonl"                                          || rc=1
  rm -rf -- "$pdir/$id"                                                || rc=1
  rm -rf -- "$root/session-env/$id" "$root/file-history/$id"           || rc=1
  rm -rf -- "$root/tasks/session-$short" "$root/teams/session-$short"  || rc=1
  rm -f  -- "$CLAUDE_SESSIONS_CACHE/${pdir:t}/$id"                     || rc=1
  return $rc
}

# clean <green|warn|red> [-a] [-n]
# red   : sessions older than CLAUDE_SESSIONS_WARN_D days   (the red ones)
# warn  : sessions older than CLAUDE_SESSIONS_FRESH_H hours (yellow + red)
# green : every session (green + yellow + red)
_claude_sessions_clean() {
  local level=$1 all=$2 dry=$3
  local -i max_level
  case $level in
    red|rouge)                     max_level=2 ;;
    warn|warning|orange|yellow|jaune) max_level=1 ;;
    green|vert|all|tout|tous)      max_level=0 ;;
    *)
      print -u2 "claude-sessions clean: niveau inconnu « $level »"
      print -u2 "  red    → les rouges (> ${CLAUDE_SESSIONS_WARN_D} j)"
      print -u2 "  warn   → les jaunes et les rouges (> ${CLAUDE_SESSIONS_FRESH_H} h)"
      print -u2 "  green  → toutes"
      return 2 ;;
  esac

  # The pickers cap what they offer; the cleaner must see everything, or
  # `clean green -a` would silently spare exactly the oldest sessions — the
  # ones it exists to remove. zsh scopes these dynamically, so the loaders
  # called below see the raised values.
  local -i CLAUDE_SESSIONS_MAX=1000000 CLAUDE_SESSIONS_ALL_MAX=1000000
  _cs_key= _cs_stamp=0
  local -a ids titles ages dirs mtimes pdirs
  if (( all )); then
    _claude_sessions_load_foreign
    ids=($_cs_ids) titles=($_cs_titles) ages=($_cs_ages)
    dirs=($_cs_dirs) mtimes=($_cs_mtimes) pdirs=($_cs_pdirs)
  fi
  _cs_key= _cs_stamp=0
  _claude_sessions_load
  ids+=($_cs_ids) titles+=($_cs_titles) ages+=($_cs_ages)
  dirs+=($_cs_dirs) mtimes+=($_cs_mtimes) pdirs+=($_cs_pdirs)

  local -a sel_ids sel_titles sel_ages sel_dirs sel_pdirs sel_lv
  local -i i lv total=0 sz
  local -a sel_sizes
  for (( i = 1; i <= ${#ids}; i++ )); do
    lv=$(_claude_sessions_level $mtimes[i])
    (( lv >= max_level )) || continue
    sz=$(_claude_sessions_size "$pdirs[i]" "$ids[i]")
    sel_ids+=("$ids[i]"); sel_titles+=("$titles[i]"); sel_ages+=("$ages[i]")
    sel_dirs+=("$dirs[i]"); sel_pdirs+=("$pdirs[i]"); sel_lv+=($lv); sel_sizes+=($sz)
    (( total += sz ))
  done

  if (( ! ${#sel_ids} )); then
    print -r -- "Rien à nettoyer (niveau « $level »$( (( all )) && print -n ', tous dossiers'))."
    return 0
  fi

  local scope
  if (( all )); then scope="tous dossiers"; else scope="$PWD"; fi
  print -r -- "$(_claude_sessions_color 2)${#sel_ids} session(s)$(_claude_sessions_reset) à supprimer — $scope — $(_claude_sessions_human $total) à libérer"
  (( dry )) && print -r -- "(simulation : rien ne sera supprimé)"
  print -r -- ""

  local reply bulk yes_all=0
  local -i removed=0 freed=0 failed=0
  for (( i = 1; i <= ${#sel_ids}; i++ )); do
    printf '  %s%s  %4s  %6s  %s%s\n' \
      "$(_claude_sessions_color $sel_lv[i])" "${sel_ids[i][1,8]}" "$sel_ages[i]" \
      "$(_claude_sessions_human $sel_sizes[i])" "$sel_titles[i]" "$(_claude_sessions_reset)"
    if (( dry )); then continue; fi
    if (( ! yes_all )); then
      if [[ ! -t 0 ]]; then
        print -u2 "  (pas de terminal : abandon)"
        return 1
      fi
      # An empty answer means "yes" — so a read that FAILS must never look
      # like one. At EOF (a pipe, a pty with nothing to type into it) read
      # returns non-zero and leaves reply empty: without this test the whole
      # selection would be deleted without a single keystroke.
      if ! read -r "reply?  supprimer ? [Y/n/a=toutes/q=stop] "; then
        print -u2 ""
        print -u2 "  entrée fermée : abandon, rien de plus n'est supprimé."
        break
      fi
      case ${reply:l} in
        ""|y|yes|o|oui) ;;
        a|all|toutes)
          # One keystroke that deletes everything left deserves its own
          # question, and this one defaults to no.
          local -i left=$(( ${#sel_ids} - i + 1 ))
          if ! read -r "bulk?  supprimer les $left restantes d'un coup, sans redemander ? [y/N] "; then
            print -u2 ""
            print -u2 "  entrée fermée : abandon."
            break
          fi
          case ${bulk:l} in
            y|yes|o|oui) yes_all=1 ;;
            *)           print -r -- "  gardée."; continue ;;
          esac ;;
        q|quit)         print -r -- "  arrêt."; break ;;
        *)              print -r -- "  gardée."; continue ;;
      esac
    fi
    if _claude_sessions_rm "$sel_pdirs[i]" "$sel_ids[i]"; then
      (( removed++ )); (( freed += sel_sizes[i] ))
    else
      (( failed++ ))
      print -u2 "  ${sel_ids[i][1,8]} : suppression incomplète (droits ? fichier occupé ?)"
    fi
  done

  print -r -- ""
  if (( dry )); then
    print -r -- "Simulation : ${#sel_ids} session(s), $(_claude_sessions_human $total) libérables."
  else
    print -r -- "$removed session(s) supprimée(s), $(_claude_sessions_human $freed) libéré(s)."
    (( failed )) && print -u2 "$failed session(s) partiellement supprimée(s) — relancer après avoir corrigé la cause."
  fi
  _cs_key= _cs_stamp=0
  return 0
}

#--------------------------------------------------------------------#
# claude-sessions: the list, for humans                               #
#--------------------------------------------------------------------#

_claude_sessions_legend() {
  printf '%s●%s <%dh   %s●%s <%dj   %s●%s plus ancien\n' \
    "$(_claude_sessions_color 0)" "$(_claude_sessions_reset)" $CLAUDE_SESSIONS_FRESH_H \
    "$(_claude_sessions_color 1)" "$(_claude_sessions_reset)" $CLAUDE_SESSIONS_WARN_D \
    "$(_claude_sessions_color 2)" "$(_claude_sessions_reset)"
}

claude-sessions() {
  emulate -L zsh
  local all=0 dry=0 dir=$PWD cmd=list level= i
  while (( $# )); do
    case $1 in
      -a|--all)       all=1 ;;
      -n|--dry-run)   dry=1 ;;
      --no-color)     local NO_COLOR=1 ;;
      clean|nettoie)  cmd=clean ;;
      -h|--help)      cmd=help ;;
      -*)             print -u2 "claude-sessions: option inconnue $1"; return 2 ;;
      *)  if [[ $cmd == clean && -z $level ]]; then level=$1; else dir=${~1}; fi ;;
    esac
    shift
  done
  [[ -t 1 && -z $NO_COLOR ]] || local NO_COLOR=1

  if [[ $cmd == help ]]; then
    print -r -- "usage : claude-sessions [-a] [<dossier>]        lister"
    print -r -- "        claude-sessions clean <niveau> [-a] [-n]  nettoyer"
    print -r -- ""
    print -r -- "  -a, --all      toutes les sessions, tous dossiers confondus"
    print -r -- "  -n, --dry-run  clean en simulation"
    print -r -- ""
    print -r -- "  niveaux de clean (du plus large au plus étroit) :"
    print -r -- "    green  toutes les sessions"
    print -r -- "    warn   les jaunes et les rouges (> ${CLAUDE_SESSIONS_FRESH_H} h)"
    print -r -- "    red    les rouges seulement (> ${CLAUDE_SESSIONS_WARN_D} j)"
    print -r -- "  chaque suppression demande confirmation, Entrée = oui."
    print -r -- ""
    _claude_sessions_legend
    print -r -- ""
    print -r -- "  aussi disponible en : super-claude sessions / super-claude clean <niveau>"
    return 0
  fi

  if [[ $cmd == clean ]]; then
    [[ -n $level ]] || { print -u2 "claude-sessions clean : niveau requis (green|warn|red)"; return 2 }
    _claude_sessions_clean "$level" $all $dry
    return $?
  fi

  local -a rows
  if (( all )); then
    _claude_sessions_load_foreign
    for (( i = 1; i <= ${#_cs_ids}; i++ )); do
      rows+=("$_cs_mtimes[i]	$_cs_ids[i]	$_cs_ages[i]	$_cs_dirs[i]	$_cs_titles[i]")
    done
    _cs_key= _cs_stamp=0
    _claude_sessions_load
    for (( i = 1; i <= ${#_cs_ids}; i++ )); do
      rows+=("$_cs_mtimes[i]	$_cs_ids[i]	$_cs_ages[i]	$_cs_dirs[i]	$_cs_titles[i]")
    done
    local row; local -a f
    for row in "${(@On)rows}"; do              # newest first, all dirs mixed
      f=("${(@s:	:)row}")
      printf '%s%s  %4s  %-28s  %s%s\n' "$(_claude_sessions_color $(_claude_sessions_level $f[1]))" \
        "$f[2]" "$f[3]" "$(_claude_sessions_short $f[4])" "$f[5]" "$(_claude_sessions_reset)"
    done
    [[ -n $NO_COLOR ]] || { print -r -- ""; _claude_sessions_legend }
    return 0
  fi

  local pdir=$(_claude_sessions_dir "$dir")
  if [[ ! -d $pdir ]]; then
    print -u2 "claude-sessions: aucune session pour $dir"
    return 1
  fi
  _claude_sessions_reset_arrays
  _claude_sessions_scan "$pdir" $CLAUDE_SESSIONS_MAX
  _cs_key= _cs_stamp=0
  for (( i = 1; i <= ${#_cs_ids}; i++ )); do
    printf '%s%s  %4s  %s%s\n' "$(_claude_sessions_color $(_claude_sessions_level $_cs_mtimes[i]))" \
      "$_cs_ids[i]" "$_cs_ages[i]" "$_cs_titles[i]" "$(_claude_sessions_reset)"
  done
  [[ -n $NO_COLOR ]] || { print -r -- ""; _claude_sessions_legend }
}

#--------------------------------------------------------------------#
# Completion                                                          #
#--------------------------------------------------------------------#
# Matching is done here, not by the completion system: a session matches when
# every word typed is a substring of "<id> <title> <dir>", so
# `super-claude wifi<TAB>` finds "Hotspot wifi 5 GHz" as well as an id prefix.

_claude_sessions_add() {
  local group=$1 withdir=$2
  local -a display values tokens
  local i pat hay ok tok dircol col rst
  pat="${IPREFIX}${PREFIX}${SUFFIX}"
  pat=${pat:l}
  tokens=(${(z)pat})
  rst=$(_claude_sessions_reset)

  for (( i = 1; i <= ${#_cs_ids}; i++ )); do
    hay="${_cs_ids[i]} ${_cs_titles[i]} ${_cs_dirs[i]}"
    hay=${hay:l}
    ok=1
    for tok in $tokens; do
      [[ $hay == *"$tok"* ]] || { ok=0; break }
    done
    (( ok )) || continue
    # Colour the id+age prefix only, and close it before the title: zsh counts
    # escape sequences as printable width when it lays the list out, so a reset
    # left at the end of the line gets split when the line is truncated.
    col=$(_claude_sessions_color $(_claude_sessions_level $_cs_mtimes[i]))
    values+=("$_cs_ids[i]")
    if (( withdir )); then
      dircol=$(_claude_sessions_short "$_cs_dirs[i]")
      display+=("${col}${_cs_ids[i][1,8]}  ${(r:4:)_cs_ages[i]}${rst}  ${(r:28:)dircol}  $_cs_titles[i]")
    else
      display+=("${col}${_cs_ids[i][1,8]}  ${(r:4:)_cs_ages[i]}${rst}  $_cs_titles[i]")
    fi
  done
  (( ${#values} )) || return 1
  compadd -U -Q -V "$group" -X "%B$group%b" -l -d display -a values
}

_claude_sessions_add_verbs() {
  local -a display values
  local pat="${IPREFIX}${PREFIX}${SUFFIX}"
  pat=${pat:l}
  local -a verbs=(clean sessions)
  local -a descs=("nettoyer les vieilles sessions (green|warn|red)" "lister les sessions")
  local i
  for (( i = 1; i <= ${#verbs}; i++ )); do
    [[ -z $pat || ${verbs[i]} == ${pat}* ]] || continue
    values+=("$verbs[i]")
    display+=("${(r:10:)verbs[i]}  $descs[i]")
  done
  (( ${#values} )) || return 1
  compadd -U -Q -V verbes -X "%Bcommandes%b" -l -d display -a values
}

_super-claude() {
  local prev=${words[CURRENT-1]} n=0

  # `super-claude clean <TAB>` → the three levels.
  if [[ ${words[2]} == (clean|nettoie) ]] && (( CURRENT == 3 )); then
    local -a lv=(green warn red)
    local -a ld=(
      "green   toutes les sessions"
      "warn    les jaunes et les rouges (> ${CLAUDE_SESSIONS_FRESH_H} h)"
      "red     les rouges seulement (> ${CLAUDE_SESSIONS_WARN_D} j)")
    compadd -Q -V niveaux -X "%Bniveau%b" -l -d ld -a lv
    return 0
  fi

  if [[ $prev == (-r|--resume) ]] || (( CURRENT == 2 )); then
    # Sessions are a chooser, not a prefix to extend: without this the first
    # TAB would replace the typed filter with the empty common prefix of the
    # ids and the second TAB would then list everything.
    compstate[insert]=menu
    compstate[list]='list force'
    _cs_stamp=0
    _claude_sessions_load && { _claude_sessions_add "sessions ici" 0 && n=1 }
    if (( CLAUDE_SESSIONS_ALL )); then
      _claude_sessions_load_foreign && { _claude_sessions_add "autres dossiers" 1 && n=1 }
    fi
    (( CURRENT == 2 )) && { _claude_sessions_add_verbs && n=1 }
    _cs_key= _cs_stamp=0          # arrays now hold foreign data: force a reload
    (( n )) && return 0
  fi
  _default
}

if (( $+functions[compdef] )); then
  compdef _super-claude super-claude
  compdef _super-claude claude
fi

#--------------------------------------------------------------------#
# Autosuggestion                                                      #
#--------------------------------------------------------------------#
# History replays `--resume <uuid>` lines whose session was deleted long ago.
# Those are filtered out of the history strategy; this one puts back a
# suggestion built from the sessions of this directory that still exist.

_zsh_autosuggest_strategy_claude_sessions() {
  setopt localoptions extended_glob
  typeset -g suggestion=
  local buf=$1 cmd rest arg flag=--resume
  [[ $buf == (claude|super-claude)(|[[:space:]]*) ]] || return
  cmd=${buf%%[[:space:]]*}
  rest=${buf#$cmd}
  rest=${rest##[[:space:]]#}

  case $rest in
    "")               arg= ;;
    -r|--resume)      return ;;                    # wait for the space
    (-r|--resume)\ *) flag=${rest%%[[:space:]]*}; arg=${rest#*[[:space:]]} ;;
    [0-9a-f]*)        flag=; arg=$rest ;;          # bare id (super-claude <id>)
    *)                return ;;
  esac
  [[ $arg == [0-9a-f-]# ]] || return

  _claude_sessions_load || return
  local id
  for id in $_cs_ids; do
    if [[ -z $arg || $id == $arg* ]]; then
      [[ -z $flag ]] && suggestion="$cmd $id" || suggestion="$cmd $flag $id"
      return
    fi
  done
}

ZSH_AUTOSUGGEST_STRATEGY=(claude_sessions history)
ZSH_AUTOSUGGEST_HISTORY_IGNORE="(*claude*--resume*|*claude -r *)"
