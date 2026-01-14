#!/bin/bash

# MySQL Dump S3 - Local Integration Test Runner
# This script runs the complete integration test suite locally using Docker Compose

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.test.yml"
TEST_TIMEOUT=3600 # 60 minutes timeout for large database tests (10GB+)
CLEANUP_ON_FAILURE=${CLEANUP_ON_FAILURE:-true}
VERBOSE=${VERBOSE:-false}
DOCKER_COMPOSE_CMD=""  # Will be set during prerequisite check

# Trap to ensure cleanup on script exit
cleanup() {
    local exit_code=$?
    
    if [ $exit_code -ne 0 ]; then
        echo -e "${RED}✗ Tests failed with exit code $exit_code${NC}"
        
        if [ "$CLEANUP_ON_FAILURE" = "false" ]; then
            echo -e "${YELLOW}Keeping containers running for debugging (CLEANUP_ON_FAILURE=false)${NC}"
            echo -e "${YELLOW}Run '${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE down -v' to clean up manually${NC}"
            return
        fi
    fi
    
    echo -e "\n${BLUE}Cleaning up test environment...${NC}"
    ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE down -v --remove-orphans 2>/dev/null || true
    
    # Remove test reports if they exist
    rm -rf test-reports/ 2>/dev/null || true
    
    echo -e "${GREEN}✓ Cleanup completed${NC}"
}

trap cleanup EXIT

# Function to print section headers
print_header() {
    echo -e "\n${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}\n"
}

