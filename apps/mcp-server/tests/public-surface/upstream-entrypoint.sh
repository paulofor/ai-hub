#!/usr/bin/env sh
set -eu

case "${UPSTREAM_KIND:?}" in
  mcp)
    cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server {
    listen 8084;
    default_type application/json;
    location = /actuator/health { return 200 '{"status":"UP"}'; }
    location /mcp/tools/linux-command { return 200 '{"marker":"shell-upstream-reached"}'; }
    location /mcp/tools/recover-public-proxy { return 200 '{"marker":"semantic-tool-reached"}'; }
}
NGINX
    ;;
  frontend)
    cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server {
    listen 80;
    default_type text/plain;
    location / { return 200 'frontend-reached'; }
}
NGINX
    ;;
  backend)
    cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server { listen 8081; location / { return 200 'backend-reached'; } }
NGINX
    ;;
  sandbox)
    cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server { listen 8083; location / { return 200 'sandbox-reached'; } }
NGINX
    ;;
  *)
    echo "fixture desconhecida" >&2
    exit 1
    ;;
esac
