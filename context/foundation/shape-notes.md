---
project: "10xCards"
context_type: greenfield
created: 2026-07-23
updated: 2026-07-23
status: shape-complete
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona scope"
      decision: "profesjonalista uczący się do certyfikacji branżowej (IT / medycyna / prawo / finanse)"
    - topic: "pain moment"
      decision: "tuż po przeczytaniu materiału — świeżo przerobiony tekst, brak czasu na ręczne rozbicie"
    - topic: "pain category"
      decision: "tarcie w workflow (mechaniczna, powtarzalna praca)"
    - topic: "insight / why not built yet"
      decision: "istniejące narzędzia (Anki) są mocne, ale krok tworzenia fiszek jest w pełni ręczny"
    - topic: "auth strategy"
      decision: "konta e-mail + hasło; bez OAuth, bez magic linków"
    - topic: "role model"
      decision: "płaski — jeden typ użytkownika, pełna izolacja danych, brak roli admina w MVP"
    - topic: "MVP first flow"
      decision: "logowanie → wklejenie tekstu → generowanie AI → recenzja (wszystkie propozycje domyślnie zaakceptowane, edycja/odrzucenie dowolnej) → zapis do talii → sesja powtórek"
    - topic: "timeline"
      decision: "3 tygodnie pracy po godzinach, cały przepływ włącznie z sesją powtórek; bez twardego deadline'u"
    - topic: "primary success metric"
      decision: "obie liczby z idea-notes są Primary — 75% fiszek AI zaakceptowanych bez modyfikacji ORAZ 75% talii tworzone przez AI (jakość generowania i realne poleganie na nim to dwie różne rzeczy)"
    - topic: "guardrails"
      decision: "(1) żadna fiszka AI nie jest zapisana, dopóki użytkownik nie ukończy recenzji i nie zapisze jej jawnie — bez cichego auto-zapisu w tle; (2) niezawodność sesji powtórek — bez gubienia postępów i bez pokazywania złej fiszki"
  frs_drafted: 12
  quality_check_status: accepted
---

# Shape notes — 10xCards

Źródło ziarna: `idea-notes.md` (wczytane w całości na starcie sesji).

## Vision & Problem Statement

Manualne tworzenie wysokiej jakości fiszek edukacyjnych jest procesem żmudnym i czasochłonnym, przez co zabija motywację, zanim powtórki spaced repetition w ogóle się zaczną. Profesjonaliści, którzy przyswajają materiały edukacyjne i przygotowują się do trudnych egzaminów lub certyfikacji branżowych (IT, medycyna, prawo, finanse), mają świadomość, że świeżo przyswojony tekst (np. dokumentację techniczną, artykuł naukowy, rozdział podręcznika), należy utrwalić. Wiedzą, że jedną ze skuteczniejszych metod utrwalenia tej wiedzy jest właśnie metoda powtarzania spaced repetition. Wiedzą, że powinni zrobić z niego fiszki, aby wiedza się utrwaliła, ale ręczne ich tworzenie jest zadaniem przytłaczającym i pracochłonnym. Próg wejścia, wysiłek potrzebny do stworzenia satysfakcjonującego zestawu fiszek jest tak wysoki, że rezygnują ze spaced repetition, mimo że metoda działa. Po całym dniu pracy ręczne przepisywanie materiału po prostu przytłacza. Uczą się po godzinach, więc czas jest dla nich najdroższym zasobem. 
W rezultacie całkowicie rezygnują z powtórek metodą spaced repetition, mimo że metoda działa, materiał nie zostaje utrwalony, a wiedza z nim związana, jeśli nie jest na bieżąco powtarzana, ulega zapomnieniu dość szybko. Skutkuje to tym, że efektywność ich nauki jest znacznie niższa niż mogłaby być, a najskuteczniejsze narzędzie do utrwalania wiedzy, jakim jest spaced repetition, pozostaje niewykorzystane.

