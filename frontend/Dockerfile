# Static site — pass Railway build args: VITE_API_URL (public https API origin).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL
ARG VITE_USE_DEMO_USER=true
ARG VITE_DEMO_USER_TOKEN=a1b2c3d4-e5f6-4789-a012-3456789abcde

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_USE_DEMO_USER=$VITE_USE_DEMO_USER
ENV VITE_DEMO_USER_TOKEN=$VITE_DEMO_USER_TOKEN

RUN npm run build

FROM nginx:alpine
# Railway injects PORT; entrypoint substitutes into template → conf.d
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV PORT=80
EXPOSE 80
