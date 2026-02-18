# Profissao Laser API

Backend API for an e-learning platform with course management, payment processing via Stripe, and user authentication. Built with Fastify and TypeScript.

## Tech Stack

- **Runtime:** Node.js 22
- **Framework:** Fastify 5
- **Language:** TypeScript
- **Database:** PostgreSQL (Supabase)
- **Payments:** Stripe
- **Validation:** Zod
- **Linter/Formatter:** Biome
- **API Docs:** Scalar (OpenAPI 3.0)

## Features

- Course management with modules and lessons (including video support)
- Stripe integration for products, subscriptions, and coupons
- Multi-role authentication (Admin, Staff, Customer)
- Free and paid lesson access control
- Monthly, yearly, and one-time pricing models
- Coupon/discount system
- Purchase and sales tracking
- Interactive API documentation

## Getting Started

### Prerequisites

- Node.js 22+
- npm
- Supabase project
- Stripe account

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file in the root directory:

```env
JWT_SECRET=
SUPABASE_URL=
SUPABASE_ANON_KEY=
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
```

### Running

```bash
# Development (with auto-reload)
npm run dev

# Build for production
npm run build

# Start production server
npm run start

# Lint & format
npm run lint
```

The server starts at `http://localhost:3333`. API docs are available at `http://localhost:3333/docs`.

### Docker

```bash
docker build -t profissao-laser-api .
docker run -p 3333:3333 --env-file .env profissao-laser-api
```

## API Endpoints

### Authentication

| Method | Route                | Description             |
|--------|----------------------|-------------------------|
| POST   | `/register/customer` | Register new student    |
| POST   | `/login/customer`    | Student login           |
| POST   | `/register/user`     | Register admin/staff    |
| POST   | `/login/user`        | Admin/staff login       |

### Products

| Method | Route          | Auth | Description              |
|--------|----------------|------|--------------------------|
| GET    | `/products`    | No   | List all active products |
| POST   | `/product`     | Yes  | Create product           |
| DELETE | `/product/:id` | Yes  | Archive product          |

### Courses

| Method | Route           | Auth | Description                      |
|--------|-----------------|------|----------------------------------|
| GET    | `/course/:slug` | Yes  | Get course with modules & lessons|

### Modules

| Method | Route                 | Auth | Description          |
|--------|-----------------------|------|----------------------|
| GET    | `/module/:productId`  | Yes  | List modules         |
| POST   | `/module`             | Yes  | Create module        |
| PUT    | `/module/:id`         | Yes  | Update module        |
| DELETE | `/module/:id`         | Yes  | Delete module        |

### Lessons

| Method | Route                       | Auth | Description      |
|--------|-----------------------------|------|------------------|
| GET    | `/module/:moduleId/lessons` | Yes  | List lessons     |
| POST   | `/lesson`                   | Yes  | Create lesson    |
| PUT    | `/lesson/:id`               | Yes  | Update lesson    |
| DELETE | `/lesson/:id`               | Yes  | Delete lesson    |

### Coupons

| Method | Route                   | Auth | Description            |
|--------|-------------------------|------|------------------------|
| POST   | `/coupon`               | Yes  | Create coupon          |
| GET    | `/coupons/:product_id`  | Yes  | List product coupons   |
| DELETE | `/coupon/:id`           | Yes  | Delete coupon          |

### Purchases

| Method | Route           | Auth | Description          |
|--------|-----------------|------|----------------------|
| POST   | `/subscription` | No   | Create subscription  |
| GET    | `/sales`        | Yes  | List all purchases   |

### Users & Customers

| Method | Route                     | Auth | Description              |
|--------|---------------------------|------|--------------------------|
| GET    | `/users`                  | No   | List users               |
| GET    | `/user/:id`               | No   | Get user by ID           |
| GET    | `/customers`              | No   | List customers           |
| GET    | `/customer/:id`           | No   | Get customer by ID       |
| GET    | `/customer/plans/:email`  | No   | Get customer plans       |

## Project Structure

```
src/
├── server.ts          # App initialization
├── router.ts          # Route registration
├── controllers/       # Request handlers
├── routes/            # Endpoint definitions
├── services/          # Business logic
├── repositories/      # Data access (Supabase)
├── middleware/         # JWT auth middleware
├── lib/               # Stripe & Supabase clients
└── types/             # Zod schemas & TypeScript types
```

## License

ISC