Istniejące rozwiązania SRS, takie jak Anki to potężne narzędzia do powtórek rozłożonych w czasie (spaced repetition), ale etap tworzenia fiszek jest w nich w całości manualny. Wąskim gardłem nie jest algorytm powtórek, tylko droga od surowego tekstu do gotowej talii - zestawu fiszek do powtórek.
Nikomu jeszcze nie udało się dopracować metod generowania fiszek przez AI z czystego tekstu na tyle dobrze, by stało się to bezwysiłkowe. 10xCards wypełnia tę lukę: wklejasz tekst, otrzymujesz wysokiej jakości fiszki, zaczynasz powtórki. W ten sposób minimalizujesz wysiłek potrzebny na przygotowanie materiału do powtórek i maksymalizujesz czas na faktyczne uczenie się. Tylko narzędzia, które to umieją, mogą zrewolucjonizować proces nauki.


Kategoria bólu: **tarcie w workflow** — mechaniczna, powtarzalna praca, którą da się zautomatyzować. Użytkownik wie, co ma robić; problem w tym, ile go to kosztuje czasu i energii.

## User & Persona

**Persona główna:** profesjonalista przygotowujący się do certyfikacji branżowej (IT, medycyna, prawo, finanse) – programista czytający artykuły techniczne, lekarz przeglądający wytyczne kliniczne, prawnik nadrabiający zaległości w orzecznictwie. Regularnie czytają materiały branżowe, chcą je zapamiętać i wiedzą, że powtarzanie przestrzenne działa. Ale nie używają go, ponieważ pisanie dobrych fiszek zajmuje zbyt dużo czasu w stosunku do samego czytania. Potrzebują, aby etap tworzenia wymagał niemal zerowego wysiłku, tak aby pętla powtórek mogła się w ogóle rozpocząć

- Kontekst: nauka po godzinach, obok pracy zawodowej.
- Materiał wejściowy: dokumentacja, materiały branżowe, artykuły — tekst, który da się skopiować.
- Moment sięgnięcia po produkt: tuż po przeczytaniu partii materiału, kiedy treść jest świeża, a energii na godzinę ręcznej pracy już nie ma.
- Motywacja: zna i ceni spaced repetition; nie potrzebuje przekonywania do metody, tylko usunięcia kosztu wejścia.

## Success Criteria

Najmniejszy przepływ end-to-end, który dowodzi, że produkt działa (słowa użytkownika, ujęte w sekwencję):

```
1. Użytkownik loguje się (e-mail + hasło)
2. Użytkownik wkleja tekst do pola wprowadzania (np. artykuł, notatki, dokumentacja)
3. Model AI generuje z niego propozycje fiszek
4. Użytkownik robi review propozycji i każdą akceptuje, edytuje lub odrzuca
5. Zaakceptowane fiszki trafiają do talii użytkownika
6. (Opcjonalnie) Użytkownik tworzy fiszki ręcznie
7. Użytkownik przegląda, edytuje i usuwa fiszki w swojej talii
8. Użytkownik rozpoczyna sesję powtórek na tych fiszkach
```

Budżet czasu: **3 tygodnie pracy po godzinach** na cały przepływ, bez twardego deadline'u.

### Primary

- Pełny przepływ działa end-to-end: od wklejonego tekstu do rozpoczętej sesji powtórek w jednej sesji użytkownika.
- 75% fiszek wygenerowanych przez AI jest akceptowanych przez użytkownika bez modyfikacji.
- 75% wszystkich fiszek użytkownika powstaje z wykorzystaniem AI.

> Obie liczby są Primary świadomie: wskaźnik akceptacji mierzy jakość generowania, udział AI w talii mierzy realne poleganie na nim. Wysoka akceptacja przy niskim udziale oznaczałaby, że AI generuje dobre fiszki, po które nikt nie sięga.

### Secondary

