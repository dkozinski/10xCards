# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Sprawdź filtr gałęzi w CI względem gałęzi domyślnej repo

- **Context**: każda zmiana dotykająca `.github/workflows/*.yml` oraz bootstrap projektu ze startera.
- **Problem**: `ci.yml` po scaffoldzie celuje w `master`, a repo powstało na `main` — lint i build nie odpalają się od pierwszego commita i nikt tego nie zauważa, bo brak checków wygląda jak "jeszcze nie doszło".
- **Rule**: Przy każdej zmianie workflowa porównaj `on.push.branches` / `on.pull_request.branches` z faktyczną gałęzią domyślną repo. Nigdy nie zostawiaj wartości odziedziczonej ze startera bez weryfikacji.
- **Applies to**: implement, impl-review

## Merge slice PR = zamknięte issues, ale nie zsynchronizowane trackery

- **Context**: każdy PR slice'a z `Closes #N` i każde pytanie Q-n rozstrzygane w slice'ie.
- **Problem**: `Closes` zamyka issue i nic więcej. Pytanie zamknięte przez `Closes` zostaje z Decision „Not yet decided”, zależne slice'y zostają z `status:proposed`, a Linear nie wie o niczym. Zdarzyło się po S-01, S-02 i S-05.
- **Rule**: Zanim PR slice'a trafi do merge'a, wpisz Decision w każdym pytaniu, które PR zamyka. Zaraz po merge'u przejdź sekcję „Lifecycle” z `tasks-github.md` w obu trackerach: odhacz „Done when”, zdejmij `status:*`, odblokuj zależne slice'y i zaktualizuj Q-n w roadmapie i PRD.
- **Applies to**: plan, implement, impl-review
