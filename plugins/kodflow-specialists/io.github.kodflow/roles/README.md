# Specialist roles

Each role directory contains one portable declaration, instructions and local
JSON Schema contracts. The role's model class is abstract. The Claude overlay
keeps its tool list and native model settings. Edit the declaration and its
instructions here, then run `pluginctl roles` from the repository root to
refresh the generated Claude and Codex agent files.

The Codex outputs are standalone custom agents. Place them in the Codex agent
directory using the installer. Installing a marketplace plugin alone does
not register these agents. Perplexity outputs are advisory skills. They inherit
the current session and cannot enforce an independent identity, sandbox or
tool list.

The migration fixtures record the original Claude metadata and instructions
along with the byte-exact Codex outputs. For an intentional role change,
review and update the affected fixture entries with the generated files.
