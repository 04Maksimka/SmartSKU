# SmartSKU

Умные ящики для учёта мелкого крепежа: тензодатчик + NFC в каждой ячейке, ESP32 в каждом боксе, бэкенд ведёт учёт.
Идея и требования — в `CLAUDE.md`.

[Основная табличка с нужными вещами.](https://docs.google.com/spreadsheets/d/1SoUDmIfM1n-rBG37zFCyyzTNkSoC23q8NhGscTcgeVo/edit?usp=sharing)

## Текущий этап

**Сделано (этап 1: backend core + эмулятор ESP):**
- регистрация (provisioning) новых боксов по MQTT, выдача `box_id`;
- приём телеметрии `box_data`, хранение состояния ячеек, журнал событий учёта;
- калибровка: запуск из API, отправка команды на бокс, привязка компонента к NFC-метке ячейки;
- команды индикаторов (LED + дисплей) при изменении содержимого;
- эмулятор ESP32 с REST-ручками («вынуть ячейку», «насыпать/взять N штук», «вставить»);
- всё запускается в Docker; сценарий калибровки и работы проверен end-to-end.

**Этап 2 (в работе): веб-фронтенд.** Дашборд обновляется сам раз в секунду: боксы и слоты, компоненты, калибровки,
журнал событий. Действия, которые уже не требуют Swagger: запустить калибровку (мастер с выбором свободной ячейки),
отменить заявку, освободить ячейку.

**Этап 3 (в работе): реальное железо.** Прошивка `firmware/smartsku_box` (1 бокс, 1 ячейка) работает на плате:
регистрация, телеметрия, NFC, HX711 и обнуление проверены (одна тяжёлая деталь ≈ 34 000 ед., шум ±70).
Осталось проверить калибровку штуки с фронта и обычный сценарий «взял/положил».

**Дальше:** переносить во фронт остальные сценарии (поиск/фильтры компонентов, история по ячейке), миграции БД (Alembic), авторизация брокера.

## Архитектура

```
 ESP32-боксы / эмулятор ──MQTT──► Mosquitto ◄──MQTT── backend (FastAPI) ──► SQLite (backend/var/smartsku.db)
                                                          ▲
                                                 REST API │
                                  frontend (nginx + Lit) ─┘  /api проксируется на backend
```

| Сервис | Папка | Порт | Назначение |
|---|---|---|---|
| `mosquitto` | `infra/mosquitto` | 1883 | MQTT-брокер |
| `backend` | `backend/` | 8000 | бизнес-логика, REST API, Swagger: `/docs` |
| `frontend` | `frontend/` | 8080 | веб-дашборд + панель эмулятора: http://localhost:8080 |
| `emulator` | `emulator/` | 8001 | эмуляция ESP32-боксов, Swagger: `/docs` |

Правила кода: только ООП, конфиги в `config/*.yaml` (`config.local.yaml` — запуск на хосте, `config.docker.yaml` — в контейнере,
путь переопределяется `SMARTSKU_BACKEND_CONFIG` / `SMARTSKU_EMULATOR_CONFIG`), DI через dishka, пакетный менеджер uv.

**Линтер — ruff** (настройки в `pyproject.toml` каждого проекта). Прогонять после любых изменений:
`uv run ruff format . && uv run ruff check --fix .` в `backend/` и `emulator/`. В `.claude/settings.json` настроен
хук Claude Code, который делает это автоматически после каждого редактирования `.py`-файла.

### Почему MQTT
Боксу нужно и постоянно слать данные, и мгновенно получать команды. MQTT даёт это без поллинга, у ESP32 есть готовые
библиотеки (PubSubClient) с переподключением, а механизм Last Will позволяет брокеру самому сообщить, что бокс пропал.

### Backend (`backend/src/smartsku_backend`)
- `config.py` — pydantic-модели конфига и загрузчик yaml.
- `messaging/` — `contracts.py` (JSON-контракты), `topics.py`, `publisher.py` (отправка команд), `gateway.py`
  (подключение к брокеру, маршрутизация входящих сообщений в сервисы в request-scope dishka).
- `services/`
  - `provisioning.py` — выдаёт `box_id` по `hardware_id` (идемпотентно);
  - `box_status.py` — online/offline бокса;
  - `telemetry.py` — ядро: сравнивает показания с сохранённым состоянием, пишет события, завершает калибровку,
    формирует команды индикаторов;
  - `runtime_cache.py` — in-memory кэш последних показаний, чтобы не ходить в БД каждые 0.5 с на каждый бокс;
  - вес во всём проекте — в условных единицах (у реальных боксов — отсчёты HX711, в эмуляторе — «граммы»);
    порог `telemetry.weight_change_threshold` отсекает мелкие изменения, фронт подписывает вес как «ед.»;
  - `indicators.py` — команда индикаторов: дисплей показывает количество (0, если ячейки нет или она не откалибрована),
    светодиод пока всегда `none` — он зарезервирован под другие сценарии;
  - `calibration.py`, `inventory.py` — сценарии для REST API.
- `db/` — SQLAlchemy-модели и `Database`. БД — SQLite-файл `backend/var/smartsku.db` (в Docker папка примонтирована,
  файл можно открыть с хоста), режим WAL. Теги — JSON-колонка, время хранится в UTC. Таблицы создаются при старте
  (миграций пока нет — при изменении схемы просто удалить `backend/var/smartsku.db*`).
- `api/` — контроллеры-классы и схемы ответов.

**Модель данных:**
- `boxes` — бокс (`id`, `hardware_id`, `online`).
- `locker_states` — последнее состояние слота `(box_id, locker_id)`: вставлена ли ячейка, какая, вес, количество.
- `components` — что лежит в ячейке, **ключ — `nfc_id`**: имя, теги, вес штуки, количество.
  Так калибровка «едет» вместе с ячейкой при перестановке в другой слот или бокс; количество бэкенд считает сам
  по своему `piece_weight`.
- `calibrations` — заявки на калибровку (`pending` → `completed` / `cancelled`).
- `inventory_events` — журнал: `cell_removed`, `cell_inserted`, `quantity_changed`, `calibrated`
  с `quantity_before/after`. Например, «унёс ячейку с 20 шт., вернул с 3» → `cell_inserted 20 -> 3`.

### Эмулятор (`emulator/src/smartsku_emulator`)
- `domain/model.py` — `VirtualCell` (ячейка с NFC, содержимое уезжает вместе с ней), `VirtualBox` (логика прошивки:
  калибровка при вставке после команды, пересчёт штук), `Fleet` (все боксы + вынутые ячейки «на руках»).
- `messaging/box_link.py` — MQTT-клиент одного бокса: provisioning, телеметрия, приём команд.
- `domain/identity_store.py` — сохраняет полученный `box_id` в `emulator/var/` (аналог NVS-памяти ESP).
- `domain/state_store.py` — состояние флота (вес в ячейках, вес штуки после калибровки, где какая ячейка, ожидающая
  калибровка) в `emulator/var/fleet_state.json`, запись после каждого изменения. Реальный бокс тоже не забывает это
  при перезагрузке: тензодатчик меряет фактический вес, а вес штуки лежит в NVS. Пока файл есть, стартовые ячейки из
  `config/*.yaml` игнорируются — чтобы начать с нуля, удалите `emulator/var/`.
- Стартовые боксы/ячейки задаются в `config/*.yaml`. Ячейки создаются пустыми и неоткалиброванными: эмулятор ничего
  не знает о компонентах. Вес меняется ручкой `POST /api/cells/{nfc_id}/grams {"grams": 50}`;
  `POST /api/cells/{nfc_id}/pieces {"pieces": -3}` доступна только после калибровки и использует вес штуки,
  который вычислил бокс.
- В `GET /api/boxes` у слота: `nfc_flag` — вставлена ли ячейка; `calibrated_piece_weight` — вес штуки, посчитанный
  боксом (уходит в телеметрию как `piece_weight`); `pending_calibration` — бокс получил команду и ждёт вставки ячейки.

### Фронтенд (`frontend/`)
TypeScript + [Lit](https://lit.dev) (веб-компоненты — классы, в духе правила «только ООП»), сборка Vite, npm.
В Docker nginx раздаёт сборку и проксирует `/api/` на `backend:8000`, а `/emulator-api/` на `emulator:8001/api/`
(через переменную и `resolver`, чтобы nginx поднимался и без запущенного эмулятора). CORS не нужен.

Две вкладки: **Склад** (учёт) и **Эмулятор** (виртуальное железо вместо Swagger: вынуть/вставить ячейку, насыпать
или забрать граммы и штуки, добавить бокс или ячейку, видно дисплей слота). Вкладка эмулятора опрашивает его
только пока открыта и скрывается, если в конфиге пустой `emulator_base_url`.
- `public/config.yaml` — рантайм-конфиг (частота опроса, сколько событий/калибровок показывать); в Docker примонтирован,
  меняется без пересборки.
- `src/api/` — `http-client.ts` (общий fetch, текст ошибки из `detail`), типы и клиенты бэкенда (`client.ts`,
  копия `api/schemas.py`) и эмулятора (`emulator-client.ts`).
- `src/app/emulator-store.ts` — то же для эмулятора, с остановкой опроса при уходе со вкладки.
- `src/app/dashboard-store.ts` — опрашивает бэкенд (пауза, когда вкладка скрыта) и собирает данные для экрана:
  ожидающая калибровка слота, какая ячейка извлечена из пустого слота (по журналу), где сейчас ячейка компонента.
- `src/app/formatter.ts` — русские подписи, форматы времени/веса. `element-registry.ts` — регистрация элементов.
- `src/app/command-service.ts` — действия (старт/отмена калибровки, освобождение ячейки); после каждого сразу
  обновляет данные. `dashboard-events.ts` — события от карточек и таблиц всплывают в `sku-app`, который владеет
  `CommandService`.
- `src/components/` — `sku-app` (страница), `calibration-dialog` (мастер калибровки из CLAUDE.md: выбор свободной
  ячейки → название, теги, N штук → инструкция и ожидание вставки), `box-card`, `locker-tile` (кнопка действия,
  подсвечивается при изменении),
  `component-table`, `calibration-list`, `event-log` (фильтры по боксу/типу/поиску, новые строки подсвечиваются),
  `emulator-panel` (вкладка эмулятора).
- Живые обновления — простой поллинг раз в секунду. Если станет тяжело, заменить на SSE/WebSocket из бэкенда.

## MQTT-протокол (контракт для прошивки ESP)

Префикс топиков `smartsku` (настраивается). JSON-примеры — `json_contracts/`.

| Топик | Направление | QoS | Сообщение |
|---|---|---|---|
| `smartsku/provision/request` | бокс → бэкенд | 1 | `{"hardware_id": "<MAC>"}` |
| `smartsku/provision/response/<hardware_id>` | бэкенд → бокс | 1 | `{"hardware_id": "...", "box_id": "..."}` |
| `smartsku/boxes/<box_id>/data` | бокс → бэкенд | 0 | `box_data.json`, каждые ~0.5 с |
| `smartsku/boxes/<box_id>/status` | бокс → бэкенд | 1, retain | `online` при подключении; `offline` — Last Will |
| `smartsku/boxes/<box_id>/commands` | бэкенд → бокс | 1 | `calibration_command.json`, `indicators_command.json` или `{"command":"tare","box_id":"...","locker_id":0}` |

**Инициализация бокса:** при первом включении (нет `box_id` в памяти) бокс подписывается на
`provision/response/<hardware_id>`, публикует `provision/request`, сохраняет полученный `box_id` и дальше работает
с ним. Повторный запрос с тем же `hardware_id` вернёт тот же `box_id`.

**Требования к прошивке:**
- без ячейки: `nfc_flag=false`, `nfc_id=""`, `weight=0`;
- до калибровки `piece_weight=0`, `number_of_pieces=0`;
- по команде `tare` бокс проверяет, что ячейка вставлена, и сохраняет ноль по четырём окнам измерения (~2 с);
- по команде `calibration` бокс ждёт повторной вставки ячейки и считает `piece_weight = weight / num_of_pieces`.
  Бэкенд засчитывает калибровку, когда видит новый `piece_weight > 0` в слоте с активной заявкой.

## Запуск

```bash
docker compose --profile emulator up -d --build   # всё вместе
docker compose up -d                              # без эмулятора (реальные ESP)
docker compose --profile emulator down            # остановить
# профиль нужен в любой команде: без него compose гасит контейнер эмулятора
rm -rf backend/var emulator/var                   # сбросить БД, идентичности и состояние боксов
```

Локальная разработка (инфраструктура в Docker, код на хосте):
```bash
docker compose up -d mosquitto
cd backend && uv run python -m smartsku_backend
cd emulator && uv run python -m smartsku_emulator
uv run ruff format . && uv run ruff check --fix . && uv run pytest   # в backend/ и emulator/
cd frontend && npm install && npm run dev   # http://localhost:5173, /api проксируется на localhost:8000
npm run build                               # tsc (проверка типов) + сборка
```

### Прошивка ESP32 (`firmware/`)
Скетч Arduino IDE (`.ino` называется так же, как папка). Проверено на DOIT ESP32 DEVKIT V1 (ESP32-D0WD-V3),
пакет esp32 3.3.x (старый 1.0.6 не собирается на macOS: требует `python`).
Несекретные настройки — `AppConfig.h` (YAML на ESP нет), секреты — `secrets.h` (копия `secrets.example.h`, в `.gitignore`).
- `firmware/smartsku_box/` — **прошивка бокса** по MQTT-протоколу выше (сейчас 1 ячейка; добавить ячейку =
  строка в `AppConfig::LOCKERS` и `LOCKER_COUNT`). Схема подключения ячейки 0 взята из `tenzo_test.ino`
  коллеги (ветка `master`): HX711 DOUT=36 SCK=32, TM1637 CLK=33 DIO=25, RC522 SCK=22 MISO=21 MOSI=23 SS=19 RST=16.
  - `WifiConnection` — WPA2 Enterprise по логину/паролю или обычный пароль, на старте печатает видимые 2.4 ГГц сети;
    `MqttLink` — PubSubClient, переподключение, Last Will, смена сессии после получения `box_id`.
  - `BoxApp` — provisioning (`box_id` в NVS), телеметрия раз в 0.5 с, команды `calibration`/`indicators`,
    светодиод платы: часто мигает — нет брокера, редко — ждёт `box_id`, горит — работает.
  - `Locker` — ячейка: `LoadCell` (HX711, среднее по окну 0.5 с), `NfcReader` (RC522; опрос WUPA каждые 100 мс,
    ячейка «вынута» после 3 пропусков подряд), `CountDisplay` (TM1637), `IndicatorLed` (пины пока -1).
    **Вес — в условных единицах:** сырые отсчёты HX711 минус ноль (пустая ячейка), в граммы не переводится —
    количество = вес / вес штуки, и оба меряются одним датчиком. Если при нагрузке `net` уменьшается —
    `invertLoad = true` у ячейки. Пороги (`NOISE_UNITS`, `EMPTY_UNITS`) — в отсчётах, подбираются по шуму датчика.
    Отправляемый вес меняется с гистерезисом: при сдвиге ≥ `min(NOISE_UNITS, вес штуки / 2)`, так шум не
    засоряет бэкенд, а изменение на одну штуку видно всегда.
    После вставки ячейка не попадает в `box_data`, пока вес не устоится (3 окна с разбросом < `NOISE_UNITS`,
    максимум 5 с) — бэкенд принимает любой поднабор ячеек. Без выставленного нуля ячейка не отправляется совсем.
    Калибровка штуки считается по установившемуся весу.
    Дисплей показывает `screen_number` от бэкенда, без связи — количество, посчитанное самим боксом.
  - `BoxStorage` (NVS): `box_id`, ноль каждой ячейки, вес штуки по NFC-метке (ключ — хэш UID).
    Тарирования при включении нет: в ячейке уже может лежать крепёж.
  - `ServiceConsole` — наладка через Serial Monitor (115200): `t` — ноль по пустой вставленной ячейке (среднее за 2 с),
    `s` — статус, `v` — показания раз в секунду (`raw`, `net`, `weight`), `forget` — забыть `box_id`.
  - `nfc_id` — UID метки в hex без разделителей (`04A1B2C3`).
- Библиотеки: PubSubClient, ArduinoJson 7, HX711 (bogde), MFRC522 (miguelbalboa), GyverTM1637.

**Сборка из терминала** (`arduino-cli` из brew; `downloads.arduino.cc` отдаёт 403, поэтому библиотеки ставятся
`git clone` в `~/Arduino/libraries`, а `ctags` собран из исходников `arduino/ctags` в
`~/Library/Arduino15/packages/builtin/tools/ctags/5.8-arduino11/`):
```bash
arduino-cli compile -b esp32:esp32:esp32doit-devkit-v1 firmware/smartsku_box
arduino-cli upload  -b esp32:esp32:esp32doit-devkit-v1 --board-options UploadSpeed=115200 -p /dev/cu.usbserial-XXXX firmware/smartsku_box
```
На 921600 (скорость по умолчанию) загрузка на нашей плате обрывается — нужен `UploadSpeed=115200`
(в Arduino IDE: Tools → Upload Speed). Открытие Serial-порта перезагружает плату (`box_id` и ноль
сохраняются), а если порт закрыть скриптом (pyserial), плата может остаться в сбросе и замолчать — порт нужно держать
открытым или переподключить USB. Serial Monitor в Arduino IDE так не делает.

**Первый запуск бокса:** `docker compose up -d --build` → прошить → в Serial Monitor дождаться `running as box ...`
→ вставить пустую ячейку, нажать «Установить ноль» на карточке бокса и подтвердить, что она пустая → подождать ~2 с,
не трогая ячейку → положить что-нибудь и убедиться, что `net` растёт (иначе `invertLoad`) → слот
появится на фронте → калибровка с фронта как обычно, только ячейку вынимают и вставляют руками.

### Сценарий калибровки
Через фронт: кнопка «Калибровка» вверху или «Откалибровать» на карточке слота → название, теги, количество →
физическая часть на вкладке «Эмулятор» (вынуть ячейку, насыпать граммы, вставить) → мастер сам покажет,
что калибровка завершена.

Через API (то же самое руками). N штук задаётся при запуске калибровки в бэкенде, M граммов — в эмуляторе при засыпке; бокс считает вес штуки = M / N.
```bash
B=http://localhost:8000/api; E=http://localhost:8001/api; J='Content-Type: application/json'
curl "$B/lockers?free=true"                                   # свободные ячейки
curl -X POST $B/calibrations -H "$J" -d '{"box_id":"<box_id>","locker_id":0,"name":"Болт M3x10","tags":["M3"],"num_of_pieces":20}'
curl -X POST $E/boxes/emu-box-001/lockers/0/pull-out           # вынуть ячейку
curl -X POST $E/cells/cell-0001/grams -H "$J" -d '{"grams":50}'   # насыпал 20 шт., весят 50 г
curl -X POST $E/boxes/emu-box-001/lockers/0/insert -H "$J" -d '{"nfc_id":"cell-0001"}'
curl $E/boxes                                                  # LED/дисплей, которые прислал бэкенд
curl "$B/events?nfc_id=cell-0001"                              # журнал учёта
```

### REST API бэкенда
- `GET /api/boxes`
- `GET /api/lockers?box_id=&free=`
- `POST /api/calibrations`, `GET /api/calibrations?status=`, `DELETE /api/calibrations/{id}` (отменить заявку)
- `GET /api/components?search=&tag=`, `DELETE /api/components/{nfc_id}` — освободить ячейку под другой компонент
- `GET /api/events?box_id=&nfc_id=&limit=`

## Открытые вопросы
- Ноль задаётся только из Serial Monitor и хранится на датчик, а не на ящик. Когда ящиков станет несколько,
  хранить вес каждого ящика по его NFC-метке (лучше на бэкенде, рядом с `piece_weight`) и вычитать его.
- Нужна ли команда обнуления от бэкенда (кнопка на фронте)?
- Отправлять ли боксу `piece_weight` компонента, когда в него вставляют ячейку, откалиброванную в другом боксе?
  Сейчас количество считает бэкенд, дисплей обновляется командой `indicators`, так что это не обязательно.
- В каких сценариях зажигать светодиод (`red`/`green`) — решим позже, пока он не горит.
- Mosquitto без авторизации и TLS — только для локальной сети.
