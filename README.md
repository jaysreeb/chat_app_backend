# One-to-One Chat Backend

A backend for a one-to-one chat application built with Node.js, TypeScript, Express, PostgreSQL, and WebSockets.

I built this project to practise backend development, especially JWT authentication, persistent messaging, and handling WebSocket connections.

## Features

-   Register and log in with email and password
-   Authenticate HTTP routes with JWT access tokens
-   Refresh sessions using an HttpOnly cookie and stored refresh-token
    hashes
-   Connect to the server over WebSockets
-   Send one-to-one messages and store them in PostgreSQL
-   Track message delivery status and retrieve undelivered messages
-   Run the application and PostgreSQL with Docker Compose

## Tech stack

-   **Node.js and TypeScript** --- server runtime and language
-   **Express** --- HTTP routes and middleware
-   **`ws`** --- WebSocket connections
-   **PostgreSQL and `pg`** --- persistent storage and database queries
-   **JWT and bcrypt** --- token-based authentication and password
    hashing
-   **Docker Compose** --- local application and database setup
-   **Vitest and Supertest** --- automated API tests

## How it works

The HTTP API and WebSocket server run on the same Node.js HTTP server.

-   **HTTP** handles registration, login, token refresh, logout, and
    user-related requests.
-   **WebSockets** handle live message communication.
-   **PostgreSQL** stores users, refresh-token sessions, and messages.
-   An in-memory `Map` associates connected user IDs with their
    WebSocket connections.

The connection map is suitable for the current single-server setup. If
the app is run across multiple Node.js instances, each instance would
have its own map; a shared coordination mechanism would be needed for
cross-instance message delivery.

## Authentication

The authentication routes are mounted under `/api/auth`:

  1. `POST`                  `/api/auth/register`    Create an account
  2. `POST`                  `/api/auth/login`       Verify credentials and issue tokens
  3. `POST`                  `/api/auth/refresh`     Issue a new access token using a valid refresh session
  4. `POST`                  `/api/auth/logout`      Revoke the refresh-token session
  5. `GET`                   `/api/me`               Return the authenticated user's token claims
                                                  

Protected routes use `authenticateToken` middleware. It verifies the access token and attaches the user ID, email, and username to the request.

Passwords are hashed with bcrypt. Refresh tokens are stored as hashes in PostgreSQL so the raw refresh token does not need to be stored in the database.

## Messaging

When a message is received over a WebSocket, the server stores it in
PostgreSQL. The connection map is used to check whether the recipient is
connected. The database also tracks whether a message has been delivered
and supports querying undelivered messages.

A few things I still need to test carefully are reconnect behavior, what
happens if a connection drops during delivery, and how to avoid marking
a message delivered before the recipient has actually received it.

## Running locally

You need Docker and Docker Compose installed.

1.  Create a `.env` file with the environment variables required by the
    application. Do not commit secrets to Git.

2.  Build and start the services:

    ``` bash
    docker compose up --build
    ```

3.  To stop the services:

    ``` bash
    docker compose down
    ```

The named PostgreSQL volume preserves database data between container
restarts. Use `docker compose down -v` only when you intentionally want
to delete the volume and its data.

## Running tests

Run the test suite once:

``` bash
npx vitest run
```

Or run Vitest in watch mode:

``` bash
npm test
```

The current tests use Vitest and Supertest to exercise the Express app.
Tests that access PostgreSQL need a database configuration reachable
from the environment where the test process is running.

## Project structure

``` text
src/
  app.ts                  # Express app setup
  index.ts                # HTTP server and WebSocket startup
  db.ts                   # PostgreSQL connection pool
  routes/
    auth.ts               # Registration, login, refresh, and logout
    users.ts              # User routes
  middleware/
    auth.ts               # JWT verification middleware
  websocket/
    server.ts             # WebSocket connections and message handling
    messageService.ts     # Message database queries
tests/
  auth.test.ts            # API tests
init.sql                  # Database schema
Dockerfile
docker-compose.yml
```

## What I learned and FEatures to add

Building the WebSocket layer made me think about how the server associates a connection with a user and what happens when that user disconnects. I also had to work through refresh-token storage and revocation, and I am now adding automated tests around the HTTP routes. 
The next areas I want to improve are offline-message delivery, test isolation, pagination for message history, structured logging, and rate limiting.