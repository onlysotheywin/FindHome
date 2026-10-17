# Серверная часть REST API

## Технологии
Node.js 20+, Express, SQLite, bcryptjs, JWT, Zod, Helmet, rate limiting.

## Запуск
1. Установите Node.js 20 или новее.
2. В терминале перейдите в папку `server`.
3. Выполните `npm install`.
4. Скопируйте `.env.example` в `.env`.
5. Установите `JWT_SECRET` в `.env` на случайную секретную строку длиной от 32 символов.
6. Выполните `npm start`. SQLite-файл и таблицы создадутся автоматически.

Проверка: `GET http://localhost:3000/api/health`.

## Регистрация и роль администратора
`POST /api/auth/register` создаёт только пользователя с ролью `participant`; клиент не может назначить себе администратора. Первого администратора создайте вручную доверенной административной командой в SQLite или отдельным защищённым скриптом, например:
```sql
UPDATE users SET role = 'admin' WHERE email = 'organizer@example.com';
```
Не открывайте возможность менять роль через публичный API.

## Основные маршруты
- `POST /api/auth/register` — регистрация
- `POST /api/auth/login` — вход, выдача JWT
- `GET /api/auth/me` — текущий пользователь (Bearer)
- `GET /api/competitions` — список соревнований
- `POST /api/competitions` — создать соревнование и три этапа (admin)
- `GET /api/competitions/:id/stages` — этапы соревнования
- `PATCH /api/stages/:id/status` — перевод этапа `planned → open → closed` (admin)
- `GET /api/participants` — участники, поиск `?search=...`, фильтр `?specialty=...`, сортировка `?sort=name_asc|name_desc|points_asc|points_desc` (Bearer)
- `POST /api/participants` — добавить участника (admin)
- `PATCH /api/participants/:id` — изменить участника (admin)
- `DELETE /api/participants/:id` — удалить участника (admin)
- `PUT /api/stages/:stageId/results` — добавить/изменить результат открытого этапа (admin)
- `GET /api/competitions/:id/ranking` — рейтинг и признак прохода
- `PUT /api/competitions/:id/qualification` — задать число проходных мест (admin)

## Формат ошибки
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Проверьте входные данные",
    "details": [
      { "field": "email", "message": "Invalid email" }
    ]
  }
}
```
Используются HTTP 400, 401, 403, 404, 409, 422 и 500 по ситуации. Баллы и итоговые суммы вычисляются на сервере.

## Важные замечания для сдачи
- Это стартовая учебная реализация. Перед production добавьте тесты, миграции, резервное копирование, журнал аудита и управление секретами.
- Подключите формы фронтенда к API: текущие HTML-формы остаются демонстрационными, они не отправляют данные на сервер.
- Настройте CORS_ORIGIN под адрес, с которого запущен фронтенд.
- Добавьте Postman collection и тесты для успешных и ошибочных сценариев.