- Użytkownik wraca na kolejną sesję powtórek. Pierwsza sesja to nowość; druga jest dowodem, że narzędzie weszło w nawyk nauki.

### Guardrails

- Żadna fiszka wygenerowana przez AI nie trafia do talii, dopóki użytkownik nie ukończy kroku recenzji i sam nie wyzwoli zapisu. Propozycje są domyślnie zaakceptowane i pokazane do recenzji, ale nic nie jest zapisywane po cichu ani w tle — użytkownik zawsze widzi karty i potwierdza zapis. Krok recenzji jest nieusuwalny. Zaufanie do zawartości talii jest fundamentem nauki.
- Sesja powtórek jest niezawodna: nigdy nie gubi postępów i nigdy nie pokazuje złej fiszki. Wadliwe działanie powtórek niszczy zaufanie do całego narzędzia, nawet jeśli generowanie działa bez zarzutu.

## Functional Requirements

### Konta i dostęp

- FR-001: Użytkownik może zarejestować się za pomocą adresu email i hasła. Priority: must-have
  > Socrates: rozważony kontrargument (passwordless / rejestracja jako tarcie). Rozstrzygnięcie: utrzymany — konta są konieczne dla trwałości talii, model e-mail+hasło zdecydowany w Fazie 2.
- FR-002: Użytkownik może zalogować się e-mailem i hasłem. Priority: must-have
  > Socrates: rozważony kontrargument (koszt zarządzania sesją). Rozstrzygnięcie: utrzymany — logowanie jest nierozdzielne od FR-001.
- FR-003: Użytkownik może usunąć własne konto wraz ze wszystkimi swoimi danymi (fiszki, wklejone teksty, historia powtórek). Priority: must-have
  > Socrates: rozważony kontrargument (poza główną ścieżką / ryzyko przypadkowej utraty). Rozstrzygnięcie: utrzymany jako must-have — użytkownik wkleja materiały firmowe, prawo do usunięcia danych jest fundamentalne. Sposób potwierdzenia usunięcia to szczegół implementacyjny (Open Questions).

### Generowanie fiszek przez AI

- FR-004: Użytkownik może wkleić tekst źródłowy do pola generowania i zlecić wygenerowanie z niego propozycji fiszek przez AI. Priority: must-have
  > Socrates: rozważony kontrargument (brak górnego limitu długości = koszt AI i słabsza jakość). Rozstrzygnięcie: utrzymany; kwestia limitu długości wklejanego tekstu przeniesiona do Open Questions.
- FR-005: Użytkownik może przejrzeć wygenerowane przez AI fiszki, które są domyślnie zaakceptowane, i odrzucić dowolne przed zapisem. Priority: must-have
  > Socrates: rozważony kontrargument (wymóg jawnej akceptacji każdej karty odtwarza stratę czasu przy dużych partiach). Rozstrzygnięcie: zmieniony na opt-out — wszystkie propozycje są domyślnie zaakceptowane; użytkownik skanuje i odrzuca tylko złe, po czym zapisuje. Niskie tarcie, a obowiązkowa recenzja + jawny zapis nadal realizują guardrail zgody na poziomie partii.
- FR-006: Użytkownik może edytować treść propozycji AI przed jej zapisem. Priority: must-have
  > Socrates: rozważony kontrargument (koszt UI / zaciera metrykę akceptacji). Rozstrzygnięcie: utrzymany — edycja ratuje „prawie dobre” propozycje. Skoro metryka akceptacji liczy teraz tylko karty zapisane bez modyfikacji, edytowana propozycja nie liczy się jako czysta akceptacja AI (patrz Open Questions).
