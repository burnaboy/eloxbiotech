# syntax=docker/dockerfile:1
# Production image for Binary Commerce. See docs/DEPLOYMENT.md.
#   docker build -t binary-commerce:<git-sha> .                    # the web app
#   docker build --target migrate -t binary-commerce-migrate:<sha> .  # runs `prisma migrate deploy`
# No secrets are baked in: every setting comes from the environment at run time.

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
# Prisma needs OpenSSL; the slim image doesn't have it.
RUN if ! command -v openssl >/dev/null; then \
      apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Behind a TLS-inspecting proxy, pass its CA with `--secret id=ca,src=<file>`; otherwise nothing is needed.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund && npx prisma generate

FROM deps AS build
COPY . .
RUN npm run build

# One-off job for releases: applies pending migrations with the owner role (DATABASE_URL), then exits.
FROM deps AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