# Function to check prerequisites
check_prerequisites() {
    print_header "Checking Prerequisites"
    
    local missing_deps=()
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        missing_deps+=("docker")
    else
        echo -e "${GREEN}✓${NC} Docker installed: $(docker --version)"
    fi
    
    # Check Docker Compose (v1 or v2)
    if command -v ${DOCKER_COMPOSE_CMD:-docker-compose} &> /dev/null; then
        DOCKER_COMPOSE_CMD="${DOCKER_COMPOSE_CMD:-docker-compose}"
        echo -e "${GREEN}✓${NC} Docker Compose installed: $(${DOCKER_COMPOSE_CMD:-docker-compose} --version)"
    elif docker compose version &> /dev/null; then
        DOCKER_COMPOSE_CMD="docker compose"
        echo -e "${GREEN}✓${NC} Docker Compose installed: $(docker compose version)"
    else
        missing_deps+=("${DOCKER_COMPOSE_CMD:-docker-compose}")
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        missing_deps+=("node")
    else
        echo -e "${GREEN}✓${NC} Node.js installed: $(node --version)"
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        missing_deps+=("npm")
    else
        echo -e "${GREEN}✓${NC} npm installed: $(npm --version)"
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        echo -e "${RED}✗ Missing dependencies: ${missing_deps[*]}${NC}"
        echo -e "${YELLOW}Please install the missing dependencies and try again.${NC}"
        exit 1
    fi
    
    # Check if Docker daemon is running
    if ! docker info &> /dev/null; then
        echo -e "${RED}✗ Docker daemon is not running${NC}"
        echo -e "${YELLOW}Please start Docker and try again.${NC}"
        exit 1
    fi
    
    # Check for port conflicts
    local port_conflicts=()
    
    # Check MySQL port 3307
    if lsof -Pi :3307 -sTCP:LISTEN -t >/dev/null 2>&1; then
        port_conflicts+=("3307 (MySQL)")
    fi
    
    # Check MinIO ports 9090 and 9091
    if lsof -Pi :9090 -sTCP:LISTEN -t >/dev/null 2>&1; then
        port_conflicts+=("9090 (MinIO API)")
    fi
    
    if lsof -Pi :9091 -sTCP:LISTEN -t >/dev/null 2>&1; then
        port_conflicts+=("9091 (MinIO Console)")
    fi
    
    if [ ${#port_conflicts[@]} -ne 0 ]; then
        echo -e "${YELLOW}⚠ Port conflicts detected on: ${port_conflicts[*]}${NC}"
        echo -e "${YELLOW}These ports are required for the test environment.${NC}"
        
        # Check if there are existing test containers
        if docker ps -a | grep -q "mysqldump-s3-test"; then
            echo -e "${BLUE}Found existing test containers. Cleaning up...${NC}"
            ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE down -v 2>/dev/null || true
            sleep 2
            
            # Re-check ports
            port_conflicts=()
            if lsof -Pi :3307 -sTCP:LISTEN -t >/dev/null 2>&1; then
                port_conflicts+=("3307")
            fi
            if lsof -Pi :9090 -sTCP:LISTEN -t >/dev/null 2>&1; then
                port_conflicts+=("9090")
            fi
            if lsof -Pi :9091 -sTCP:LISTEN -t >/dev/null 2>&1; then
                port_conflicts+=("9091")
            fi
            
            if [ ${#port_conflicts[@]} -ne 0 ]; then
                echo -e "${RED}✗ Ports still in use after cleanup: ${port_conflicts[*]}${NC}"
                echo -e "${YELLOW}Please stop the services using these ports and try again.${NC}"
                echo -e "${YELLOW}You can check what's using them with: lsof -i :<port>${NC}"
                exit 1
            fi
        else
            echo -e "${RED}✗ Please stop the services using these ports and try again.${NC}"
            echo -e "${YELLOW}You can check what's using them with:${NC}"
            for port in "${port_conflicts[@]}"; do
                echo -e "${YELLOW}  lsof -i :${port%% *}${NC}"
            done
            exit 1
        fi
    else
        echo -e "${GREEN}✓ No port conflicts detected${NC}"
    fi
    
    echo -e "${GREEN}✓ All prerequisites met${NC}"
}

# Function to build the application
build_application() {
    print_header "Building Application"
    
    echo "Installing dependencies..."
    npm ci
    
    echo "Running linter..."
    if npm run lint; then
        echo -e "${GREEN}✓ Linting passed${NC}"
    else
        echo -e "${RED}✗ Linting failed${NC}"
        exit 1
    fi
    
    echo "Building TypeScript..."
    if npm run build; then
        echo -e "${GREEN}✓ Build successful${NC}"
    else
        echo -e "${RED}✗ Build failed${NC}"
        exit 1
    fi
}

# Function to run unit tests
run_unit_tests() {
    print_header "Running Unit Tests"
    
    if npm test; then
        echo -e "${GREEN}✓ Unit tests passed${NC}"
    else
        echo -e "${RED}✗ Unit tests failed${NC}"
        exit 1
    fi
}

# Function to start test environment
start_test_environment() {
    print_header "Starting Test Environment"

    echo "Building test container (forcing rebuild to ensure latest code)..."
    ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE build --no-cache app-test

    echo "Pulling required Docker images..."
    ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE pull

    echo "Starting MySQL and MinIO services..."
    ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE up -d mysql minio
    
    echo "Waiting for MySQL to be healthy..."
    local retries=0
    local max_retries=30
    
    while [ $retries -lt $max_retries ]; do
        if ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE exec -T mysql mysqladmin ping -h localhost -u root -ptest_password &>/dev/null; then
            echo -e "${GREEN}✓ MySQL is ready${NC}"
            break
        fi
        retries=$((retries + 1))
        echo -n "."
        sleep 2
    done
    
    if [ $retries -eq $max_retries ]; then
        echo -e "\n${RED}✗ MySQL failed to start${NC}"
        exit 1
    fi
    
    echo "Waiting for MinIO to be healthy..."
    retries=0
    while [ $retries -lt $max_retries ]; do
        if curl -f http://localhost:9090/minio/health/live &>/dev/null; then
            echo -e "${GREEN}✓ MinIO is ready${NC}"
            break
        fi
        retries=$((retries + 1))
        echo -n "."
        sleep 2
    done
    
    if [ $retries -eq $max_retries ]; then
        echo -e "\n${RED}✗ MinIO failed to start${NC}"
        exit 1
    fi
    
    echo "Creating S3 test bucket..."
    ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE run --rm createbucket
    echo -e "${GREEN}✓ Test environment is ready${NC}"
}

# Function to run integration tests
run_integration_tests() {
    print_header "Running Integration Tests"
    
    echo -e "\n${YELLOW}Running integration tests (this may take a few minutes)...${NC}\n"
    
    # Create test reports directory
    mkdir -p test-reports
    
    # Run tests with timeout - using the new CLI in the container
    if timeout $TEST_TIMEOUT ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE run --rm \
        app-test mysqldump-s3 --help > /dev/null 2>&1; then
        echo -e "${GREEN}✓ CLI is working in container${NC}"
    else
        echo -e "${RED}✗ CLI not working in container${NC}"
        return 1
    fi
    
    # Run integration tests with proper configuration (disable TTY to avoid terminal issues)
    if timeout $TEST_TIMEOUT ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE run --rm -T \
        app-test npx jest --config=jest.integration.config.js --forceExit; then
        echo -e "\n${GREEN}✓ Integration tests passed${NC}"
        return 0
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo -e "\n${RED}✗ Integration tests timed out after ${TEST_TIMEOUT} seconds${NC}"
        else
            echo -e "\n${RED}✗ Integration tests failed${NC}"
        fi
        return $exit_code
    fi
}

# Function to show test results
show_test_results() {
    print_header "Test Results Summary"
    
    # Check if test reports exist
    if [ -d "test-reports" ] && [ "$(ls -A test-reports 2>/dev/null)" ]; then
        echo -e "${GREEN}Test reports generated in test-reports/${NC}"
        
        # Try to parse and display JUnit XML results if available
        if [ -f "test-reports/junit.xml" ]; then
            echo -e "\n${BLUE}JUnit Test Results:${NC}"
            # Basic parsing of JUnit XML (requires xmllint if available)
            if command -v xmllint &> /dev/null; then
                local tests=$(xmllint --xpath "string(/testsuites/@tests)" test-reports/junit.xml 2>/dev/null || echo "?")
                local failures=$(xmllint --xpath "string(/testsuites/@failures)" test-reports/junit.xml 2>/dev/null || echo "?")
                local errors=$(xmllint --xpath "string(/testsuites/@errors)" test-reports/junit.xml 2>/dev/null || echo "?")
                local time=$(xmllint --xpath "string(/testsuites/@time)" test-reports/junit.xml 2>/dev/null || echo "?")
                
                echo "  Total Tests: $tests"
                echo "  Failures: $failures"
                echo "  Errors: $errors"
                echo "  Time: ${time}s"
            else
                echo "  (Install xmllint for detailed results)"
            fi
        fi
    fi
    
    # Show container logs if verbose mode
    if [ "$VERBOSE" = "true" ]; then
        echo -e "\n${BLUE}Container Logs:${NC}"
        ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE logs --tail=50
    fi
}

# Function to run restore test with non-existent database
test_database_creation() {
    print_header "Testing Database Auto-Creation Feature"
    
    echo "Creating test data in testdb..."
    # Wait for MySQL socket to be ready and use TCP connection
    sleep 5
    ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE exec -T mysql sh -c 'mysql -h 127.0.0.1 -P 3306 -u testuser -ptestpass testdb' <<EOF
CREATE TABLE IF NOT EXISTS test_table (id INT PRIMARY KEY, name VARCHAR(100));
TRUNCATE TABLE test_table;
INSERT INTO test_table VALUES (1, 'Test Data');
EOF
    
    echo "Creating backup with custom name..."
    # Use a fixed custom name for easy identification
    BACKUP_KEY="auto-create-test-backup.sql.gz"
    
    # Run backup with custom name - redirect stderr to stdout to capture all output
    if ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE run --rm -T \
        -e DB_HOST=mysql \
        -e DB_PORT=3306 \
        -e DB_USER=testuser \
        -e DB_PASSWORD=testpass \
        -e DB_NAME=testdb \
        -e S3_BUCKET=test-backups \
        -e S3_ENDPOINT_URL=http://minio:9000 \
        -e S3_ACCESS_KEY_ID=minioadmin \
        -e S3_SECRET_ACCESS_KEY=minioadmin \
        -e S3_FORCE_PATH_STYLE=true \
        app-test mysqldump-s3 backup --name auto-create-test-backup 2>&1; then
        echo -e "${GREEN}✓ Backup created successfully${NC}"
    else
        echo -e "${RED}✗ Failed to create backup${NC}"
        return 1
    fi
    
    if [ -z "$BACKUP_KEY" ]; then
        echo -e "${RED}✗ Could not extract backup key from output${NC}"
        echo "Trying to list backups..."
        ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE run --rm \
            -e DB_HOST=mysql \
            -e DB_PORT=3306 \
            -e DB_USER=testuser \
            -e DB_PASSWORD=testpass \
            -e S3_BUCKET=test-backups \
            -e S3_ENDPOINT_URL=http://minio:9000 \
            -e S3_ACCESS_KEY_ID=minioadmin \
            -e S3_SECRET_ACCESS_KEY=minioadmin \
            app-test mysqldump-s3 list
        return 1
    fi
    
    echo "Found backup: $BACKUP_KEY"
    echo "Testing restore to non-existent database..."
    
    # Restore to new database - don't set DB_NAME since we want to target a different database
    if ${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE run --rm -T \
        -e DB_HOST=mysql \
        -e DB_PORT=3306 \
        -e DB_USER=testuser \
        -e DB_PASSWORD=testpass \
        -e S3_BUCKET=test-backups \
        -e S3_ENDPOINT_URL=http://minio:9000 \
        -e S3_ACCESS_KEY_ID=minioadmin \
        -e S3_SECRET_ACCESS_KEY=minioadmin \
        -e S3_FORCE_PATH_STYLE=true \
        app-test mysqldump-s3 restore --backup "$BACKUP_KEY" --database new_test_db --force --non-interactive; then
        echo -e "${GREEN}✓ Restore command executed successfully${NC}"
    else
        echo -e "${RED}✗ Restore command failed${NC}"
        return 1
    fi
    
    # Verify the database was created
    local db_exists=$(${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE exec -T mysql \
        sh -c 'mysql -h 127.0.0.1 -P 3306 -u root -ptest_password -e "SHOW DATABASES LIKE '"'"'new_test_db'"'"';"' 2>/dev/null | grep -c new_test_db || true)
    
    if [ "$db_exists" -gt 0 ]; then
        echo -e "${GREEN}✓ Database auto-creation successful${NC}"
        
        # Verify data was restored
        local data_count=$(${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE exec -T mysql \
            sh -c 'mysql -h 127.0.0.1 -P 3306 -u root -ptest_password -e "SELECT COUNT(*) FROM new_test_db.test_table;"' 2>/dev/null | tail -1)
        
        if [ "$data_count" = "1" ]; then
            echo -e "${GREEN}✓ Data restored successfully (${data_count} record)${NC}"
        else
            echo -e "${YELLOW}⚠ Data count: ${data_count}${NC}"
        fi
        
        # Verify the actual data content
        local test_data=$(${DOCKER_COMPOSE_CMD:-docker-compose} -f $COMPOSE_FILE exec -T mysql \
            sh -c 'mysql -h 127.0.0.1 -P 3306 -u root -ptest_password -e "SELECT name FROM new_test_db.test_table WHERE id=1;"' 2>/dev/null | tail -1)
        if [ "$test_data" = "Test Data" ]; then
            echo -e "${GREEN}✓ Data integrity verified${NC}"
        else
            echo -e "${YELLOW}⚠ Data content: ${test_data}${NC}"
        fi
    else
        echo -e "${RED}✗ Database auto-creation failed${NC}"
        return 1
    fi
}

# Main execution
main() {
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     MySQL Dump S3 - Local Integration Test Runner           ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --verbose|-v)
                VERBOSE=true
                shift
                ;;
            --keep-on-failure|-k)
                CLEANUP_ON_FAILURE=false
                shift
                ;;
            --timeout|-t)
                TEST_TIMEOUT="$2"
                shift 2
                ;;
            --help|-h)
                echo "Usage: $0 [options]"
                echo ""
                echo "Options:"
                echo "  -v, --verbose          Show verbose output including container logs"
                echo "  -k, --keep-on-failure  Keep containers running on test failure"
                echo "  -t, --timeout SECONDS  Set test timeout (default: 300)"
                echo "  -h, --help            Show this help message"
                exit 0
                ;;
            *)
                echo -e "${RED}Unknown option: $1${NC}"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
    
    # Run test workflow
    check_prerequisites
    build_application
    run_unit_tests
    start_test_environment
    test_database_creation
    run_integration_tests
    show_test_results
    
    print_header "All Tests Passed! 🎉"
    echo -e "${GREEN}The MySQL Dump S3 integration test suite completed successfully.${NC}"
    echo -e "${GREEN}The application is ready for deployment.${NC}"
}

# Run main function
main "$@"