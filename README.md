<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

# 🌈 Структура проекта

_Реализовано с помощью **Clean Architecture** и **Hexagonal Pattern**_

---

## 🗂 1. `application/`

> **Назначение:**  
> _Слой бизнес-логики (Application Layer). Здесь оформляются сценарии использования (use cases), которые координируют работу между доменом и инфраструктурой._

### 📁 Содержимое:

- #### `interfaces/`

  - **Что это:** Интерфейсы для сценариев использования, сервисов, портов и т. д.
  - **Пример:**
    - `IWithdrawService`
    - `IWalletManager`

- #### `usecases/`
  - **Что это:** Реализация бизнес-сценариев (use cases).
  - 📂 **Подпапки:**
    1. **`auto-withdraw/`**
       - _Логика автоматического вывода средств:_
         - Автоматизация переводов
         - Проверка лимитов и т. д.
    2. **`manage-wallets/`**
       - _Сценарии управления кошельками:_
         - Создание кошелька
         - Удаление кошелька
         - Обновление кошелька
         - Получение информации о кошельках
    3. **`monitor-blockchain/`**
       - _Сценарии мониторинга блокчейна:_
         - Отслеживание входящих транзакций
         - Мониторинг подтверждений
         - И другие задачи, связанные с реакцией на события блокчейна

---

## 🛠 2. `common/`

> **Назначение:**  
> _Общие компоненты, используемые во всём проекте. Это слой переиспользуемых сущностей, утилит и вспомогательных конструкций._

### 📁 Содержимое:

- #### `constants/`

  - **Константы:** Magic numbers, строки ошибок, ключи конфигурации и т. д.

- #### `decorators/`

  - **Кастомные декораторы:**
    - Для валидации
    - Для авторизации
    - Для логирования

- #### `dto/`

  - **Data Transfer Objects (DTO):** Структуры, которые описывают, как данные передаются между слоями (например, запросы и ответы API).

- #### `enums/`

  - **Перечисления:** Статусы, типы, роли и другие перечисления, используемые по всему проекту.

- #### `guards/`

  - **Guard’ы для NestJS:**
    - Проверка авторизации
    - Проверка прав доступа

- #### `interfaces/`

  - **Общие интерфейсы:**
    - Не привязаны к конкретному слою.
    - Например: `ICacheService`, `ILogger` и т. д.

- #### `utils/`
  - **Утилитарные функции и хелперы:**
    - Форматирование данных
    - Преобразование структур
    - Логгирование
    - Прочие мелкие вспомогательные методы

---

## 🏛 3. `domain/`

> **Назначение:**  
> _Доменная логика (Domain Layer). Здесь описываются основные бизнес‑сущности и их поведение, а также абстракции для работы с хранилищами данных._

### 📁 Содержимое:

- #### `entities/`

  - **Доменные сущности:**
    - Классы, описывающие бизнес‑логику и свойства объектов.
    - Примеры:
      - `User`
      - `Wallet`
      - `Transaction`

- #### `repositories/`
  - **Абстракции (интерфейсы) для репозиториев:**
    - Определяют методы доступа к даданным.
    - Примеры:
      - `IUserRepository`
      - `IWalletRepository`

---

## 🌐 4. `infrastructure/`

> **Назначение:**  
> _Инфраструктурный слой (Infrastructure Layer). Здесь реализуются детали взаимодействия с внешними сервисами, базами данных, блокчейнами и другими внешними компонентами._

### 📁 Содержимое:

- #### `blockchain/`

  - **Логика работы с блокчейнами:**
    - Сервисы мониторинга (слушатели событий)
    - Взаимодействие с API Tron, Ethereum и прочих сетей

- #### `config/`

  - **Конфигурационные файлы и сервисы:**
    - Загрузка и валидация переменных окружения
    - Настройка модулей
    - Файлы `.env`, `.json` и прочие конфиги

- #### `database/`

  - **Реализация доступа к БД:**
    - ORM‑модели (например, TypeORM/Sequelize)
    - Миграции
    - Сервисы работы с базой данных (CRUD‑операции)

- #### `modules/`

  - **Инфраструктурные модули NestJS:**
    - Интеграция сторонних библиотек
    - Регистрация провайдеров
    - Глобальные и локальные модули, относящиеся к внешним сервисам

- #### `redis/`
  - **Логика работы с Redis:**
    - Кэширование
    - Pub/Sub
    - Очереди задач

---

## 🎨 5. `presentation/`

> **Назначение:**  
> _Слой представления (Presentation Layer). Здесь происходит взаимодействие с внешним миром_—_обработка HTTP‑запросов, валидация, сериализация. Именно здесь «включаются» сценарии использования (use cases) из слоя `application/`._

### 📁 Содержимое:

- #### `controllers/`

  - **Контроллеры NestJS:**
    - Обработчики HTTP‑запросов
    - Определяют REST‑эндпоинты API

- #### `dto/`

  - **DTO, специфичные для слоя представления:**
    - Структуры запросов/ответов, передаваемые клиенту/серверу
    - Валидируемые и аннотированные классы для входящих данных

- #### `middlewares/`

  - **Middleware NestJS:**
    - Промежуточная обработка запросов
    - Примеры:
      - Логирование
      - CORS
      - Rate limiting

- #### `pipes/`
  - **Pipes NestJS:**
    - Валидация и трансформация входящих данных
    - Примеры: преобразование строковых параметров в числа, проверка DTO

---
