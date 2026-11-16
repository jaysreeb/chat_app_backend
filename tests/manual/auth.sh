
#!/bin/bash

BASE_URL="http://localhost:3000/api/auth"
COOKIE_JAR="tests/manual/cookies.txt"

# Register
register() {
  curl -i -X POST "$BASE_URL/register" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","username":"testuser","password":"Password123"}'
}

# Login
login() {
  curl -i -c "$COOKIE_JAR" -X POST "$BASE_URL/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"Password123"}'
}

# Refresh
refresh() {
  curl -i -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -X POST "$BASE_URL/refresh"
}

# Logout
logout() {
  curl -i -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -X POST "$BASE_URL/logout"
}

# Execute selected operation
"$@"
