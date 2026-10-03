# Состояние зависимостей — 2026-10-03

После точечных обновлений `npm audit` сообщает **5 high, 0 moderate, 0 critical** и завершается с кодом 1. Это не чистый аудит. Пять записей относятся к одной исходной уязвимости `bigint-buffer` и пакетам, которые от него зависят. До обновления было 14 записей (7 high, 7 moderate), соответствовавших пяти исходным advisory.

Полные результаты: `artifacts/audit-current.json` до изменений и `artifacts/audit-after-security.json` после. Артефакты не включены в Git.

## Что изменено

В `package.json` зафиксированы два scoped override. Версии Meteora SDK сохранены.

| Цепочка | Итоговая версия | Основание совместимости |
|---|---|---|
| `@coral-xyz/anchor → toml` | 4.2.0 | CommonJS `parse(Buffer)` сохранён; Anchor использует именно этот вызов. Исправлены prototype pollution и неограниченная рекурсия. |
| `@solana/web3.js → jayson` | 5.0.0 | Сохранён `jayson/lib/client/browser`, его конструктор и callback API. Удалены зависимости от уязвимых `uuid` и `stream-json`. |

Оба обновления требуют Node.js 20 или новее; проект проверяется на Node.js 22. Jayson обновлён через major-границу только после проверки API, который вызывает установленный web3.js. Совместимость остальных возможностей Jayson не заявляется.

Проверены повторная установка `npm ci --ignore-scripts --no-audit --no-fund`, TOML parsing из Buffer, отклонение глубоко вложенного TOML без RangeError, локальные RPC-тесты и чтение реального мигрировавшего mainnet-пула. Lifecycle install-скрипты при этой установке не запускались; bigint-buffer сообщил о переходе на штатную JavaScript-реализацию. Обычный `npm ci` может собрать нативную реализацию при наличии инструментов сборки.

## Оставшаяся уязвимость

Vercel API использует тот же runtime guard до динамической загрузки обработчика. В настройках production и preview задан `NODE_OPTIONS=--no-addons --experimental-require-module`; без запрета native addons API отказывает. Второй флаг включает [документированную Vercel совместимость CommonJS → ESM](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration#experimental-nodejs-require-of-es-module) для `rpc-websockets → uuid`; он не разрешает нативные addons. Команда сборки Vercel очищает `NODE_OPTIONS` только для процесса Vite/Rollup, чей parser требует native addon. Это не меняет runtime-переменную Function. Защитные HTTP-заголовки сохранены и для статических страниц на CDN; allowlist `.vercelignore` исключает environment-файлы, ключи и локальные артефакты из загрузки.

Для публичного read-only демо `npm start` запускает Node с `--no-addons`. До импорта сервера `scripts/check-runtime.ts` проверяет, что `process.dlopen` отвергает загрузку с `ERR_DLOPEN_DISABLED`, и проверяет JavaScript-конверсию `bigint-buffer`. Без флага процесс завершается до открытия порта. Это блокирует в том числе заранее собранные native addons; одного `npm ci --ignore-scripts` для такой гарантии было бы недостаточно. Docker использует этот же entrypoint, установку без lifecycle scripts и пользователя `node`.

Тест `tests/security-bigint.test.ts` подтверждает успешную проверку с запретом addons и отказ без него. `npm audit` остаётся незакрытым: уязвимость зависимости не исправлена. Команды разработки и devnet rehearsal отдельно не получают этот запрет; они не предназначены для публичного HTTP-развёртывания. Документация Node: [--no-addons](https://nodejs.org/docs/latest-v22.x/api/cli.html#--no-addons).

[GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) описывает переполнение буфера в `bigint-buffer.toBigIntLE()`. Исправленной версии того же пакета в advisory нет. Принудительная замена на случайный fork или изменение SDK не применялись.

Проверенный путь: `src/core/inspect.ts` вызывает `unpackMint`; SPL MintLayout декодирует `supply` как u64; `@solana/buffer-layout-utils` передаёт в `toBigIntLE` буфер фиксированной длины 8 байт. Перед декодированием проверяется размер mint-аккаунта. В rehearsal вызовы `getMint` и `getAccount` используют такие же фиксированные u64 layout.

На этих путях не найдено входа, позволяющего пользователю задавать произвольную длину буфера. Это ограниченное исследование достижимости, а не доказательство безопасности всех путей SDK. Публичное демо использует описанный выше запрет нативных addons; статус production-ready не присваивается.

## Источники и границы проверки

- [TOML 4.2.0: реализация parse](https://github.com/BinaryMuse/toml-node/blob/v4.2.0/index.js), [advisory рекурсии](https://github.com/advisories/GHSA-82x6-q7mm-w9cf), [advisory prototype pollution](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j).
- [Jayson 5: используемый browser client](https://github.com/tedeh/jayson/blob/v5.0.0/lib/client/browser/index.js), [список зависимостей](https://github.com/tedeh/jayson/blob/v5.0.0/package.json).
- [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq) касается v3/v5/v6 с переданным буфером; прежний Jayson вызывал v4 без буфера.
- [stream-json advisory](https://github.com/advisories/GHSA-528h-pc64-c93x) касается фильтров вложенных данных. LaunchCheck не использует эти фильтры.

TOML ранее импортировался Anchor, но `parse` исполняется при обращении к `anchor.workspace`. Приложение и rehearsal этот API не вызывают. Обновление устраняет уязвимый пакет из дерева, не означает обнаруженную эксплуатацию через наш HTTP API.

Инспектор остаётся read-only. Транзакции разрешены только отдельному devnet-скрипту с проверкой genesis. Ключи и RPC credentials не включаются в отчёты. Этот документ описывает проверенный набор зависимостей, а не полный аудит проекта.
