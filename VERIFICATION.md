# Проверка LaunchCheck — 2026-10-03

Первая локальная версия реализована и проверена. Публичного деплоя и подачи на конкурс не было. Mainnet использовался только для чтения.

**Devnet-цикл завершён:** семь транзакций от создания пула до покупки на DAMM v2 проверены как finalized, без ошибок. Последний прогон — `passed`; цикл выполнен за три запуска с восстановлением после сбоев. [Ссылки и границы доказательства](DEVNET-PROOF.md). Итоговый JSON — `artifacts/devnet-cycle-finalized.json`.

## Выполненные команды

### Подготовка публичного демо

После изменений запуска повторены `npm test` и `npm run build`: **56 passed, 0 failed**, код 0; Vite собрал 30 modules. Проверены отказ runtime guard без `--no-addons`, HOST по умолчанию и для контейнера, невалидные HOST/PORT, доступность health после исчерпания API-квоты.

`docker build -t launchcheck:demo .` завершился с кодом 0. Образ запущен на loopback `127.0.0.1:4186`; главная страница и health вернули 200, Docker health — `healthy`. Реальная инспекция devnet из контейнера вернула `source: live`, `stage: migrated`, `migration.verified: true`. Сравнение с `examples/devnet-before.json` обнаружило четыре ожидаемых изменения состояния. Итог — `artifacts/container-smoke.json`.

Проверка внутри контейнера подтвердила UID 1000 и отсутствие `.env`, `.env.devnet.local`, `.keys`, `artifacts`, wallet/rehearsal scripts. `node --no-addons --import tsx scripts/check-runtime.ts --check-only` завершился с кодом 0. Повторный `npm audit` завершился с кодом **1**: **5 high**, остальные уровни 0; результат — `artifacts/audit-public-demo.json`. Native mitigation не закрывает advisory.

Подготовлены English README, submission draft, demo script и английские ссылки на devnet-транзакции. Два публичных исторических отчёта помещены в `examples/`; приватный devnet environment-файл туда не входит. Публичный деплой, Git-коммит/push и отправка заявки не выполнялись.

За общим reverse proxy прикладной лимит 60 API-запросов в минуту разделяется всеми посетителями с одного socket IP; приложение намеренно не доверяет произвольному `X-Forwarded-For`. Ограничение описано в deployment guide; это предел текущего небольшого демо.

### Предыдущие проверки

`npm run build` завершилась с кодом 0:

```text
vite v7.3.6 building client environment for production...
✓ 30 modules transformed.
✓ built in 1.23s
```

`npm test` завершилась с кодом 0:

```text
# tests 52
# pass 52
# fail 0
# cancelled 0
# skipped 0
```

Тесты проверяют реальные сериализованные SDK-форматы аккаунтов через локальный RPC-стенд, владельцев аккаунтов, сеть, миграцию, точность сумм, комиссии, таймауты, API и импорт отчётов. Локальные HTTP-тесты запущены с разрешённым loopback; обычный sandbox ранее блокировал их соединения с `EACCES`. Это не тесты реальных swaps.

Добавлены проверки ожидания funding (порог и timeout), а также требований к rehearsal snapshots: schema, live, devnet, ожидаемый pool/stage и verified DAMM address. После scoped overrides TOML 4.2.0 и Jayson 5.0.0 повторная установка `npm ci --ignore-scripts --no-audit --no-fund` завершилась с кодом 0. Отдельный runtime-check подтвердил `toml.parse(Buffer)` и ограничение глубины вложенности без RangeError.

После ошибки funded-прогона добавлены проверки сохранения payer между неудачными попытками, записи подписи до отправки, запрета отправки при ошибке сохранения evidence, ограниченных HTTP/JSON-RPC 429 read-retries, таймаута и отсутствия автоматического повтора writes. Direct dependency `bs58@4.0.1` использует уже присутствовавшую транзитивную версию; добавлены её TypeScript-типы. Установка завершилась с кодом 0.

Дополнительно проверены повторная загрузка rehearsal entry script без замены payer, сохранение бюджета при пополнении, учёт failed transaction fee и блокировка следующей записи при неизвестной подписи. Независимое ревью этих правок критических регрессий не нашло.

