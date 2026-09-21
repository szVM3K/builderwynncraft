# Wynncraft Build Recommender

Generuje 9-slotowy build (Helmet, Chestplate, Leggings, Boots, 2× Ring, Bracelet, Necklace, Weapon)
dla podanego poziomu, klasy i archetypu, na podstawie wszystkich przedmiotów z bazy Wynnbuildera.

## Strona online (GitHub Pages)

Push na gałąź `main` uruchamia workflow `.github/workflows/pages.yml`: `npm ci`, `npm run build` i publikacja katalogu
`dist/` na GitHub Pages (workflow sam włącza Pages w repo). W repo `<user>.github.io` strona jest pod
`https://<user>.github.io/`, w każdym innym pod `https://<user>.github.io/<repo>/` (Vite ma `base: "./"`, więc
oba warianty działają bez zmian). Pierwsze uruchomienie widać w zakładce Actions; potem każda zmiana w `main`
aktualizuje stronę po ~1–2 minutach.

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski
npm run build      # wersja produkcyjna w dist/
```

## Aktualizacja przedmiotów po patchu Wynncrafta

```bash
npm run update-items             # najnowsza wersja danych Wynnbuildera
npm run update-items -- 2.2.4.0  # konkretna wersja
```

Skrypt nadpisuje `src/wynncraft-items.json`, zachowując strukturę danych Wynnbuildera.

Efekty węzłów drzewka (bonusy, przełączniki, suwaki, czary) po nowej wersji danych:

```bash
npm run update-tree-effects             # atree.json z wersji zapisanej w src/ability-trees.json
npm run update-tree-effects -- 2.2.4.0  # konkretna wersja
```

## Gdzie co jest

- Sekcja **Custom stats** w formularzu: focus żywiołów (Neutral/Earth/Thunder/Water/Fire/Air) jako preferencja,
  checkboxy szybkości ataku broni (broń wybierana spośród zaznaczonych), preferowanie przedmiotów z buildów
  z poradnika i dodatkowe priorytety statystyk (np. Mana Regen, Life Steal).
- Cały interfejs jest w stylu GUI z gry: pikselowa czcionka Tiny5 z cieniem jak w Minecrafcie, panele i przyciski
  ze skosem jak w menu Wynncrafta, złote tytuły, czarne pola tekstowe, paski jak XP bar (klasy `mc-*` w `MC_STYLES`
  w `BuildRecommender.jsx`).
- Karty przedmiotów to tooltip z gry (układ jak w Wynncraft 2.1): czcionka Pixelify Sans (najbliższa czcionce
  tooltipów w grze spośród otwartych), ikonka w ramce, nazwa w kolorze rzadkości ze średnim rollem „[50.0%]”,
  odznaki rzadkości i typu, żywioły, sloty powderów w rogu, duży DPS z szybkością ataku (uderzenia/s) i zakresami
  obrażeń per żywioł albo duże HP z obronami, pięć rombów umiejętności z polami wyboru (spełnione przez Skill
  Pointy buildu), Class Type i Combat Level, identyfikacje w grupach (SP, obrażenia, HP/mana/obrony, reszta,
  koszty czarów z nazwami czarów klasy) z tagami rollu, Major ID. Kropki na dole przełączają strony karty:
  przedmiot, jak zdobyć (źródło, Trade Market, wiki), rozpiska wyniku.
- **Ability tree**: drzewka umiejętności wszystkich 5 klas (dane gry 2.2.4.0: pozycje węzłów, koszty, wymagania,
  blokady, progi archetypów, limit AP zależny od poziomu), sprawdzone z wiki Wynncrafta. Klikanie odblokowuje węzły
  jak w grze, a dominujący archetyp drzewka można jednym kliknięciem ustawić dla buildu.
- **Build totals** pokazuje też HP i obrony żywiołów (bazowe obrony + procentowe bonusy).
- **Defence focus** w Custom stats: wybrane obrony żywiołów liczą się do wyniku przedmiotów, a opcja
  „Avoid negative defences” karze ujemne obrony.
- **Other picks / Exclude / Unpin** na każdej karcie: lista kolejnych kandydatów na slot (wynik, czy mieszczą się
  w Skill Pointach); wybrany przedmiot jest przypinany, a reszta buildu dopasowuje się do niego. Exclude usuwa
  przedmiot z puli. Przypięte i wykluczone przedmioty widać w Custom stats.
- Przycisk **i** w prawym górnym rogu karty: jak zdobyć przedmiot (źródło z danych Wynnbuildera), czy można nim
  handlować na Trade Market (✓/✗) i link do wiki Wynncrafta (strona przedmiotu albo wyszukiwanie).
- **Build focus** w Custom stats: trzy suwaki 0–100% – Main attack DPS, Spell DPS i EHP & sustain. X% = X% pełnej
  wagi grupy (0% ignoruje grupę, 100% to pełny priorytet), a kreska „meta” to pozycja archetypu wyliczona ze
  skalibrowanych wag (nieruszony suwak daje dokładnie kalibrację). Powyżej mety main attack jest liczony jako
  prawdziwy DPS całego zestawu w trakcie wyszukiwania (tiery szybkości się sumują, raw × uderzenia/s, Strength,
  crit), z szerszą pulą kandydatów i drugim przebiegiem dopasowanym do wybranej broni.
- **Rolle identyfikacji**: każda ID pokazana i liczona przy rollu 50% (dodatnie = 80% bazy, ujemne = baza), z tagiem
  [xx%] jak w grze; przycisk **Rolls** na karcie ustawia roll całego przedmiotu albo każdej ID osobno (0–100%).
  Zasady jak w grze/Wynnbuilderze: 30–130% bazy dla dodatnich, 130–70% dla ujemnych, koszty czarów odwrotnie,
  Skill Pointy, ID statyczne (np. tier szybkości) i przedmioty z fixID nie rollują. Wagi archetypów skalibrowano
  na wartościach 50%.
- **Wynik ×10** wszędzie w interfejsie, a „How is the score calculated?” nad kartami tłumaczy zasady
  (wartość ÷ jednostka × waga × 10, broń, kary, premie) na przykładzie przedmiotu z bieżącego buildu;
  tooltip na „score” karty pokazuje składowe.
- **Other picks** pokazuje przy każdej alternatywie różnicę w podsumowaniu (DPS, trafienie czaru, EHP, HP, mana,
  regeneracja, prędkość) po podmianie. Lista i wynik na karcie to wynik przedmiotu **w tym buildzie**: punkty
  z identyfikacji, udział w prawdziwym DPS main attacku zestawu (przy suwaku main attacku ponad metą), minus
  wartość Skill Pointów, które zestaw musi przez niego dodatkowo przydzielić, i kara za deficyt HP – czyli
  dokładnie to, czym kieruje się wyszukiwanie (wcześniej lista szła po samym liniowym wyniku i przy wysokim
  suwaku main attacku znikały z niej przedmioty od main attacku, np. Broken Balance czy Lobotomy).
- **Score calculation** (zakładka): wszystkie wagi statystyk i stałe wyniku (waga DPS broni, premia za przedmioty
  z poradnika, kara za SP spoza archetypu, deficyt HP, wartość wolnego SP, okno poziomu), jakich generator używa
  w tej chwili dla wybranego archetypu i ustawień, z możliwością nadpisania każdej (pole puste = wyliczona).
  Nadpisania (`options.scoring`) są zapamiętywane w przeglądarce i działają w wyszukiwaniu, „Other picks”
  i dopasowaniu archetypu w solverze.
- **Build info** (zakładka): czary klasy z combo kliknięć i kosztami z Twojego drzewka, ultimate archetypu,
  „co archetyp robi z każdym czarem” (z opisów węzłów drzewka 2.2.4.0 – które węzły zmieniają który czar),
  typowe cykle czarów (cyfry do kalkulatora cyklu, z kosztem many i tym, co na ile starcza Mana Regen),
  wskazówki co stackować, plus rekomendowane powdery.
- **Recommended powders** (panel w podsumowaniu i w Build info; sloty powderów na kartach pokazują symbol
  polecanego żywiołu): broń – żywioł, na którym build zyskuje najwięcej (bonusy %, umiejętność, focus),
  z konwersją obrażeń neutralnych i specialem broni; pancerz – żywioł najsłabszej obrony buildu (obrona, HP,
  osłabiona obrona przeciwna, special pancerza) albo żywioł ataku dla speciala. Dane z wiki (Powders, tier VI).
- **Item level** w Custom stats: „Prefer items within 10 levels” (domyślnie) obniża wynik przedmiotów starszych
  niż okno o 4% za każdy poziom poza nim (najwyżej o połowę), więc stary przedmiot wygrywa tylko, gdy nic nowszego
  nie jest blisko; „within 20”, „Any item level” albo „Only …” (twarde odcięcie). Przypięte przedmioty zawsze zostają.
  Solver ma własne pole minimalnego poziomu (puste = poziom − 10).
- Na szerokim ekranie podsumowanie (Damage, Survivability, efekty drzewka, Skill Points, Build totals) jest w prawej
  kolumnie obok kart.
- **Spell DPS** w Damage: najlepszy czar z drzewka liczony jako obrażenia × rzuty na sekundę, które utrzyma mana
  ((Mana Regen + 25)/5 na sekundę plus zwrot many czaru; maksymalnie 3 rzuty/s przy 9 kliknięciach/s), obok wersji
  „spam” bez limitu many; każdy czar ma swoją wartość, a kalkulator cyklu liczy DPS cyklu i wersję utrzymywalną.
- **Build Solver** (zakładka): własny wybór klasy i archetypu (suwak „Archetype fit” dodaje wagi archetypu do celów),
  na wzór Build Solvera rawfish69 – cele minimalne (DPS, trafienie czaru, EHP, HP, mana,
  regeneracja, life steal, prędkość, limit SP), priorytety, dozwolone tiery, minimalny poziom przedmiotu i
  „Advanced IDs” (zakresy dowolnych identyfikacji w kolejności ważności). Beam search z dokładnym podsumowaniem
  każdego stanu zwraca kilka zestawów spełniających cele albo najbliższe z listą braków; każdy można pokazać w siatce.
- Broń bez bazowych obrażeń (np. The Specialist – obrażenia tylko z powderów) nie jest już polecana, bo aplikacja
  nie modeluje powderów.
- Obrażenia „Elemental …” i per żywioł (np. Elemental Spell Damage, Water Main Attack Damage) liczą się do wyniku.
- **Damage** i **Survivability** w podsumowaniu: DPS main attacku (na atak × ataki/s, z critami), czary z drzewka
  (średnie obrażenia albo leczenie i koszt many), bonus Str, szansa na crit, Effective HP (z i bez Agility), HP,
  redukcja z Defence, odporność z drzewka, regeneracja, life steal i obrony żywiołów. Bez powderów i tomów.
- **Average DPS** na karcie broni to liczba z tooltipa w grze: średnie bazowe obrażenia × uderzenia/s
  (np. Normal 2.05/s). Nie zawiera ID, Skill Pointów, powderów ani drzewka – te są w „Main attack DPS” buildu.
- **Rozpiski jak w Wynnbuilderze**: main attack i każdy czar z drzewka to rozwijana karta z częściami (mnożniki per
  żywioł, średnia z critami, zakres bez crita i z critem per żywioł, leczenie), a dalej Mana Regen z bazą (+25/5s),
  Mana Steal na trafienie, Total Mana (100 + Max Mana + Intelligence), Effective Life Steal, Life per hit, Walk Speed
  i zasięg main attacku. Kalkulator cyklu czarów (np. „1213” przy 9 kliknięciach/s) liczy zużycie i bilans many.
- **Ability tree effects** (pod podsumowaniem i w zakładce drzewka): zaznaczone węzły wchodzą w obliczenia.
  Stałe bonusy (np. Earth Mastery), przełączniki buffów (np. Mask of the Lunatic, Activate Backstab) i suwaki
  stacków/trafień (np. Corrupted, Focus) zmieniają statystyki, mnożniki obrażeń i odporności oraz czary.
  Własna implementacja semantyki danych atree.json Wynnbuildera; wyniki sprawdzone z kodem Wynnbuildera
  (1271 porównań na 75 scenariuszach, zgodne co do 0,5%).
- **Skill Pointy jak w grze**: przedmioty zakłada się po kolei (bonusy SP liczą się po założeniu, broń na końcu),
  a na koniec nic nie może „spaść” (wymagania wobec bonusów pozostałych przedmiotów, także ujemnych). Algorytm
  szuka kolejności o najmniejszej sumie punktów (programowanie dynamiczne po podzbiorach). Sprawdzone
  z calculate_skillpoints Wynnbuildera na 94 buildach: 93 identyczne, 1 raz o 3 SP mniej (poprawna kolejność,
  którą Wynnbuilder pomija).
- **Effective Health (game)** w Survivability liczone jak na ekranie Combat Information w grze:
  HP ÷ (1 − Defence%) ÷ (1 − Agility%) bez mnożnika klasy; obok EHP w wersji Wynnbuildera. Bloki „[100%] Spell
  Damage” i „[100%] Main Attack Damage” pokazują zakresy per żywioł i łączny bonus z ekwipunku, jak w grze.
- Drzewko gracza (węzły, przełączniki, suwaki, per klasa) jest zapamiętywane w przeglądarce, tak jak ranga.
- Buildy, w których przedmioty razem zabierają HP, dostają karę (żeby nie kończyło się na 5 HP).
- **Rank** na początku formularza (No rank, VIP, VIP+, HERO, HERO+, CHAMPION): VIP+ pożycza 2 AP, HERO i wyżej 4 AP
  (wiki Wynncrafta), maksimum 50 AP. Wybór jest zapamiętywany w przeglądarce.
- **Guide builds**: 126 buildów z The Ultimate Build Guide (forums.wynncraft.com, wątek 320092), zdekodowanych
  z linków Wynnbuildera, do podejrzenia w siatce. Na tych buildach skalibrowano wagi archetypów.
- `src/BuildRecommender.jsx`: wagi archetypów (`ARCHETYPES`), opcje personalizacji (`DAMAGE_FOCUS_OPTIONS`,
  `ATTACK_SPEEDS`, `STAT_BOOSTS`), normalizacja danych, algorytm
  `generateOptimizedBuild()` z walidacją Skill Pointów i cały interfejs. Opis systemu wag jest w komentarzu na górze pliku.
- `src/wynncraft-items.json`: 5 414 przedmiotów (dane Wynnbuildera 2.2.4.0) z `fixID` i listą ID statycznych.
- `src/guide-builds.json`: buildy z poradnika (przedmioty, tomy, autorzy, linki do Wynnbuildera).
- `src/ability-trees.json`: drzewka umiejętności (z atree.json Wynnbuildera dla wersji 2.2.4.0), tabela AP na poziom
  oraz efekty węzłów (`effects`, `props`, `base`) z tego samego pliku.
- Dane przedmiotów i drzewek pochodzą z projektu Wynnbuilder (github.com/wynnbuilder/wynnbuilder.github.io, GPL-3.0).

## Źródła

- Wynnbuilder – dane przedmiotów, drzewek i formuły obrażeń: https://wynnbuilder.github.io/ (GPL-3.0)
- Build Solver (rawfish69) – wzór dla zakładki Build Solver (cele, priorytety, Advanced IDs, top N, „near miss”):
  https://rawfish69.github.io/build-solver/
- Wynncraft Wiki – DPS broni, rolle identyfikacji, drzewka: https://wynncraft.wiki.gg/
- Forum Wynncraft – Stats and Identifications Guide (wątek 246308), The Ultimate Build Guide (wątek 320092),
  How Damage Is Calculated – Rekindled Edition (wątek 320808)
- Wynnguides (afeenah): https://afeenah.github.io/wynnguides/
- Czcionka tooltipów: Tiny5 (@fontsource/tiny5, licencja OFL).
- `scripts/update-items.mjs`: pobieranie i odchudzanie `items.json` z repozytorium Wynnbuildera.
- `scripts/update-tree-effects.mjs`: dopisywanie efektów węzłów z `atree.json` do `src/ability-trees.json`.