- FR-007: Przy zapisie każda propozycja, której użytkownik nie odrzucił, trafia do talii, a odrzucone przepadają — nic nie trafia do talii bez jawnego zapisu. Priority: must-have
  > Socrates: przyjęty kontrargument — całkowite kasowanie odrzuconych pozbawia danych potrzebnych do policzenia wskaźnika akceptacji z Primary (75%). Rozstrzygnięcie: reguła produktowa utrzymana (odrzucone nie trafiają do talii), ale otwarte pozostaje, czy fakt odrzucenia jest logowany zbiorczo/anonimowo do pomiaru metryki — przeniesione do Open Questions.

### Zarządzanie fiszkami

- FR-008: Użytkownik może utworzyć fiszkę ręcznie (bez AI). Priority: must-have
  > Socrates: rozważony kontrargument (ręczny tryb przeczy tezie / obniża udział AI). Rozstrzygnięcie: utrzymany — zawór bezpieczeństwa, gdy AI zawiedzie lub użytkownik dodaje pojedynczą fiszkę.
- FR-009: Użytkownik może przeglądać swoje zapisane fiszki. Priority: must-have
  > Socrates: rozważony kontrargument (lista bez wyszukiwania nie skaluje się). Rozstrzygnięcie: utrzymany; wyszukiwanie/filtrowanie nie jest częścią MVP (potencjalny non-goal / Open Questions).
- FR-010: Użytkownik może edytować istniejącą zapisaną fiszkę. Priority: must-have
  > Socrates: rozważony kontrargument (edycja po zapisie może zaburzyć historię powtórek). Rozstrzygnięcie: utrzymany; zachowanie historii powtórek przy edycji treści — do Open Questions.
- FR-011: Użytkownik może usunąć zapisaną fiszkę. Priority: must-have
  > Socrates: rozważony kontrargument (usunięcie fiszki będącej w aktywnej sesji styka się z guardrailem). Rozstrzygnięcie: utrzymany; obsługa usunięcia w trakcie sesji to szczegół realizacji guardrailu niezawodności.

### Powtórki

- FR-012: Użytkownik może rozpocząć sesję powtórek opartą o gotowy algorytm spaced repetition na swoich fiszkach. Priority: must-have
  > Socrates: rozważony kontrargument (gotowy algorytm wnosi własne ograniczenia vs guardrail niezawodności; „gotowy” jeszcze niedookreślony). Rozstrzygnięcie: utrzymany — własny SRS jest świadomie poza MVP; wybór konkretnej biblioteki to decyzja downstream (tech-stack).

## User Stories

### US-01: Użytkownik zamienia wklejony tekst na talię fiszek

- **Given** zalogowany użytkownik jest na ekranie generowania fiszek
- **When** wkleja tekst i zleca wygenerowanie fiszek
- **Then** widzi listę propozycji (zestaw wygenerowanych fiszek), gdzie każda jest domyślnie zaakceptowana i którą może edytować lub odrzucić przed zapisem, a zapisane karty pojawiają się w jego kolekcji, gotowe do powtórek SR

#### Kryteria akceptacji
- Wygenerowane fiszki mają jasne pytanie (przód) i odpowiedź (tył)
- Użytkownik może przeskanować listę i opcjonalnie edytować lub odrzucić poszczególne karty
- Wszystkie propozycje są domyślnie zaakceptowane; użytkownik odrzuca złe i żadna propozycja nie trafia do talii, dopóki nie potwierdzi zapisu (nic nie jest zapisywane po cichu).
- Zaakceptowane karty są natychmiast dostępne w kolekcji użytkownika.
- Odrzucone karty są usuwane bez śladu.

### US-02: Użytkownik przechodzi sesję powtórek na swojej talii

- **Given** zalogowany użytkownik z co najmniej jedną zapisaną fiszką
- **When** rozpoczyna sesję powtórek
- **Then** algorytm powtórek prezentuje fiszki do przećwiczenia, a po ocenie zapisuje postęp nauki

