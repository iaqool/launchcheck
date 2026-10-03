# LaunchCheck: подтверждённый devnet-цикл

3 октября 2026 года все семь транзакций ниже проверены в состоянии **finalized**, без ошибок. Цикл собран из трёх последовательных прогонов: создание пула, обмены DBC, затем исправленное продолжение до DAMM v2. Это не один непрерывный запуск.

- DBC pool: [4KSYjPvfeQghULdKBD7r1T2naxCvLtknr3QET3VcuaGS](https://solscan.io/account/4KSYjPvfeQghULdKBD7r1T2naxCvLtknr3QET3VcuaGS?cluster=devnet)
- DAMM v2 pool: [BWc9k9ggRS1d4KSU9DkokTU16nvYUCH9B7MgMKxVRr5j](https://solscan.io/account/BWc9k9ggRS1d4KSU9DkokTU16nvYUCH9B7MgMKxVRr5j?cluster=devnet)
- Тестовая конфигурация: SPL / WSOL, supply 1 000 000, decimals 6, DBC fee 1%, migration threshold 0.1 SOL.
- После покупки за 0.001 devnet SOL на DAMM фактический баланс вырос на 1 960.551642 LCTEST (1 960 551 642 raw units).

| Шаг | Подтверждённая транзакция | Finalized slot |
|---|---|---|
| Создание DBC config | [Открыть транзакцию](https://solscan.io/tx/3GB8Y6HZ8uiSrMMP6xMmAiAGHi3BshaU1zskmuCRSzUwES7UCT43AXm8RkMBCkEaTcZ3WiJoPfXTUcwy8oJvB2eA?cluster=devnet) | 506971350 |
| Создание DBC pool | [Открыть транзакцию](https://solscan.io/tx/3Ny4aFxiptvF9GoGHWQ4nSrd4esFE2GmFBsy64zDs1CJxq7Z8vLgmWazGKGxGZVNpmbSsHrLYFGdCdaFu6eba4gT?cluster=devnet) | 506971382 |
| Покупка на DBC | [Открыть транзакцию](https://solscan.io/tx/3Ug3ogijf4yt5o5Majw7jkYhAgrzCnYswCZCajjGLtegqY4xsey69PcH9nbsFrzUaRdSV47eBEdjRropceYPACMJ?cluster=devnet) | 507009281 |
| Продажа на DBC | [Открыть транзакцию](https://solscan.io/tx/3324WQnidBZ6SX18YACPz8Mxv9ZWSLr4PY861VTmEsx36d1gxfAyK9o7FZkJKRES4kgKFZRiGE6YD6anNdc3GToT?cluster=devnet) | 507009312 |
| Достижение порога | [Открыть транзакцию](https://solscan.io/tx/3aiUrdNusEzFxJ6DuymZfxLN13YkqBn7UTPxG3d45ugfYjVnsDvga6Pav3BZuPxjMRtnQfuuWkXvkHBkS1fN7JU4?cluster=devnet) | 507010916 |
| Миграция в DAMM v2 | [Открыть транзакцию](https://solscan.io/tx/4HgFs4BRs4q1sMrRgo9F4oECpbsQoaa3YkCwMmLsSq6N5ahcJrvqgTDAcM2UQKezcyt2gwd1vUL8CR2Bg9Mtr6oH?cluster=devnet) | 507010948 |
| Покупка на DAMM v2 | [Открыть транзакцию](https://solscan.io/tx/4gem5jewxCNDsEFEA6p3o2VhqiUj9cBwnrwb3K4V7dRe6WUo382hXWHra9wew8vqV8ws7vph5u2YVQoKVW643VF7?cluster=devnet) | 507010989 |

## Сохранённые доказательства

- Итоговая независимая проверка статусов: `artifacts/devnet-cycle-finalized.json`.
- Прогон 1: `artifacts/rehearsal-2026-10-03T10-49-47-438Z.json`.
- Прогон 2: `artifacts/rehearsal-2026-10-03T13-17-17-617Z.json`.
- Прогон 3: `artifacts/rehearsal-2026-10-03T13-28-05-520Z.json`.
- Последний прогон имеет `status: passed` и ссылки на подтверждённые buy/sell предыдущего прогона.
- Снимки `inspection-2026-10-03T13-28-05-520Z-{resume-start,threshold-reached,migration-verified}.json` показывают `trading → migration-ready → migrated`.
- Резерв до достижения порога: 0.016820843 SOL; после: 0.100000001 SOL. DAMM address совпадает с вычисленным PDA, `migration.verified: true`.
- Сравнение до/после выявляет четыре изменения состояния: резерв, стадия, DAMM address и подтверждение миграции.

## Как показать результат

Запустите `npm run build`, затем `npm start`. Откройте локальный интерфейс, выберите Devnet и введите DBC pool выше. Отчёт должен показывать LIVE READ / Migrated. Импортируйте resume-start JSON как baseline и сравните его с текущим чтением.

## Границы результата

Ключи двух ранних эфемерных payer были утрачены при завершении процессов; доступ к их остаткам не восстановлен. Финальные сделки выполнены отдельным payer, сохраняемым в локальном environment-файле. Сырые evidence-файлы сохраняют исходные статусы running/failed предыдущих попыток; их успешные транзакции отдельно проверены в сети.

Это тестовая devnet-конфигурация. Mainnet-записей, публичного деплоя и подачи на конкурс не было. Ownership/locks LP NFT и vesting остаются непроверенными. Оставшиеся зависимости с high-уязвимостью описаны в SECURITY.md.