На публичном снимке фактического пула воспроизведён отказ overshooting ExactIn quote. Исправление использует SDK swap2/PartialFill и проверяет достижение границы до отправки. Добавлены проверки продолжения после двух подтверждённых DBC сделок: другой pool/payer, неподтверждённые или более поздние отправки отклоняются. Перед пропуском сделок реальные receipts перечитываются из сети.

`npm run smoke -- 51behYte9RzbqGKTz1CxMg6Q79GYhZC44YGeMcUDi7cH mainnet-beta` завершилась с кодом 0:

```text
source: live
cluster: mainnet-beta
stage: trading
reserve: 0.000856292
threshold: 9.263132695
```

Отчёт сохранён в `artifacts/smoke-mainnet-beta-51behYte9RzbqGKTz1CxMg6Q79GYhZC44YGeMcUDi7cH.json`. Чтение этого же публичного пула прошло через итоговый интерфейс после перезапуска сервера. Адрес используется как технический пример, а не рекомендация токена.

После обновления зависимостей `npm run smoke -- 2yoLr8GDWacNMbwf88DAiQrxGom59uaP5vXjo9EJ1oCe mainnet-beta` завершилась с кодом 0: `source: live`, `stage: migrated`, reserve `85.000000088`, threshold `85`, `migration.verified: true`, `damm-pool: pass`. Подтверждён DAMM v2 `DjWLb6eAJ6reUERuaNszD8RSdx2qqwDqdB31ET3DxWeq`; `position-locks` остаётся unknown. Отчёт — `artifacts/smoke-mainnet-beta-2yoLr8GDWacNMbwf88DAiQrxGom59uaP5vXjo9EJ1oCe.json`. Официальный [Meteora API](https://damm-v2.datapi.meteora.ag/pools/DjWLb6eAJ6reUERuaNszD8RSdx2qqwDqdB31ET3DxWeq) также вернул этот пул. Это проверяет чтение уже выполненной миграции, не наш launch/swap-цикл.

Та же smoke-команда повторена после добавления RPC transport: exit 0, `live`, `migrated`, `damm-pool: pass`, `position-locks: unknown`. Локальный сервер перезапущен с обновлённым transport.

## Браузер

- Учебный отчёт помечен SAMPLE; суммы 6.42 SOL и 10 SOL показаны без повторного деления на decimals.
- Экспорт JSON создал файл; импорт экспортированного baseline принят.
- Сравнение trading → migration-ready нашло ровно два изменения состояния: резерв и стадию.
- Неверный адрес показал ошибку и убрал предыдущий пример; ошибка не подменяется данными образца.
- Реальное чтение показано как LIVE READ с mainnet, временем, slot и ссылками на аккаунты.
- Проверены ширины 390 и 1280 px: горизонтального переполнения документа нет. После мобильной проверки размер окна восстановлен.
- Ошибок и предупреждений в консоли браузера при итоговой проверке не было.
- Снимки интерфейса: `artifacts/launchcheck-desktop.png`, `artifacts/launchcheck-mobile.png`.
- После обновления зависимостей мигрировавший mainnet-пул также прочитан через браузер: LIVE READ, Migrated, ожидаемый DAMM address и pass проверки DAMM. Консоль без ошибок/предупреждений; снимок `artifacts/launchcheck-migrated.png`.

## История devnet-прогонов и ограничения

Первый `npx tsx scripts/rehearsal.ts` завершился с кодом 1: devnet faucet ответил `Internal error` на этапе funding. Сеть, программы и migration config прочитаны, но launch/swap-транзакций не было. Артефакт: `artifacts/rehearsal-2026-10-03T09-25-14-793Z.json`. На этом этапе полный цикл ещё не был подтверждён.

Повторный `npm run rehearsal` после обновления зависимостей также завершился с кодом 1 на этапе funding; launch/swap-транзакций не было. Артефакт — `artifacts/rehearsal-2026-10-03T10-19-36-954Z.json`.

Ручное пополнение одноразового payer подтверждено: 4.999029186 devnet SOL. Создание DBC config `CQ3evLP1pRuBcmBNXQC3QDCqJQkVfmUZDcgddCUYnV98` подтверждено подписью `58cWWH5xN2V5EpTuoQRWRZqxDj6vxWG22ApRGd8YEbj7EsbNvULTm55fANDRnRwWTpzdYjkfvTzQFcoaer5QufXT`. Подготовка `create-pool` завершилась RPC `429`; процесс потерял эфемерный ключ. Баланс старого payer при проверке: 4.993045106 test SOL; этот адрес больше не использовать. Артефакт — `artifacts/rehearsal-2026-10-03T10-27-53-091Z.json`.

Следующий funded-прогон подтвердил `create-config` и `create-pool`: `artifacts/rehearsal-2026-10-03T10-49-47-438Z.json`. На последующей проверке процесс отсутствовал, evidence оставался running на create-pool; причина завершения не установлена. Эфемерный ключ payer `Ci3s…` утрачен; остаток 0.972453466 test SOL недоступен. Обе транзакции finalized без ошибок. DBC pool `4KSYjPvfeQghULdKBD7r1T2naxCvLtknr3QET3VcuaGS` существует; ожидаемый DAMM отсутствует. Проверка сохранена в `artifacts/funded-session-check.json`.

Live smoke этого devnet-пула прошёл (exit 0): trading, reserve 0, threshold 0.1. Отчёт — `artifacts/smoke-devnet-4KSYjPvfeQghULdKBD7r1T2naxCvLtknr3QET3VcuaGS.json`. Отдельная read-only resume-проверка реальных аккаунтов прошла: hasSwap 0, supply 1000000000000. Это не результат обменов или миграции.

Тот же пул прочитан через интерфейс после перезапуска сервера: LIVE READ, devnet, Curve trading, резерв 0 SOL, порог 0.1 SOL. В консоли браузера ошибок/предупреждений не было. Снимок — `artifacts/launchcheck-devnet-created.png`.

После потери процесса добавлен `devnet:wallet`: локальный `.env.devnet.local` создаётся эксклюзивно, считывается обратно до вывода адреса, исключён из Git. Два запуска CLI в отдельных процессах вернули одинаковый публичный адрес. Тесты проверяют восстановление, запрет перезаписи и отказ на повреждённом/отсутствующем ключе. Session и одноразовый rehearsal больше не используют случайный эфемерный payer. Resume разрешён только для проверенного пустого тестового пула; исторические create-транзакции не выдаются за новые.

Faucet для нового постоянного devnet-кошелька вернул RPC -32603; на момент запроса баланс был 0. Артефакт — `artifacts/persistent-payer-funding.json`. Затем пользователь профинансировал кошелёк.

Прогон `13-17-17-617Z` выполнил DBC buy и sell, после чего старый ExactIn graduation quote завершился `Insufficient Liquidity` до отправки. В этом старом evidence stage остался dbc-sell, потому что stage обновлялся слишком поздно; теперь он устанавливается до расчёта котировки. Снимок pool-created сохранён. Причина устранена через PartialFill, воспроизведение покрыто тестом.

Прогон `artifacts/rehearsal-2026-10-03T13-28-05-520Z.json` повторно проверил receipts двух предыдущих сделок, достиг порога, мигрировал и выполнил DAMM buy: `End-to-end: PASSED`. Три live/devnet snapshots одного пула: trading (reserve 0.016820843), migration-ready (0.100000001), migrated (ожидаемый DAMM PDA verified). Фактическая покупка DAMM дала 1960551642 raw base units при decimals 6. При отдельной проверке все семь транзакций, включая создание, были finalized без ошибок. Баланс постоянного payer при этой проверке — 1.879906733 test SOL. Сравнение snapshots нашло четыре изменения состояния, конфигурация не изменилась.

Итоговый devnet-пул прочитан в браузере: LIVE READ, Migrated, 100% прогресса, DAMM pool найден, DAMM check pass. Консоль без ошибок/предупреждений. Снимок — `artifacts/launchcheck-devnet-migrated.png`. Тестовая сессия завершена командой exit; кошелёк остаётся в локальном environment-файле.

Итоговый `npm audit` завершился с кодом 1: **5 high, 0 moderate, 0 critical**, все записи связаны с `bigint-buffer`. JSON — `artifacts/audit-after-security.json`; результаты разбора — [SECURITY.md](SECURITY.md). Аудит остаётся незакрытым.

Фактические владельцы NFT-позиций, LP-locks и vesting-аккаунты не проверяются. В отчёте отображается настроенное распределение, а соответствующая проверка остаётся unknown. Наличие DAMM-аккаунта не доказывает, что в пуле сейчас разрешена торговля. Альтернативные DAMM migration configs и другие семейства токенов не входят в подтверждённый объём.

Артефакты, зависимости и сборка исключены из Git. Коммитов и push в рамках этой работы не было.