#### Kryteria akceptacji
- Sesja nigdy nie pokazuje fiszki usuniętej ani nienależącej do użytkownika.
- Ocena fiszki jest zapisywana zanim pojawi się kolejna — przerwana sesja nie gubi już ocenionych fiszek.
- Postęp powtórek przetrwa wylogowanie i zmianę urządzenia.
- Talia bez żadnych fiszek do powtórki pokazuje czytelny stan „nie ma nic do powtórki”, a nie pustą lub błędną sesję.

## Non-Functional Requirements

- **Zgoda przed zapisem (z guardrail).** Żadna fiszka wygenerowana przez AI nie trafia do talii, dopóki użytkownik nie ukończy recenzji i jawnie nie zapisze; nie istnieje ścieżka cichego auto-zapisu ani zapisu w tle (propozycje mogą być domyślnie zaakceptowane w UI, ale zapis zawsze wyzwala użytkownik).
- **Niezawodność sesji powtórek (z guardrail).** Sesja powtórek nigdy nie gubi zapisanego postępu i nigdy nie prezentuje fiszki usuniętej ani nienależącej do użytkownika.
- **Reakcja i widoczny postęp.** Użytkownik dostaje potwierdzenie akcji w czasie poniżej 200 ms, a dla każdej operacji trwającej dłużej niż 2 s widzi ciągły sygnał postępu. Komplet propozycji z generowania pojawia się zwykle w czasie do ~20 s.
Użytkownik widzi ciągły, widoczny postęp podczas generowania fiszek przez AI; wygenerowanie fiszek z typowego artykułu kończy się w czasie, który nie zniechęca użytkownika do przerwania procesu.
- **Izolacja danych między kontami.** Tekst źródłowy i fiszki jednego użytkownika są całkowicie niedostępne dla innych kont.
- **Brak trwałego przechowywania tekstu źródłowego.** Wklejony tekst źródłowy przesłany do wygenerowania fiszek nie jest przechowywany w żadnej pamięci po zakończeniu żądania generowania fiszek.
- **Zasięg przeglądarek.** Produkt jest używalny na dwóch ostatnich głównych wersjach czterech mainstreamowych przeglądarek desktopowych (Chrome, Firefox, Safari i Edge) na komputerach stacjonarnych. Brak optymalizacji mobilnej dla MVP.
- **Trwałość talii i postępu.** Zapisane fiszki oraz historia powtórek przetrwają wylogowanie i zmianę urządzenia.

## Business Logic

Aplikacja decyduje za użytkownika o dwóch rzeczach: **czego się uczyć** — wyodrębnia z surowego tekstu kluczowe pojęcia i przekształca je w pary pytanie–odpowiedź — oraz **jak i kiedy to powtarzać** — układa harmonogram powtórek każdej fiszki zgodnie z modelem spaced repetition.
Innymi słowy, 10xCards określa, jaką wiedzę warto wyciągnąć z tekstu źródłowego i jak sformułować ją w postaci skutecznych fiszek (generowanie AI), a następnie decyduje, kiedy powtarzać każdą kartę na podstawie wyników przypominania sobie przez użytkownika (harmonogramowanie SR)

To dwie osobne reguły domenowe, nie jedna:

