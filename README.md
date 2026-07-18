# 💳 Crypto Payment Service

## 💡 Что делает этот продукт

**Это платёжный шлюз для приёма криптовалюты** — готовая инфраструктура, которая позволяет любому онлайн-бизнесу принимать платежи в криптовалюте так же просто, как оплату картой: клиент переводит деньги, система сама фиксирует поступление, уведомляет ваш сервис и мгновенно перемещает средства на защищённые счета компании.

По сути это «собственный Stripe для крипты», работающий под полным контролем владельца — **без комиссии посредника и без передачи денег третьей стороне**.

---

## 🎯 Какую проблему он решает

Любая компания, которая хочет принимать криптоплатежи, упирается в одну из двух стен: платить процент внешнему провайдеру или строить собственную инфраструктуру годами. Этот продукт убирает обе.

**Боль №1. Комиссия посредника съедает маржу**

- Внешние криптопроцессинги удерживают процент с каждой транзакции — на объёме это прямой отток прибыли.
- Здесь весь оборот проходит через инфраструктуру компании: платёжный поток остаётся внутри бизнеса.

**Боль №2. Деньги клиента можно потерять или не заметить**

- Криптоперевод не приходит «на счёт» — его нужно самому увидеть в сети. Ручная сверка означает задержки, жалобы и потерянные платежи.
- Система следит за поступлениями непрерывно и в реальном времени, фиксируя каждый платёж вплоть до подтверждения сетью.

**Боль №3. Средства размазаны по тысячам адресов**

- Каждый клиент платит на свой отдельный адрес. Без автоматизации бухгалтерия получает «пыль» на тысячах кошельков, которую невозможно ни посчитать, ни использовать.
- Продукт автоматически собирает все поступления на казначейские счета компании — сразу после платежа, без участия человека.

**Боль №4. Комиссии сети и «мёртвые» переводы**

- Чтобы отправить деньги с адреса клиента, на нём должна быть комиссия сети — иначе перевод физически невозможен, и средства зависают.
- Система сама рассчитывает и заранее доставляет нужную комиссию на каждый адрес, а в сети TRON — арендует ресурс вместо прямой оплаты, что заметно дешевле стандартного сжигания монет.

**Боль №5. Зависимость от одной сети**

- Клиенты платят там, где им удобно. Поддержка только одной сети = потерянные платежи.
- Поддерживается **10 блокчейн-сетей** (Bitcoin, Ethereum, TRON, BNB Chain, Polygon, Base, Arbitrum, Optimism, Avalanche, Fantom) и **4 валюты**, включая USDT — самый популярный стейблкоин для расчётов.

---

## ⚙️ Как это работает (на пальцах)

Система работает как автоматический кассир, который круглосуточно, без выходных, дежурит у всех платёжных «касс» одновременно.

**Главный сценарий — от платежа клиента до денег в казне:**

1. **Выдача реквизитов.** Ваша платформа запрашивает у системы платёжный адрес для клиента. Система проверяет корректность реквизитов и ставит адрес под наблюдение.
2. **Ожидание платежа.** С этого момента адрес отслеживается непрерывно — система видит новые операции в сети практически в момент их появления, а не по расписанию.
3. **Фиксация поступления.** Как только клиент перевёл деньги, платёж распознаётся, проверяется на минимальную сумму и подтверждается сетью. Мелкий «мусорный» трафик отсекается автоматически.
4. **Мгновенное уведомление.** Ваша основная платформа сразу получает сигнал о поступлении — заказ можно закрывать, баланс пополнять, товар отгружать. Клиент не ждёт.
5. **Автоматический сбор средств.** Не дожидаясь ручных действий, система переводит поступившие деньги с адреса клиента на казначейские счета компании — **распределяя сумму между основным и резервным счётом в заданной вами пропорции**. Деньги не лежат без движения и не остаются на «горячих» адресах.
6. **Самовосстановление.** Если перевод не прошёл из-за нехватки комиссии — система сама пополняет её и повторяет операцию. Если что-то пошло не так — команда немедленно получает отчёт об инциденте, а не узнаёт о проблеме от клиента.

**Что это даёт бизнесу:**

- 🔓 **Полный контроль над деньгами** — средства проходят только через инфраструктуру компании, без хранения у посредника.
- ⚡ **Платежи зачисляются без участия человека** — от перевода клиента до денег в казне не требуется ни одного ручного действия.
- 🔐 **Ключи доступа к средствам хранятся в зашифрованном виде**, доступ к системе ограничен по ключу и списку разрешённых адресов.
- 📈 **Готовность к росту** — сеть или валюта добавляется как модуль, без переписывания системы; нагрузка масштабируется горизонтально.
- 🧩 **Встраивается в существующий бизнес** — работает как отдельный сервис, подключается к вашей платформе за считанные интеграционные точки.

