#!/bin/bash
# CRM Cold Start Script
# Повна ініціалізація системи з нуля

set -e

echo "❄️  CRM Cold Start"
echo "=================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Stop all services
echo -e "${YELLOW}Stopping services...${NC}"
pkill -f "ts-node" 2>/dev/null || true
pkill -f "node.*main" 2>/dev/null || true

# Clear MongoDB (CAREFUL!)
clear_database() {
    echo -e "${YELLOW}Clearing database...${NC}"
    read -p "Are you sure you want to clear ALL data? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
        mongosh crm_db --eval "db.dropDatabase()" 2>/dev/null || \
        mongo crm_db --eval "db.dropDatabase()" 2>/dev/null || \
        echo "Database clear skipped"
        echo -e "${GREEN}✓ Database cleared${NC}"
    else
        echo "Database clear skipped"
    fi
}

# Reset Redis
reset_redis() {
    echo -e "${YELLOW}Resetting Redis...${NC}"
    redis-cli FLUSHALL 2>/dev/null || echo "Redis flush skipped"
    echo -e "${GREEN}✓ Redis reset${NC}"
}

# Install fresh dependencies
install_fresh() {
    echo -e "${YELLOW}Installing fresh dependencies...${NC}"
    
    cd /app/backend
    rm -rf node_modules package-lock.json
    npm install
    
    cd /app/frontend
    rm -rf node_modules yarn.lock
    yarn install
    
    echo -e "${GREEN}✓ Dependencies installed${NC}"
}

# Start Redis
start_redis() {
    echo -e "${YELLOW}Starting Redis...${NC}"
    redis-server --daemonize yes 2>/dev/null || true
    sleep 1
    echo -e "${GREEN}✓ Redis started${NC}"
}

# Start backend
start_backend() {
    echo -e "${YELLOW}Starting backend...${NC}"
    cd /app/backend
    nohup npx ts-node -r tsconfig-paths/register src/main.ts > /tmp/backend.log 2>&1 &
    sleep 5
    
    if curl -s http://localhost:8002/api/system/health | grep -q "healthy"; then
        echo -e "${GREEN}✓ Backend started${NC}"
    else
        echo -e "${YELLOW}⚠ Backend may still be starting...${NC}"
    fi
}

# Start frontend
start_frontend() {
    echo -e "${YELLOW}Starting frontend...${NC}"
    cd /app/frontend
    nohup yarn start > /tmp/frontend.log 2>&1 &
    sleep 5
    echo -e "${GREEN}✓ Frontend started${NC}"
}

# Main
main() {
    echo ""
    echo "This script will:"
    echo "  1. Stop all services"
    echo "  2. Optionally clear database"
    echo "  3. Reset Redis"
    echo "  4. Reinstall dependencies"
    echo "  5. Start all services"
    echo ""
    
    read -p "Continue? (yes/no): " proceed
    if [ "$proceed" != "yes" ]; then
        echo "Aborted"
        exit 0
    fi
    
    clear_database
    reset_redis
    # install_fresh  # Uncomment if needed
    start_redis
    start_backend
    start_frontend
    
    echo ""
    echo -e "${GREEN}=============================${NC}"
    echo -e "${GREEN}Cold start complete!${NC}"
    echo -e "${GREEN}=============================${NC}"
    echo ""
    echo "Backend: http://localhost:8002/api"
    echo "Frontend: http://localhost:3000"
    echo "Health: http://localhost:8002/api/system/health"
    echo ""
    echo "Default admin: admin@crm.com / admin123"
}

main "$@"
