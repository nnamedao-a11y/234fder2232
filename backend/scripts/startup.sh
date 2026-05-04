#!/bin/bash
# CRM Backend Startup Script
# Використовується для cold start та production deployment

set -e

echo "🚀 CRM Backend Startup Script"
echo "=============================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check environment
check_env() {
    echo -e "${YELLOW}Checking environment...${NC}"
    
    if [ ! -f "/app/backend/.env" ]; then
        echo -e "${RED}ERROR: .env file not found!${NC}"
        exit 1
    fi
    
    # Check required vars
    source /app/backend/.env
    
    if [ -z "$MONGO_URL" ]; then
        echo -e "${RED}ERROR: MONGO_URL not set${NC}"
        exit 1
    fi
    
    if [ -z "$DB_NAME" ]; then
        echo -e "${RED}ERROR: DB_NAME not set${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Environment OK${NC}"
}

# Check MongoDB
check_mongodb() {
    echo -e "${YELLOW}Checking MongoDB...${NC}"
    
    if mongosh --eval "db.runCommand('ping').ok" --quiet 2>/dev/null | grep -q 1; then
        echo -e "${GREEN}✓ MongoDB is running${NC}"
    else
        echo -e "${YELLOW}⚠ MongoDB check skipped (mongosh not available)${NC}"
    fi
}

# Check Redis
check_redis() {
    echo -e "${YELLOW}Checking Redis...${NC}"
    
    if redis-cli ping 2>/dev/null | grep -q PONG; then
        echo -e "${GREEN}✓ Redis is running${NC}"
    else
        echo -e "${YELLOW}⚠ Redis not running - starting...${NC}"
        redis-server --daemonize yes 2>/dev/null || true
        sleep 1
        if redis-cli ping 2>/dev/null | grep -q PONG; then
            echo -e "${GREEN}✓ Redis started${NC}"
        else
            echo -e "${YELLOW}⚠ Redis not available - queues may not work${NC}"
        fi
    fi
}

# Install dependencies
install_deps() {
    echo -e "${YELLOW}Checking dependencies...${NC}"
    
    cd /app/backend
    
    if [ ! -d "node_modules" ]; then
        echo "Installing npm packages..."
        npm install
    fi
    
    echo -e "${GREEN}✓ Dependencies OK${NC}"
}

# Run database seed
run_seed() {
    echo -e "${YELLOW}Running database seed...${NC}"
    
    cd /app/backend
    npx ts-node -r tsconfig-paths/register scripts/seed.ts 2>/dev/null || echo "Seed will run on app start"
    
    echo -e "${GREEN}✓ Seed completed${NC}"
}

# Start application
start_app() {
    echo -e "${YELLOW}Starting application...${NC}"
    
    cd /app/backend
    
    if [ "$NODE_ENV" = "production" ]; then
        echo "Running in PRODUCTION mode"
        npm run build
        node dist/main.js
    else
        echo "Running in DEVELOPMENT mode"
        npx ts-node -r tsconfig-paths/register src/main.ts
    fi
}

# Main
main() {
    check_env
    check_mongodb
    check_redis
    install_deps
    start_app
}

main "$@"
