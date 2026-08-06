# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Sprawdź filtr gałęzi w CI względem gałęzi domyślnej repo

- **Context**: każda zmiana dotykająca `.github/workflows/*.yml` oraz bootstrap projektu ze startera.
- **Problem**: `ci.yml` po scaffoldzie celuje w `master`, a repo powstało na `main` — lint i build nie odpalają się od pierwszego commita i nikt tego nie zauważa, bo brak checków wygląda jak "jeszcze nie doszło".
- **Rule**: Przy każdej zmianie workflowa porównaj `on.push.branches` / `on.pull_request.branches` z faktyczną gałęzią domyślną repo. Nigdy nie zostawiaj wartości odziedziczonej ze startera bez weryfikacji.
- **Applies to**: implement, impl-review
