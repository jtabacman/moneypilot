#!/usr/bin/env bash
#
# Levanta Postgres para desarrollo.
#
# Usa `docker compose` si está disponible y cae a `docker run` si no. El
# plugin de Compose no viene con todas las instalaciones de Docker, y no vale
# la pena que el setup del proyecto dependa de eso: la configuración es la
# misma en los dos caminos.
set -euo pipefail

CONTAINER="moneypilot-db"
VOLUME="moneypilot-pgdata"
PORT="55432"
IMAGE="postgres:17-alpine"

has_compose() { docker compose version >/dev/null 2>&1; }

start_with_run() {
  if [ "$(docker ps -aq -f name="^${CONTAINER}$")" ]; then
    docker start "${CONTAINER}" >/dev/null
  else
    docker volume create "${VOLUME}" >/dev/null
    docker run -d \
      --name "${CONTAINER}" \
      -e POSTGRES_USER=moneypilot \
      -e POSTGRES_PASSWORD=moneypilot \
      -e POSTGRES_DB=moneypilot \
      -e POSTGRES_INITDB_ARGS="--locale=C --encoding=UTF8" \
      -e TZ=UTC -e PGTZ=UTC \
      -p "${PORT}:5432" \
      -v "${VOLUME}:/var/lib/postgresql/data" \
      --restart unless-stopped \
      "${IMAGE}" >/dev/null
  fi
}

psql_run() { docker exec -i "${CONTAINER}" psql -v ON_ERROR_STOP=1 -U moneypilot -d moneypilot "$@"; }

case "${1:-up}" in
  up)
    if has_compose; then docker compose up -d >/dev/null; else start_with_run; fi

    printf 'esperando a postgres'
    for _ in $(seq 1 60); do
      if docker exec "${CONTAINER}" pg_isready -U moneypilot -q 2>/dev/null; then
        echo " · listo"
        break
      fi
      printf '.'
      sleep 0.5
    done

    # El rol de aplicación existe sin login desde la migración: una credencial
    # escrita en el repositorio es una credencial filtrada. Acá se le asigna
    # una contraseña sólo para la base local.
    PASSWORD="${MONEYPILOT_APP_PASSWORD:-moneypilot_app}"
    psql_run -c "do \$\$
      begin
        if exists (select 1 from pg_roles where rolname = 'moneypilot_app') then
          execute format('alter role moneypilot_app login password %L', '${PASSWORD}');
        end if;
      end \$\$;" >/dev/null
    echo "postgres en localhost:${PORT}"
    ;;

  down)
    if has_compose; then docker compose down >/dev/null; else docker stop "${CONTAINER}" >/dev/null 2>&1 || true; fi
    echo "postgres detenido"
    ;;

  destroy)
    if has_compose; then
      docker compose down -v >/dev/null
    else
      docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
      docker volume rm "${VOLUME}" >/dev/null 2>&1 || true
    fi
    echo "postgres y sus datos eliminados"
    ;;

  role)
    PASSWORD="${MONEYPILOT_APP_PASSWORD:-moneypilot_app}"
    psql_run -c "alter role moneypilot_app login password '${PASSWORD}'" >/dev/null
    echo "rol moneypilot_app actualizado"
    ;;

  *)
    echo "uso: dev-db.sh [up|down|destroy|role]" >&2
    exit 1
    ;;
esac
