# kodflow-hooks zsh-safe: read by every zsh Claude Code starts, ZDOTDIR
# pointing here (hooks/mod/zsh.ts). The user's ZDOTDIR comes back first, so
# their .zshenv, and the .zprofile, .zshrc and .zlogin read after this file,
# are the ones they would get anyway. Then an unmatched glob stays literal
# (`echo *.none` prints `*.none`) and a leading `=` is just a character.
if [[ -n ${KODFLOW_USER_ZDOTDIR-} ]]; then
  ZDOTDIR=$KODFLOW_USER_ZDOTDIR
else
  unset ZDOTDIR
fi
[[ -r ${ZDOTDIR:-$HOME}/.zshenv ]] && source "${ZDOTDIR:-$HOME}/.zshenv"
setopt nonomatch noequals
