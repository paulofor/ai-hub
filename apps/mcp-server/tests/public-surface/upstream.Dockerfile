FROM nginx:1.27-alpine

COPY apps/mcp-server/tests/public-surface/upstream-entrypoint.sh /docker-entrypoint.d/50-public-surface-fixture.sh
RUN chmod 755 /docker-entrypoint.d/50-public-surface-fixture.sh