- **Reguła 1 — ekstrakcja i przekształcenie.** Reguła generowania AI przetwarza surowy tekst źródłowy (wklejony przez użytkownika) i produkuje zestaw par pytań i odpowiedzi na fiszkach. Wejście: surowy tekst wklejony przez użytkownika (artykuł, notatki, dokumentacja). Wyjście: zbiór propozycji fiszek, każda jako para pytanie–odpowiedź reprezentująca jedno pojęcie warte zapamiętania. Decyzja domenowa: które fragmenty tekstu są warte zapamiętania i jak rozbić je na atomowe pary Q–A. Użytkownik doświadcza tej reguły realizując US-01: wkleja tekst, otrzymuje karty, których nie musiał sam pisać, przegląda partię — edytując lub odrzucając dowolne — i zapisuje resztę.
- **Reguła 2 — harmonogram powtórek.** Reguła harmonogramowania SR układa harmonogram powtórek dla fiszek, które trafiły do talii użytkownika. Algorytm dobiera termin następnej powtórki dla każdej karty na podstawie jego wyników z poprzednich sesji. Wejście: talia fiszek użytkownika oraz historia jego ocen z poprzednich powtórek. Wyjście: zestaw fiszek do przećwiczenia teraz i moment kolejnej powtórki dla każdej z nich. Decyzja domenowa: kiedy dana fiszka powinna wrócić, żeby powtórka trafiła w moment optymalny dla zapamiętania. Użytkownik doświadcza teje reguły rozpoczynając sesję powtórek (US-02): otwórz aplikację, zobacz dzisiejsze karty, nigdy sam nie planuj własnego harmonogramu nauki

Granica między regułami jest miejscem styku: Reguła 1 wypełnia talię, Reguła 2 zarządza nauką na tej talii. Fiszka utworzona ręcznie (FR-008) pomija Regułę 1, ale podlega Regule 2 na równi z fiszkami z AI.

## Access Control

Wielu użytkowników, konta wymagane do korzystania z produktu (fiszki muszą przetrwać zmianę urządzenia).

- **Wejście:** rejestracja i logowanie e-mailem i hasłem. Bez logowania społecznościowego, bez magic linków.
- **Model ról:** płaski — jeden typ użytkownika, brak roli administratora w MVP.
- **Izolacja danych:** użytkownik widzi i modyfikuje wyłącznie własne fiszki. Brak jakiegokolwiek współdzielenia między kontami.

## Non-Goals

Funkcjonalne:

- **Własny, zaawansowany algorytm powtórek (typu SuperMemo/Anki).** Opieramy się o gotowy algorytm (FR-012); budowa własnego SRS to osobny, kosztowny projekt.
- **Import plików (PDF, DOCX, itp.).** Wejściem jest wyłącznie wklejony tekst (FR-004); parsowanie formatów odkładamy.
- **Współdzielenie i talie zespołowe.** Pełna izolacja między kontami; zero współdzielenia zestawów. Blokuje wielonajemność na starcie.
- **Integracje z zewnętrznymi platformami edukacyjnymi.** Poza zakresem MVP.
- **Aplikacja mobilna (natywna).** Tylko web; responsywność mobilna również poza MVP.
- **Wyszukiwanie / filtrowanie talii.** Przegląd talii (FR-009) bez wyszukiwarki w pierwszej wersji.

Niefunkcjonalne:

- **Pełna zgodność WCAG-AA (accessibility).** MVP nie stawia formalnego celu a11y; dostępność odłożona na później.

## Open Questions

1. **Limit długości wklejanego tekstu** — czy istnieje górny limit znaków dla FR-004 (koszt AI i jakość generowania)? Owner: użytkownik / decyzja downstream.
2. **Pomiar wskaźnika akceptacji AI** — czy fakt odrzucenia propozycji (FR-007) jest logowany zbiorczo/anonimowo, żeby dało się policzyć metrykę „75% akceptacji” z Primary, mimo że odrzucone nie trafiają do talii? Owner: użytkownik.
3. **Edytowana propozycja a metryka** — metryka akceptacji liczy teraz tylko karty zaakceptowane *bez modyfikacji*, więc mocno edytowana propozycja nie jest czystą akceptacją AI. Nadal otwarte: czy edytowana-i-zapisana propozycja (FR-006) liczy się do „75% talii tworzonej przez AI” (metryka udziału w talii)? Gdzie próg między „wspomaganą przez AI” a „ręczną”? Owner: użytkownik.
4. **Edycja fiszki a historia powtórek** — przy edycji zapisanej fiszki (FR-010) historia ocen jest zachowywana czy resetowana? Owner: decyzja downstream (zależna od wybranego algorytmu SRS).
