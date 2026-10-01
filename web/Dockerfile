# Multi-stage build: dependencies, then the Next.js build, then a small runtime image that holds
# only the standalone server (next.config.ts sets output: "standalone") — no source, no dev
# dependencies, no full node_modules.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so they're build args,
# not runtime env: changing them means rebuilding the image.
ARG NEXT_PUBLIC_LABEL_FORMAT=both
ARG NEXT_PUBLIC_CURRENCY=EUR
ENV NEXT_PUBLIC_LABEL_FORMAT=$NEXT_PUBLIC_LABEL_FORMAT \
    NEXT_PUBLIC_CURRENCY=$NEXT_PUBLIC_CURRENCY \
    NEXT_TELEMETRY_DISABLED=1
# The build downloads the Google fonts the layout imports, so it needs network access.
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER app
EXPOSE 8080
CMD ["node", "server.js"]