---

# 🏗 Техническая архитектура

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

```mermaid
  graph TB
    %% External Actors
    USER[👤 User/Client]
    BLOCKCHAIN[🔗 Blockchain APIs]
    DATABASE[🗄️ Database]
    REDIS[📊 Redis]

    %% Presentation Layer (Adapters)
    subgraph PRESENTATION["🎯 Presentation Layer"]
        CONTROLLERS[Controllers<br/>HTTP Endpoints]
        MIDDLEWARES[Middlewares<br/>Request Processing]
        PIPES[Pipes<br/>Data Validation]
        PRESENTATION_DTO[DTO<br/>API Models]
    end

    %% Application Layer (Use Cases)
    subgraph APPLICATION["⚙️ Application Layer"]
        APP_INTERFACES[Interfaces<br/>Contracts]
        AUTO_WITHDRAW[Auto-Withdraw<br/>Use Cases]
        MANAGE_WALLETS[Manage-Wallets<br/>Use Cases]
        MONITOR_BLOCKCHAIN[Monitor-Blockchain<br/>Use Cases]
    end

    %% Domain Layer (Business Logic)
    subgraph DOMAIN["💎 Domain Layer"]
        ENTITIES[Entities<br/>Business Objects]
        REPOSITORIES[Repository Interfaces<br/>Data Contracts]
    end

    %% Common Layer (Shared)
    subgraph COMMON["🔧 Common Layer"]
        CONSTANTS[Constants]
        DECORATORS[Decorators]
        COMMON_DTO[DTO]
        ENUMS[Enums]
        GUARDS[Guards]
        INTERFACES[Interfaces]
        UTILS[Utils]
    end

    %% Infrastructure Layer (Adapters)
    subgraph INFRASTRUCTURE["🏗️ Infrastructure Layer"]
        BLOCKCHAIN_IMPL[Blockchain Services<br/>External API Clients]
        CONFIG[Configuration<br/>Environment Setup]
        DATABASE_IMPL[Database Implementation<br/>ORM Models]
        MODULES[NestJS Modules<br/>DI Container]
        REDIS_IMPL[Redis Implementation<br/>Caching & Queues]
    end

    %% External connections
    USER --> CONTROLLERS
    CONTROLLERS --> USER

    %% Presentation to Application
    CONTROLLERS --> AUTO_WITHDRAW
    CONTROLLERS --> MANAGE_WALLETS
    CONTROLLERS --> MONITOR_BLOCKCHAIN

    %% Presentation internal
    CONTROLLERS --> MIDDLEWARES
    CONTROLLERS --> PIPES
    CONTROLLERS --> PRESENTATION_DTO

    %% Application to Domain
    AUTO_WITHDRAW --> ENTITIES
    MANAGE_WALLETS --> ENTITIES
    MONITOR_BLOCKCHAIN --> ENTITIES

    AUTO_WITHDRAW --> REPOSITORIES
    MANAGE_WALLETS --> REPOSITORIES
    MONITOR_BLOCKCHAIN --> REPOSITORIES

    %% Application internal
    AUTO_WITHDRAW --> APP_INTERFACES
    MANAGE_WALLETS --> APP_INTERFACES
    MONITOR_BLOCKCHAIN --> APP_INTERFACES

    %% Infrastructure implements Domain contracts
    DATABASE_IMPL --> REPOSITORIES
    BLOCKCHAIN_IMPL --> REPOSITORIES
    REDIS_IMPL --> REPOSITORIES

    %% Infrastructure to External
    BLOCKCHAIN_IMPL --> BLOCKCHAIN
    DATABASE_IMPL --> DATABASE
    REDIS_IMPL --> REDIS

    %% Common layer dependencies (used by all layers)
    PRESENTATION --> COMMON
    APPLICATION --> COMMON
    DOMAIN --> COMMON
    INFRASTRUCTURE --> COMMON

    %% Infrastructure modules coordinate everything
    MODULES --> INFRASTRUCTURE
    MODULES --> APPLICATION
    MODULES --> PRESENTATION
    CONFIG --> MODULES

    %% Styling
    classDef domainStyle fill:#e1f5fe,stroke:#01579b,stroke-width:3px
    classDef applicationStyle fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef infrastructureStyle fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef presentationStyle fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef commonStyle fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    classDef externalStyle fill:#ffebee,stroke:#c62828,stroke-width:2px

    class DOMAIN domainStyle
    class APPLICATION applicationStyle
    class INFRASTRUCTURE infrastructureStyle
    class PRESENTATION presentationStyle
    class COMMON commonStyle
    class USER,BLOCKCHAIN,DATABASE,REDIS externalStyle
```
