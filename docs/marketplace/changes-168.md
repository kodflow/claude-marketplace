# Agents whose instructions changed in #168

Against main at `847a1a4b`, #168 rewraps the frontmatter of most agents (the
parsed values are unchanged) and changes the body, the instructions the model
reads, of these 15. Listed by a diff of `plugins/*/agents/*.md` outside the
frontmatter. The marketplace canary holds the same list in
`scripts/tests/fixtures/canary/deviations.json`, with two skills whose body
also changed (`review`, `search`: links to the generated workflows).

| Plugin | Agent | What changed |
|---|---|---|
| kodflow-gamedev | asset-specialist-meshy | example request and judgement rewritten |
| kodflow-gamedev | martial-specialist-unarmed | rig motion described from the clip, not from an assumed kinetic chain |
| kodflow-gamedev | rig-specialist-ik | the socketed-prop constraint split per axis |
| kodflow-specialists | developer-commentator-worker | an empty result reports the real audit counts |
| kodflow-specialists | developer-executor-correctness | output follows the brief's schema; the search workflow's claims and gaps |
| kodflow-specialists | developer-executor-shell | quoted `trap` example; output without a report file |
| kodflow-specialists | developer-specialist-cpp | C++ examples corrected (`const T&`, `std::ranges::to`) |
| kodflow-specialists | developer-specialist-nodejs | vitest coverage flags and flat-config file globs corrected |
| kodflow-specialists | developer-specialist-react | Server Components default applied only where the framework supports them |
| kodflow-specialists | developer-specialist-zig | `defer` / `errdefer` guidance corrected |
| kodflow-specialists | devops-executor-linux | inspection-only fallback commands listed |
| kodflow-specialists | devops-specialist-docker | `npm ci` / `npm prune` example corrected |
| kodflow-specialists | devops-specialist-infrastructure | `terraform-docs --output-check` invocation corrected |
| kodflow-specialists | devops-specialist-security | secret scanners and `grype` example corrected |
| kodflow-specialists | os-specialist-debian | examples moved to Debian 13 (trixie) |

Reproduce the list:

```sh
body() { awk 'BEGIN { n = 0 } /^---$/ && n < 2 { n++; next } n >= 2'; }
for f in $(git diff --name-only 847a1a4b HEAD -- 'plugins/*/agents/*.md'); do
  cmp -s <(git show "847a1a4b:$f" | body) <(git show "HEAD:$f" | body) || echo "$f"
done
```
